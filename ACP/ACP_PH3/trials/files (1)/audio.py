"""
core.audio
==========
Speech in, speech out. Framework-agnostic: takes and returns file paths.

CHANGED IN THIS REVISION
  transcribe() now requests verbose_json and returns a Transcript dataclass
  carrying the segments and their decode confidence, so core.pronunciation can
  derive a clarity signal. The text-only behaviour is unchanged for callers
  that just want `.text`.

The important thing in this module is still the guard around the Whisper
conditioning prompt. Conditioning Whisper toward verbatim output is the right
technique AND the technique most likely to fabricate a learner error, so the
two live side by side on purpose.
"""

import asyncio
import difflib
import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import edge_tts

from .config import (
    MAX_PLAUSIBLE_WORDS_PER_SECOND,
    MIN_AUDIO_SECONDS,
    SHORT_AUDIO_SECONDS,
    SILENCE_ARTEFACTS,
    TTS_RATE,
    WHISPER_CONDITIONING_PROMPT,
    WHISPER_PROMPT_LEAK_MARKERS,
    settings,
)
from .llm import _groq

log = logging.getLogger("cefr.audio")

AUDIO_DIR = Path(settings.audio_dir)
AUDIO_DIR.mkdir(exist_ok=True)

TTS_STRIP = re.compile(r"[\*_`#>\[\]|]")


class EmptyAudio(Exception):
    """Nothing usable in the recording."""


class TranscriptionRejected(Exception):
    """The transcript cannot be trusted — currently, prompt leakage or silence."""


@dataclass
class Transcript:
    text: str
    segments: list = field(default_factory=list)
    conditioned: bool = True
    duration: float = 0.0
    # Set when the leak guard fired but the audio corroborated real speech.
    # The turn proceeds; the flag exists so the panel can hedge and so the
    # rate of near-misses is observable in the logs.
    leak_suspected: bool = False

    def __str__(self) -> str:      # so old string-ish call sites still read fine
        return self.text


# ===========================================================================
# HOUSEKEEPING
# ===========================================================================

def prune_generated_files() -> None:
    cutoff = time.time() - settings.audio_ttl_seconds
    for pattern in ("turn_*.mp3", "turn_*.wav", "report_*.md"):
        for path in AUDIO_DIR.glob(pattern):
            try:
                if path.stat().st_mtime < cutoff:
                    path.unlink()
            except OSError:
                pass


def audio_duration(audio_path: str) -> float:
    """Seconds, or 0.0 if it cannot be determined without decoding.

    Uses stdlib `wave` -- Gradio writes .wav for microphone captures. Byte size
    is a poor proxy across codecs, and duration is what every guard below
    actually wants to reason about.
    """
    try:
        import wave  # noqa: PLC0415

        with wave.open(audio_path, "rb") as handle:
            return handle.getnframes() / float(handle.getframerate() or 1)
    except Exception:
        return 0.0


def validate_upload(audio_path: Optional[str]) -> int:
    if not audio_path:
        raise EmptyAudio("No audio was received.")
    try:
        size = Path(audio_path).stat().st_size
    except OSError as exc:
        raise EmptyAudio("The recording could not be read.") from exc
    if size < settings.min_upload_bytes:
        raise EmptyAudio("That recording is too short. Speak for a couple of seconds.")
    if size > settings.max_upload_bytes:
        raise EmptyAudio("That recording is too long. Keep turns under about two minutes.")

    # THE CLIPPED-AUDIO RACE. Sending sub-second audio to Whisper produces
    # "Thank you." or "." with high confidence, which then trips the silence
    # rejector and surfaces as a baffling error. Catch it here instead: before
    # the API call, with a message that tells the learner what to do.
    duration = audio_duration(audio_path)
    if 0 < duration < MIN_AUDIO_SECONDS:
        raise EmptyAudio(
            "That recording was cut short. Hold the microphone button, speak, "
            "then release it before sending."
        )
    return size


# ===========================================================================
# SPEECH TO TEXT
# ===========================================================================

def _normalise(text: str) -> str:
    return re.sub(r"[^a-z' ]+", " ", (text or "").lower()).strip()


def text_matches_prompt(transcript: str) -> bool:
    """String-level resemblance to the conditioning prompt. NOT a verdict.

    On its own this cannot distinguish a hallucination from a learner who
    genuinely said those words -- which is exactly the false positive that was
    rejecting real turns. Callers must corroborate with `speech_is_plausible`.
    """
    normalised = _normalise(transcript)
    if not normalised:
        return False
    for marker in WHISPER_PROMPT_LEAK_MARKERS:
        if _normalise(marker) in normalised:
            return True
    return difflib.SequenceMatcher(
        None, normalised, _normalise(WHISPER_CONDITIONING_PROMPT)
    ).ratio() > 0.65


def speech_is_plausible(transcript: str, duration: float, segments: list) -> bool:
    """Is there enough audio underneath this text for a human to have said it?

    This is the signal that separates a leak from a real utterance, and it does
    not care what the words are. A hallucination is text with no audio under
    it: the implied speaking rate is impossible, or the decoder itself reports
    the frames were silence.
    """
    words = len(_normalise(transcript).split())
    if not words:
        return False

    if duration > 0:
        rate = words / duration
        if rate > MAX_PLAUSIBLE_WORDS_PER_SECOND:
            log.info("Implausible speaking rate: %.1f words/s over %.2fs", rate, duration)
            return False
        if duration < SHORT_AUDIO_SECONDS and words > 4:
            return False          # too many words for the audio available

    # The decoder's own opinion about whether it heard anything.
    speechful = [
        seg for seg in (segments or [])
        if float(seg.get("no_speech_prob", 0.0)) < 0.5 and str(seg.get("text", "")).strip()
    ]
    if segments and not speechful:
        log.info("All segments report no_speech_prob >= 0.5")
        return False

    return True


def detect_prompt_leak(transcript: str, duration: float = 0.0,
                       segments: Optional[list] = None) -> bool:
    """A leak is prompt-shaped text with no speech under it.

    The old detector fired on the text alone, so a learner practising past
    simple who said "I goed to the store" -- the modal utterance for that
    lesson -- had their turn rejected as a hallucination. Text resemblance is
    now necessary but not sufficient: the audio has to fail to corroborate it.
    """
    if not text_matches_prompt(transcript):
        return False
    if speech_is_plausible(transcript, duration, segments or []):
        log.info(
            "Transcript resembles the conditioning prompt but the audio supports "
            "it (%.2fs). Treating as genuine learner speech: %r",
            duration, transcript[:100],
        )
        return False
    log.warning("Whisper prompt leak confirmed (%.2fs of audio): %r",
                duration, transcript[:120])
    return True


def is_silence(transcript: str) -> bool:
    stripped = (transcript or "").strip()
    if len(stripped) < 2:
        return True
    return stripped.lower().rstrip(".!?") in SILENCE_ARTEFACTS


def _extract(payload) -> tuple:
    """Normalise the SDK's verbose_json response into (text, segments)."""
    if isinstance(payload, str):
        return payload.strip(), []
    text = (getattr(payload, "text", None) or "").strip()
    raw_segments = getattr(payload, "segments", None) or []
    segments = []
    for segment in raw_segments:
        if isinstance(segment, dict):
            segments.append(segment)
        else:
            segments.append({
                "text": getattr(segment, "text", ""),
                "start": getattr(segment, "start", 0.0),
                "end": getattr(segment, "end", 0.0),
                "avg_logprob": getattr(segment, "avg_logprob", 0.0),
                "no_speech_prob": getattr(segment, "no_speech_prob", 0.0),
                "compression_ratio": getattr(segment, "compression_ratio", 1.0),
            })
    if not text and segments:
        text = " ".join(str(s.get("text", "")) for s in segments).strip()
    return text, segments


async def transcribe(audio_path: str, condition: bool = True) -> Transcript:
    """
    Verbatim-biased transcription with per-segment confidence.

    `condition=True` passes the learner-error prompt so Whisper stops repairing
    morphology before the assessor sees it. On a suspected leak we retry ONCE
    unconditioned: a normalised transcript is far less damaging than a
    fabricated error, so the fallback trades verbatim fidelity for truthfulness.

    This mitigates the normalisation problem; it does not solve it. An /s/ the
    learner never pronounced cannot be recovered by any prompt. Benchmark it:
    twenty real recordings, transcribed both ways, counted against your own
    hand-marked errors. That number is the ceiling on assessment recall.
    """
    if _groq is None:
        raise RuntimeError("GROQ_API_KEY is not configured.")

    audio_bytes = Path(audio_path).read_bytes()
    filename = Path(audio_path).name

    async def _call(prompt: Optional[str]):
        kwargs = {
            "file": (filename, audio_bytes),
            "model": settings.stt_model,
            # verbose_json is what carries avg_logprob / no_speech_prob. Without
            # it there is no clarity signal at all, only text.
            "response_format": "verbose_json",
            "language": "en",
            "temperature": 0.0,
        }
        if prompt:
            kwargs["prompt"] = prompt
        return await _groq.audio.transcriptions.create(**kwargs)

    duration = audio_duration(audio_path)

    payload = await _call(WHISPER_CONDITIONING_PROMPT if condition else None)
    text, segments = _extract(payload)
    conditioned = condition
    leak_suspected = False

    if condition and detect_prompt_leak(text, duration, segments):
        # The unconditioned pass is the arbiter. It cannot leak, because it was
        # given nothing to leak. If it still returns substantive speech, the
        # learner really did talk and we keep their turn -- just without the
        # conditioning that made the transcript ambiguous.
        log.info("Retrying transcription without the conditioning prompt.")
        payload = await _call(None)
        plain_text, plain_segments = _extract(payload)

        if not is_silence(plain_text) and speech_is_plausible(
            plain_text, duration, plain_segments
        ):
            text, segments, conditioned = plain_text, plain_segments, False
            leak_suspected = True
            log.info("Unconditioned pass corroborates speech; keeping the turn.")
        else:
            raise TranscriptionRejected(
                "That recording did not contain speech. Check the microphone "
                "permission, hold the button, and speak again."
            )

    if is_silence(text):
        raise TranscriptionRejected(
            "That recording did not contain speech. Check the microphone "
            "permission, hold the button, and speak again."
        )

    return Transcript(text=text, segments=segments, conditioned=conditioned,
                      duration=duration, leak_suspected=leak_suspected)


# ===========================================================================
# TEXT TO SPEECH
# ===========================================================================
# Two backends. edge-tts is a reverse-engineered client for an undocumented
# Microsoft websocket; when Microsoft rotates the Sec-MS-GEC handshake the app
# goes mute with no warning and no fix but a version bump. Piper is a local
# ONNX voice: real-time factor ~0.1-0.3 on CPU, so a four-second reply
# synthesises in well under a second -- FASTER than the current network round
# trip, not slower. Voices are 20-60MB, not gigabytes.
#
# TTS_BACKEND=auto (default) tries Piper when a voice is configured and falls
# back to edge-tts. Set piper to make the failure loud instead.

_piper_cache: dict = {}


def _piper_voice(voice_path: str):
    """Lazy, cached. Importing piper at module scope would cost cold start on
    every process that imports core.audio, including the API and the tests."""
    if voice_path in _piper_cache:
        return _piper_cache[voice_path]
    from piper import PiperVoice  # noqa: PLC0415

    _piper_cache[voice_path] = PiperVoice.load(voice_path)
    log.info("Piper voice loaded: %s", voice_path)
    return _piper_cache[voice_path]


def _piper_length_scale(level: str) -> float:
    """Piper controls tempo with length_scale (higher = slower), where edge-tts
    uses a percentage. Map the existing per-level rates onto it so A1 learners
    keep getting slower speech."""
    rate = TTS_RATE.get(level, "+0%")
    try:
        percent = int(rate.replace("%", ""))
    except ValueError:
        percent = 0
    return round(1.0 - percent / 100.0, 3)


def _synthesize_piper_sync(text: str, level: str, out_path: Path) -> bool:
    import wave  # noqa: PLC0415

    voice = _piper_voice(settings.piper_voice_path)
    with wave.open(str(out_path), "wb") as handle:
        voice.synthesize(
            text, handle, length_scale=_piper_length_scale(level)
        )
    return out_path.exists() and out_path.stat().st_size > 512


async def synthesize_piper(text: str, level: str) -> Optional[str]:
    """Local synthesis. Returns None on any failure so the caller can fall back."""
    if not settings.piper_voice_path:
        return None
    out_path = AUDIO_DIR / f"turn_{uuid.uuid4().hex}.wav"
    try:
        ok = await asyncio.wait_for(
            asyncio.to_thread(_synthesize_piper_sync, text, level, out_path),
            timeout=settings.tts_timeout,
        )
        return str(out_path) if ok else None
    except ImportError:
        log.warning("TTS_BACKEND wants Piper but piper-tts is not installed.")
        return None
    except Exception as exc:
        log.warning("Piper synthesis failed: %s", exc)
        return None

async def synthesize(text: str, level: str, voice_id: str) -> Optional[str]:
    """Path to a fresh audio file, or None if every backend refuses.

    edge-tts can exit cleanly having written nothing, so success is judged on
    file size rather than on the absence of an exception. Piper is tried first
    when configured, because a local voice cannot be taken offline by a
    third-party handshake change.
    """
    prune_generated_files()
    clean = re.sub(r"\s+", " ", TTS_STRIP.sub(" ", text or "")).strip()
    clean = clean[: settings.partner_max_chars]
    if not clean:
        return None

    backend = settings.tts_backend
    if backend in ("auto", "piper") and settings.piper_voice_path:
        path = await synthesize_piper(clean, level)
        if path:
            return path
        if backend == "piper":
            log.error("Piper is the configured TTS backend and it failed; no fallback.")
            return None
        log.info("Piper unavailable; falling back to edge-tts.")

    out_path = AUDIO_DIR / f"turn_{uuid.uuid4().hex}.mp3"
    for attempt in (1, 2):
        try:
            communicate = edge_tts.Communicate(
                text=clean, voice=voice_id, rate=TTS_RATE.get(level, "+0%")
            )
            await asyncio.wait_for(communicate.save(str(out_path)), timeout=settings.tts_timeout)
            if out_path.exists() and out_path.stat().st_size > 512:
                return str(out_path)
            log.warning("edge-tts wrote an empty file (attempt %d)", attempt)
        except Exception as exc:
            log.warning("edge-tts failed (attempt %d): %s", attempt, exc)
        await asyncio.sleep(0.3)

    return None


def prune_generated_files_patterns() -> tuple:
    """Piper writes .wav, edge-tts writes .mp3. Both need pruning."""
    return ("turn_*.mp3", "turn_*.wav", "report_*.md")


# ===========================================================================
# WEBRTC READINESS
# ===========================================================================
# When fastrtc lands, transcribe() takes a PCM buffer instead of a path and
# synthesize() becomes an async generator over communicate.stream(). Nothing
# above this line in the package needs to know. Keeping that boundary clean is
# why audio I/O lives in its own module rather than inside the orchestrator.

"""
core.pronunciation
==================
Three providers, chosen by what the learner was actually doing.

    Tier 0  CLARITY      free, always on, no dependencies
            Whisper segment log-probability. A flag, not a score.

    Tier 1  ALIGNMENT    free, local, SCRIPTED TASKS ONLY
            torchaudio forced alignment. Real acoustic evidence, but it
            requires reference text that the learner was *asked* to say.

    Tier 2  AZURE        paid, works on free conversation
            Unscripted assessment against an acoustic model.

WHY TIER 1 CANNOT REPLACE TIER 2  (read before wiring this into conversation)
    Forced alignment aligns audio to KNOWN text. In free conversation the only
    text available is Whisper's transcript — and Whisper already decided what
    it heard, accommodating the mispronunciation as it went. Aligning audio
    against that transcript asks "does this audio match what the recogniser
    thought it heard", which is very nearly circular: a learner who says
    "tree" for "three" gets transcribed "tree" and then aligns to /t r i:/
    beautifully. High score, real error, no detection.

    Forced alignment earns its keep on SCRIPTED tasks, where the reference is
    what you asked them to read, not what a model guessed. That is a genuinely
    good ESL feature — read-aloud, minimal pairs, drilling the sounds their L1
    doesn't have — but it is a DIFFERENT feature from conversational feedback,
    and this module keeps the two apart rather than pretending one covers the
    other. `align_scripted()` refuses to run without an explicit prompt_text.

WHAT NONE OF THESE DO
    None of them asks a language model to infer pronunciation from a
    transcript. Whisper does not emit phonetic misspellings — it decodes with
    a strong language-model prior and snaps to real words. A text model handed
    that repaired text has no acoustic evidence at all, so everything it
    returns is invention, and it would pass the verbatim guardrail because the
    fabricated quote genuinely IS in the transcript.
"""

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Optional

from .config import (
    WHISPER_COMPRESSION_RATIO_LIMIT,
    WHISPER_LOGPROB_UNCLEAR,
    WHISPER_LOGPROB_VERY_UNCLEAR,
    WHISPER_NO_SPEECH_THRESHOLD,
    settings,
)

log = logging.getLogger("cefr.pronunciation")


# ===========================================================================
# TIER 0 — clarity flags from Whisper segment confidence
# ===========================================================================

@dataclass
class ClaritySpan:
    text: str
    start: float
    end: float
    avg_logprob: float
    severity: str          # "unclear" | "very_unclear"

    @property
    def label(self) -> str:
        return "hard to make out" if self.severity == "very_unclear" else "a little unclear"


def clarity_spans(segments: list) -> list:
    """Segments whose decode confidence was poor enough to mention.

    Silence and decoder repetition loops are excluded rather than flagged:
    those are recording faults, not the learner's speech.
    """
    spans = []
    for segment in segments or []:
        try:
            logprob = float(segment.get("avg_logprob", 0.0))
            no_speech = float(segment.get("no_speech_prob", 0.0))
            compression = float(segment.get("compression_ratio", 1.0))
            text = str(segment.get("text", "")).strip()
        except (TypeError, ValueError, AttributeError):
            continue

        if not text or no_speech > WHISPER_NO_SPEECH_THRESHOLD:
            continue
        if compression > WHISPER_COMPRESSION_RATIO_LIMIT:
            continue

        if logprob <= WHISPER_LOGPROB_VERY_UNCLEAR:
            severity = "very_unclear"
        elif logprob <= WHISPER_LOGPROB_UNCLEAR:
            severity = "unclear"
        else:
            continue

        spans.append(ClaritySpan(
            text=text,
            start=float(segment.get("start", 0.0)),
            end=float(segment.get("end", 0.0)),
            avg_logprob=logprob,
            severity=severity,
        ))
    return spans


def render_clarity(spans: list) -> str:
    """Hedged on purpose. A learner told "you mispronounced this" on the
    strength of a decoder confidence number stops trusting the tool the first
    time it is wrong about their accent."""
    if not spans:
        return ""
    lines = ["\n**Speech clarity**"]
    for span in spans[:3]:
        lines.append(f'- "{span.text}" — {span.label}')
    lines.append(
        "\n<span class='muted'>This reflects how clearly the recording came through, "
        "not a pronunciation score. Background noise and microphone quality affect it "
        "too.</span>"
    )
    return "\n".join(lines)


# ===========================================================================
# SHARED RESULT TYPE
# ===========================================================================

@dataclass
class PronunciationReport:
    accuracy: float = 0.0          # 0-100
    fluency: float = 0.0
    completeness: float = 0.0
    prosody: float = 0.0
    overall: float = 0.0
    weak_words: list = field(default_factory=list)   # [{word, accuracy, start, end}]
    long_pauses: list = field(default_factory=list)  # [{after_word, seconds}]
    speech_rate_wpm: float = 0.0
    provider: str = "none"         # none | torchaudio | azure
    scripted: bool = False
    note: str = ""

    @property
    def available(self) -> bool:
        return self.provider != "none"


# ===========================================================================
# TIER 1 — local forced alignment (torchaudio)
# ===========================================================================
#
# CONCURRENCY. `asyncio.to_thread` keeps the event loop free, which is not the
# same as keeping the machine free. CTC inference saturates every core it is
# given, so on a 2-vCPU box one alignment starves every other learner's turn.
# Two guards: a semaphore capping alignment to N concurrent jobs, and an
# explicit torch thread cap. Without these, `concurrency_limit=4` on the Gradio
# event turns into four students queueing behind one PyTorch forward pass.

_align_semaphore: Optional[asyncio.Semaphore] = None
_aligner_cache: dict = {}


def _semaphore() -> asyncio.Semaphore:
    global _align_semaphore
    if _align_semaphore is None:
        _align_semaphore = asyncio.Semaphore(settings.alignment_max_concurrency)
    return _align_semaphore


def _load_aligner():
    """Lazy, cached, and never at import time.

    Importing torch costs several seconds of cold start and a few hundred MB of
    RSS even when alignment is switched off. `core/` must stay importable by a
    worker, a test, or the FastAPI process without paying for that.
    """
    if "bundle" in _aligner_cache:
        return _aligner_cache["bundle"]

    import torch  # noqa: PLC0415 — deliberate lazy import
    import torchaudio

    torch.set_num_threads(settings.alignment_torch_threads)

    bundle = torchaudio.pipelines.MMS_FA
    model = bundle.get_model(with_star=False)
    model.eval()

    _aligner_cache["bundle"] = {
        "torch": torch,
        "torchaudio": torchaudio,
        "model": model,
        "tokenizer": bundle.get_tokenizer(),
        "aligner": bundle.get_aligner(),
        "sample_rate": bundle.sample_rate,
    }
    log.info("Forced-alignment model loaded (threads=%d).", settings.alignment_torch_threads)
    return _aligner_cache["bundle"]


def _normalise_tokens(text: str) -> list:
    import re
    words = re.findall(r"[a-z']+", (text or "").lower())
    return [w for w in words if w]


def _score_to_100(score: float) -> float:
    """MMS_FA emits a mean frame probability in [0,1]. Presenting it raw as a
    percentage overstates precision — it is a likelihood under one acoustic
    model, not a phoneme accuracy. Rounded to whole numbers and always labelled
    as an alignment score in the UI."""
    return round(max(0.0, min(1.0, float(score))) * 100.0, 1)


def _align_sync(audio_path: str, prompt_text: str) -> PronunciationReport:
    ctx = _load_aligner()
    torch, torchaudio = ctx["torch"], ctx["torchaudio"]

    waveform, sample_rate = torchaudio.load(audio_path)
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    if sample_rate != ctx["sample_rate"]:
        waveform = torchaudio.functional.resample(waveform, sample_rate, ctx["sample_rate"])
        sample_rate = ctx["sample_rate"]

    words = _normalise_tokens(prompt_text)
    if not words:
        return PronunciationReport(note="No reference words to align against.")

    with torch.inference_mode():
        emission, _ = ctx["model"](waveform)
        token_spans = ctx["aligner"](emission[0], ctx["tokenizer"](words))

    frames = emission.size(1)
    duration = waveform.size(1) / sample_rate
    ratio = duration / max(frames, 1)

    scored, weak = [], []
    boundaries = []
    for word, spans in zip(words, token_spans):
        if not spans:
            continue
        score = sum(s.score * len(s) for s in spans) / max(sum(len(s) for s in spans), 1)
        start = spans[0].start * ratio
        end = spans[-1].end * ratio
        pct = _score_to_100(score)
        scored.append(pct)
        boundaries.append((word, start, end))
        if pct < settings.alignment_weak_word_threshold:
            weak.append({"word": word, "accuracy": pct,
                         "start": round(start, 2), "end": round(end, 2)})

    if not scored:
        return PronunciationReport(note="Alignment produced no spans.")

    # Fluency from real timing: silence between aligned words. This is the part
    # of the signal that needs no acoustic model to be trustworthy.
    pauses = []
    for (word_a, _, end_a), (_, start_b, _) in zip(boundaries, boundaries[1:]):
        gap = start_b - end_a
        if gap >= settings.alignment_pause_seconds:
            pauses.append({"after_word": word_a, "seconds": round(gap, 2)})

    speech_time = max(duration - sum(p["seconds"] for p in pauses), 0.1)
    wpm = len(boundaries) / speech_time * 60.0

    accuracy = round(sum(scored) / len(scored), 1)
    # Fluency penalty: each long pause costs a fixed amount, floored at 0.
    fluency = round(max(0.0, 100.0 - len(pauses) * settings.alignment_pause_penalty), 1)
    completeness = round(100.0 * len(boundaries) / len(words), 1)

    return PronunciationReport(
        accuracy=accuracy,
        fluency=fluency,
        completeness=completeness,
        overall=round((accuracy * 0.6 + fluency * 0.25 + completeness * 0.15), 1),
        weak_words=sorted(weak, key=lambda w: w["accuracy"])[:5],
        long_pauses=pauses[:5],
        speech_rate_wpm=round(wpm, 1),
        provider="torchaudio",
        scripted=True,
    )


async def align_scripted(audio_path: str, prompt_text: str) -> PronunciationReport:
    """
    Acoustic forced alignment against text the learner was ASKED to say.

    `prompt_text` is mandatory and must be the drill prompt, never a Whisper
    transcript — see the circularity note at the top of this module. Passing a
    transcript here is silently useless rather than loudly wrong, which is why
    it is refused explicitly.

    Degrades to an empty report on any failure (missing torch, missing weights,
    unreadable audio, timeout) so a turn never dies for a pronunciation score.
    """
    if not settings.alignment_enabled:
        return PronunciationReport(note="Local alignment is disabled.")
    if not (prompt_text or "").strip():
        return PronunciationReport(
            note="Forced alignment needs the text the learner was asked to read."
        )

    try:
        async with _semaphore():
            return await asyncio.wait_for(
                asyncio.to_thread(_align_sync, audio_path, prompt_text),
                timeout=settings.alignment_timeout,
            )
    except ImportError:
        log.warning(
            "ALIGNMENT_ENABLED is on but torch/torchaudio are not installed. "
            "Falling back to the Whisper clarity signal."
        )
        return PronunciationReport(note="Alignment dependencies not installed.")
    except asyncio.TimeoutError:
        log.warning("Forced alignment exceeded %.0fs; skipping.", settings.alignment_timeout)
        return PronunciationReport(note="Alignment timed out.")
    except Exception as exc:
        log.warning("Forced alignment failed: %s", exc)
        return PronunciationReport(note="Alignment unavailable for this turn.")


# ===========================================================================
# TIER 2 — Azure Speech Pronunciation Assessment (unscripted-capable)
# ===========================================================================

async def assess_pronunciation(
    audio_path: str, reference_text: Optional[str] = None
) -> PronunciationReport:
    """
    `reference_text=None` selects unscripted assessment, which is what free
    conversation requires. Passing the Whisper transcript would reintroduce the
    circularity described at the top of this module.

    Optional dependency:  pip install azure-cognitiveservices-speech
    """
    if not settings.has_azure_speech:
        return PronunciationReport()

    try:
        import azure.cognitiveservices.speech as speechsdk  # noqa: PLC0415
    except ImportError:
        log.warning(
            "AZURE_SPEECH_KEY is set but azure-cognitiveservices-speech is not "
            "installed. Install it or unset the key."
        )
        return PronunciationReport()

    def _run() -> PronunciationReport:
        speech_config = speechsdk.SpeechConfig(
            subscription=settings.azure_speech_key, region=settings.azure_speech_region
        )
        audio_config = speechsdk.audio.AudioConfig(filename=audio_path)
        pron_config = speechsdk.PronunciationAssessmentConfig(
            reference_text=reference_text or "",
            grading_system=speechsdk.PronunciationAssessmentGradingSystem.HundredMark,
            granularity=speechsdk.PronunciationAssessmentGranularity.Phoneme,
            enable_miscue=bool(reference_text),
        )
        try:
            pron_config.enable_prosody_assessment()
        except AttributeError:
            pass

        recognizer = speechsdk.SpeechRecognizer(
            speech_config=speech_config, language="en-US", audio_config=audio_config
        )
        pron_config.apply_to(recognizer)
        outcome = recognizer.recognize_once()
        if outcome.reason != speechsdk.ResultReason.RecognizedSpeech:
            return PronunciationReport(note="Azure did not recognise speech.")

        result = speechsdk.PronunciationAssessmentResult(outcome)
        weak = []
        for word in getattr(result, "words", []) or []:
            score = float(getattr(word, "accuracy_score", 100.0) or 100.0)
            if score < settings.alignment_weak_word_threshold:
                weak.append({
                    "word": word.word,
                    "accuracy": round(score, 1),
                    "phonemes": [
                        {"phoneme": p.phoneme, "accuracy": round(float(p.accuracy_score), 1)}
                        for p in (getattr(word, "phonemes", []) or [])
                        if float(getattr(p, "accuracy_score", 100) or 100) < 70
                    ],
                })

        return PronunciationReport(
            accuracy=round(float(result.accuracy_score or 0), 1),
            fluency=round(float(result.fluency_score or 0), 1),
            completeness=round(float(result.completeness_score or 0), 1),
            prosody=round(float(getattr(result, "prosody_score", 0) or 0), 1),
            overall=round(float(result.pronunciation_score or 0), 1),
            weak_words=sorted(weak, key=lambda w: w["accuracy"])[:5],
            provider="azure",
            scripted=bool(reference_text),
        )

    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_run), timeout=settings.pronunciation_timeout
        )
    except Exception as exc:
        log.warning("Azure pronunciation assessment failed: %s", exc)
        return PronunciationReport(note="Pronunciation unavailable for this turn.")


# ===========================================================================
# DISPATCH
# ===========================================================================

async def evaluate(audio_path: str, prompt_text: Optional[str] = None) -> PronunciationReport:
    """
    Pick the right provider for what the learner was doing.

      prompt_text given  -> scripted drill. Local alignment first (free, real
                            acoustic evidence against known text), Azure as
                            the upgrade when configured.
      prompt_text None   -> free conversation. Azure only. There is no honest
                            local option here, and returning an empty report is
                            better than returning a circular one.
    """
    if prompt_text:
        if settings.alignment_enabled:
            report = await align_scripted(audio_path, prompt_text)
            if report.available:
                return report
        if settings.has_azure_speech:
            return await assess_pronunciation(audio_path, reference_text=prompt_text)
        return PronunciationReport(note="No pronunciation provider is configured.")

    if settings.has_azure_speech:
        return await assess_pronunciation(audio_path, reference_text=None)
    return PronunciationReport()


def render_pronunciation(report: PronunciationReport) -> str:
    if not report.available:
        return ""

    heading = "**Pronunciation**" if report.provider == "azure" else "**Reading accuracy**"
    lines = [f"\n{heading}"]

    parts = [f"Accuracy {report.accuracy:.0f}", f"Fluency {report.fluency:.0f}"]
    if report.prosody:
        parts.append(f"Prosody {report.prosody:.0f}")
    if report.completeness and report.scripted:
        parts.append(f"Completeness {report.completeness:.0f}")
    lines.append(" · ".join(parts) + " (out of 100)")

    if report.speech_rate_wpm:
        lines.append(f"Speaking rate: {report.speech_rate_wpm:.0f} words per minute")

    if report.weak_words:
        lines.append("\nWords to work on:")
        for word in report.weak_words:
            phonemes = word.get("phonemes") or []
            sounds = ", ".join(p["phoneme"] for p in phonemes[:3])
            detail = f" — sounds: {sounds}" if sounds else ""
            lines.append(f"- **{word['word']}** ({word['accuracy']:.0f}/100){detail}")

    if report.long_pauses:
        spots = ", ".join(f'after "{p["after_word"]}"' for p in report.long_pauses[:3])
        lines.append(f"\nLong pauses: {spots}")

    if report.provider == "torchaudio":
        lines.append(
            "\n<span class='muted'>Scored by matching your audio to the text you were "
            "asked to read. It measures how closely the sounds line up, not individual "
            "phonemes.</span>"
        )
    return "\n".join(lines)

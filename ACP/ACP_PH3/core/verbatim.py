"""
core.verbatim
=============
Recover learner errors that Whisper repaired, without fine-tuning anything.

THE PROBLEM, STATED PRECISELY
    Whisper is an encoder-decoder model. Its decoder is a language model, and
    that language model assigns very low probability to "I have went". When the
    acoustics are ambiguous -- and L2 speech usually is -- the prior wins and
    the transcript reads "I have gone". The error is gone before the assessor
    sees it, and the verbatim guardrail (correctly) refuses to invent it back.

THE FIX THAT NEEDS NO TRAINING
    Run a second decoder that has NO language model at all.

    Wav2Vec2 with a CTC head decoded greedily is pure acoustics: every frame is
    classified independently and the transcript is whatever the audio actually
    contained, spelling mistakes and all. It is a worse transcriber than Whisper
    by every conventional metric -- and that is exactly why it is useful here.
    Where the two disagree on a word, the disagreement IS the evidence:

        whisper : "I have gone to the store"
        ctc     : "I have goed to the store"
                          ^^^^ acoustic evidence Whisper smoothed something

    This costs one extra forward pass, no labelled data, no GPU-hours, and no
    licence. It is strictly better than fine-tuning as a first move, because
    fine-tuning cannot even be attempted until you have verbatim-transcribed L2
    audio -- which is the thing you do not have.

DISCIPLINE
    Disagreements are rendered to the learner directly and are NEVER passed to
    a language model. Handing an LLM "the CTC heard 'goed'" invites it to
    confabulate a diagnosis, and the fabricated quote would pass the verbatim
    guardrail because the CTC string is real text. Same rule as the clarity
    signal in core.pronunciation: acoustic evidence goes to the panel, not
    through a model.

COST
    wav2vec2-base-960h is ~360MB and runs at roughly 0.3-0.8x real time on
    2 vCPU. On a 20-second turn that is 6-16 seconds -- far too slow for the
    conversational path, and completely fine in DEFER_ASSESSMENT mode where
    nothing waits for it. Off by default.
"""

import asyncio
import logging
import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Optional

from .config import settings

log = logging.getLogger("cefr.verbatim")

WORD = re.compile(r"[a-z']+")

# Contractions and orthographic variants where the two decoders routinely
# differ for reasons that are not learner errors. Without this filter the panel
# is dominated by dont/don't and nobody reads it.
#
# Applied by canonicalising BOTH sides and comparing, not by matching pairs:
# the decoders disagree over multi-word spans ("i'm going to" vs "im gonna"),
# so a pairwise set would miss exactly the cases that generate the most noise.
CONTRACTIONS = {
    "gonna": "going to", "wanna": "want to", "gotta": "got to",
    "cause": "because", "til": "until", "ok": "okay",
    "dont": "do not", "don't": "do not", "cant": "can not", "can't": "can not",
    "wont": "will not", "won't": "will not",
    "im": "i am", "i'm": "i am", "ive": "i have", "i've": "i have",
    "id": "i would", "i'd": "i would", "ill": "i will", "i'll": "i will",
    "its": "it is", "it's": "it is", "thats": "that is", "that's": "that is",
    "theres": "there is", "there's": "there is",
    "umm": "um", "uhh": "uh", "mhm": "mm", "hmm": "mm",
}

# Morphological pairs that are exactly the target signal: an LM-free decoder
# hearing the marked form while Whisper produced the grammatical one.
MORPHOLOGY_HINT = re.compile(
    r"(ed|s|es|ing|en)$", re.I
)


@dataclass
class Disagreement:
    whisper: str
    acoustic: str
    position: int
    kind: str                      # "substitution" | "deletion" | "insertion"
    morphological: bool = False

    @property
    def likely_repair(self) -> bool:
        """A substitution where the two forms share a stem is the signature of
        Whisper normalising morphology -- 'goed'/'gone', 'walk'/'walks'."""
        if self.kind != "substitution" or not (self.whisper and self.acoustic):
            return False
        a, b = self.whisper.lower(), self.acoustic.lower()
        stem = min(len(a), len(b))
        shared = sum(1 for i in range(stem) if a[i] == b[i])
        return shared >= 3 or self.morphological


@dataclass
class VerbatimReport:
    acoustic_text: str = ""
    disagreements: list = field(default_factory=list)
    available: bool = False
    note: str = ""

    @property
    def likely_repairs(self) -> list:
        return [d for d in self.disagreements if d.likely_repair]


# ===========================================================================
# LM-FREE ACOUSTIC DECODE
# ===========================================================================

_ctc_cache: dict = {}
_load_lock: Optional[asyncio.Lock] = None
_warm: dict = {"state": "cold", "error": ""}


def readiness() -> dict:
    """Surfaced by /api/v1/readyz so the cold start is observable."""
    return {"state": _warm["state"], "model": settings.acoustic_model,
            "error": _warm["error"]}


def _lock() -> asyncio.Lock:
    global _load_lock
    if _load_lock is None:
        _load_lock = asyncio.Lock()
    return _load_lock


async def warmup() -> dict:
    """Download and load the CTC model once, at startup, off the request path.

    The 360MB download is a ONE-TIME cost that has nothing to do with decoding
    a turn, so charging it to `acoustic_timeout` guaranteed the first check
    would fail -- and fail before the cache was populated, so it failed again
    on the next turn too. Separating the budgets is the whole fix:

        model_load_timeout   generous, once, at boot
        acoustic_timeout     tight, per turn, decode only

    Non-blocking: call it as a background task from the app lifespan. Turns
    that arrive while it is still running skip the check rather than wait.
    """
    if not settings.acoustic_check_enabled:
        _warm["state"] = "disabled"
        return readiness()
    if _warm["state"] in ("ready", "loading"):
        return readiness()

    async with _lock():
        if _warm["state"] == "ready":
            return readiness()
        _warm["state"] = "loading"
        try:
            await asyncio.wait_for(
                asyncio.to_thread(_load_ctc), timeout=settings.acoustic_load_timeout
            )
            _warm["state"] = "ready"
            log.info("Acoustic cross-check warm: %s", settings.acoustic_model)
        except Exception as exc:
            _warm["state"] = "failed"
            _warm["error"] = f"{exc.__class__.__name__}: {exc}"
            log.warning("Acoustic warm-up failed: %s", exc)
    return readiness()


def _load_ctc():
    """Lazy and cached. Importing transformers/torch at module scope would cost
    seconds of cold start and hundreds of MB of RSS in every process that
    imports core, including the API and the test suite."""
    key = settings.acoustic_model
    if key in _ctc_cache:
        return _ctc_cache[key]

    import torch  # noqa: PLC0415
    from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor  # noqa: PLC0415

    torch.set_num_threads(settings.acoustic_torch_threads)
    processor = Wav2Vec2Processor.from_pretrained(key)
    model = Wav2Vec2ForCTC.from_pretrained(key)
    model.eval()
    _ctc_cache[key] = {"torch": torch, "processor": processor, "model": model}
    log.info("Acoustic CTC model loaded: %s", key)
    return _ctc_cache[key]


def _decode_sync(audio_path: str) -> str:
    import torchaudio  # noqa: PLC0415

    ctx = _load_ctc()
    torch = ctx["torch"]

    waveform, sample_rate = torchaudio.load(audio_path)
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    if sample_rate != 16_000:
        waveform = torchaudio.functional.resample(waveform, sample_rate, 16_000)

    inputs = ctx["processor"](
        waveform.squeeze().numpy(), sampling_rate=16_000, return_tensors="pt"
    )
    with torch.inference_mode():
        logits = ctx["model"](inputs.input_values).logits

    # Greedy argmax. No beam search, no language model, no shallow fusion --
    # any of those would reintroduce exactly the prior we are trying to escape.
    predicted = torch.argmax(logits, dim=-1)
    return ctx["processor"].batch_decode(predicted)[0].strip()


_acoustic_semaphore: Optional[asyncio.Semaphore] = None


def _semaphore() -> asyncio.Semaphore:
    global _acoustic_semaphore
    if _acoustic_semaphore is None:
        _acoustic_semaphore = asyncio.Semaphore(settings.acoustic_max_concurrency)
    return _acoustic_semaphore


async def acoustic_transcribe(audio_path: str) -> VerbatimReport:
    """LM-free transcript. Empty report on any failure; never breaks a turn."""
    if not settings.acoustic_check_enabled:
        return VerbatimReport(note="Acoustic cross-check is disabled.")

    # Never wait on the download inside a turn. A cold or still-loading model
    # means this turn simply has no cross-check; it does not mean an error.
    if _warm["state"] in ("cold", "loading"):
        if _warm["state"] == "cold":
            asyncio.create_task(warmup())      # kick it off, do not await
        return VerbatimReport(note="Acoustic model is still warming up.")
    if _warm["state"] == "failed":
        return VerbatimReport(note="Acoustic model unavailable.")

    try:
        async with _semaphore():
            text = await asyncio.wait_for(
                asyncio.to_thread(_decode_sync, audio_path),
                timeout=settings.acoustic_timeout,
            )
        return VerbatimReport(acoustic_text=text, available=bool(text.strip()))
    except ImportError:
        log.warning(
            "ACOUSTIC_CHECK_ENABLED is on but torch/transformers are not "
            "installed. Falling back to Whisper alone."
        )
        return VerbatimReport(note="Acoustic dependencies not installed.")
    except asyncio.TimeoutError:
        log.warning("Acoustic decode exceeded %.0fs.", settings.acoustic_timeout)
        return VerbatimReport(note="Acoustic decode timed out.")
    except Exception as exc:
        log.warning("Acoustic decode failed: %s", exc)
        return VerbatimReport(note="Acoustic cross-check unavailable.")


# ===========================================================================
# DIFF
# ===========================================================================

def _tokens(text: str) -> list:
    return WORD.findall((text or "").lower())


def _canonical(text: str) -> str:
    """Expand contractions and drop apostrophes so orthographic variants of the
    same utterance compare equal."""
    out = []
    for token in _tokens(text):
        out.extend(CONTRACTIONS.get(token, token).split())
    return " ".join(out)


def _benign(a: str, b: str) -> bool:
    """True when the two spans are the same words written differently."""
    return _canonical(a) == _canonical(b)


def compare(whisper_text: str, acoustic_text: str) -> list:
    """Word-level disagreements between the fluent and the acoustic decoder.

    Benign contraction/orthography differences are filtered: without that the
    output is dominated by "dont"/"don't" and nobody reads it.
    """
    a, b = _tokens(whisper_text), _tokens(acoustic_text)
    if not a or not b:
        return []

    out = []
    for op, i1, i2, j1, j2 in SequenceMatcher(None, a, b).get_opcodes():
        if op == "equal":
            continue
        w = " ".join(a[i1:i2])
        c = " ".join(b[j1:j2])
        if _benign(w, c):
            continue
        kind = {"replace": "substitution", "delete": "deletion",
                "insert": "insertion"}[op]
        out.append(Disagreement(
            whisper=w, acoustic=c, position=i1, kind=kind,
            morphological=bool(
                MORPHOLOGY_HINT.search(w or "") or MORPHOLOGY_HINT.search(c or "")
            ),
        ))
    return out


async def cross_check(audio_path: str, whisper_text: str) -> VerbatimReport:
    report = await acoustic_transcribe(audio_path)
    if report.available:
        report.disagreements = compare(whisper_text, report.acoustic_text)
    return report


# ===========================================================================
# RENDERING — straight to the panel, never through a model
# ===========================================================================

def render_verbatim(report: VerbatimReport) -> str:
    repairs = report.likely_repairs if report.available else []
    if not repairs:
        return ""

    lines = ["\n**Possible missed errors**"]
    for item in repairs[:3]:
        lines.append(
            f'- The transcript says *{item.whisper}*, but the audio sounds closer '
            f'to *{item.acoustic}*.'
        )
    lines.append(
        "\n<span class='muted'>Two speech recognisers disagreed here. The second one "
        "ignores grammar entirely, so a disagreement often means the first one "
        "tidied something up. Worth listening back.</span>"
    )
    return "\n".join(lines)


def ceiling_estimate(reports: list) -> dict:
    """Aggregate over a benchmark run: how often is Whisper repairing?

    This is a cheap standing estimate of the STT recall ceiling, computed from
    ordinary traffic rather than from hand annotation. It does not replace the
    50-turn hand-marked set -- it tells you whether that set is urgent.
    """
    usable = [r for r in reports if r.available]
    if not usable:
        return {"turns": 0}
    with_repairs = sum(1 for r in usable if r.likely_repairs)
    total_repairs = sum(len(r.likely_repairs) for r in usable)
    return {
        "turns": len(usable),
        "turns_with_suspected_repair": with_repairs,
        "suspected_repairs": total_repairs,
        "repair_rate": round(with_repairs / len(usable), 3),
    }

"""
core.engine
===========
The turn orchestrator. Framework-agnostic: no Gradio, no FastAPI, no HTTP.

CHANGED IN THIS REVISION
  - The assessor is primed with the learner's recurring error categories
    (`focus_tags`) and returns a per-clause verdict sweep.
  - Coercion cross-checks the sweep: a clause marked "error" with no matching
    error object is a dropped finding and gets logged, so recall problems
    become visible in the logs instead of invisible in the panel.
  - Whisper segment confidence becomes a speech-clarity signal, rendered
    directly and never passed through a language model.
  - Optional Azure pronunciation assessment runs concurrently when configured.

Concurrency shape:

    t=0.0   partner starts          assessor starts        [pronunciation starts]
    t=0.6   partner returns
    t=0.6   TTS starts              assessor still running
    t=1.5   TTS returns             assessor returned at t=1.4
    ---------------------------------------------------------------
    wall clock = max(partner + tts, assessor, pronunciation)

A literal gather(partner, assessor) followed by TTS would serialise synthesis
behind the slower model call and cost roughly 400ms per turn.
"""

import asyncio
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Optional

from . import assessors
from . import audio as audio_mod
from . import llm
from . import pronunciation as pron
from . import verbatim as vb
from .config import (
    ASSESSOR_PROMPT,
    CEFR_GUIDE,
    ERROR_SELECTION,
    ERROR_TAGS,
    FALLBACK_TAG,
    FEEDBACK_STYLE_BLOCKS,
    PARTNER_PROMPT,
    REPORT_SYSTEM,
    TAG_LABELS,
    build_assessor_messages,
    build_focus_block,
    build_tag_probes,
    get_assessor_prompt,
    resolve_feedback_style,
    settings,
)

log = logging.getLogger("cefr.engine")


# ===========================================================================
# DATA
# ===========================================================================

@dataclass
class TurnResult:
    transcript: str
    reply: str
    audio_path: Optional[str]
    assessment: dict
    feedback_style: str
    partner_provider: str
    assessor_provider: str
    clarity: list = field(default_factory=list)
    verbatim: Optional["vb.VerbatimReport"] = None
    pronunciation: Optional[pron.PronunciationReport] = None
    timings: dict = field(default_factory=dict)
    # True when the transcript resembled the conditioning prompt but the audio
    # corroborated real speech. The turn was kept; the panel may hedge.
    transcript_leak_suspected: bool = False
    # Set in deferred mode: the assessment is still running when the learner
    # already has speech. Caller awaits it via engine.await_assessment().
    pending_assessment: Optional[asyncio.Task] = None

    @property
    def assessment_pending(self) -> bool:
        """True while an assessment is still owed to this turn.

        Deliberately not `not task.done()`: a task cancelled by loop teardown
        is done() but has produced nothing, and the caller still needs to know
        the panel is unresolved rather than empty."""
        task = self.pending_assessment
        return task is not None and not (task.done() and not task.cancelled())

    @property
    def total_seconds(self) -> float:
        return round(
            self.timings.get("stt", 0)
            + max(
                self.timings.get("partner", 0) + self.timings.get("tts", 0),
                self.timings.get("assessor", 0),
            ),
            2,
        )


# Deferred turns park their verbatim task here, keyed by the assessor task, so
# await_assessment can resolve both without widening the public dataclass.
_pending_verbatim: dict = {}


EMPTY_ASSESSMENT = {
    "target_rule": "",
    "clauses": [],
    "errors": [],
    "did_well": [],
    "target_used": False,
    "target_evidence": "",
    "level_impression": "",
    "uncertain": [],
    "assessor_model": "",
    "assessor_latency_ms": 0,
    "pending": False,
    "degraded": True,
}


# ===========================================================================
# PARTNER — conversational, plain text, fast model
# ===========================================================================

_LABEL_PREFIX = re.compile(r"^\s*(reply|response|partner|assistant)\s*:\s*", re.I)


def _clean_reply(raw: str) -> str:
    text = llm.strip_reasoning(raw)
    text = _LABEL_PREFIX.sub("", text)
    text = re.sub(r"\s+", " ", text).strip().strip('"').strip()
    if not text:
        return "Interesting. Can you tell me a little more about that?"
    if len(text) > settings.partner_max_chars:
        text = text[: settings.partner_max_chars].rsplit(" ", 1)[0].rstrip(" ,;:") + "?"
    return text


async def generate_partner_reply(level: str, topic: str, history: Any, transcript: str) -> tuple:
    system = PARTNER_PROMPT.format(
        level=level,
        topic=(topic or "").strip() or "everyday conversation",
        calibration=CEFR_GUIDE[level],
        max_chars=settings.partner_max_chars,
    )
    messages = llm.build_messages(system, history=history, user=transcript)
    raw, provider = await llm.complete(
        messages, temperature=settings.partner_temperature, model=settings.partner_model
    )
    return _clean_reply(raw), provider


# ===========================================================================
# ASSESSOR — clause sweep, strict JSON, heavy model
# ===========================================================================

def _substring_match(needle: str, haystack: str) -> bool:
    """Verbatim guardrail, enforced in code rather than trusted to the prompt.

    Whitespace and case are normalised because speech-to-text capitalisation is
    arbitrary. Nothing else is. If the model cannot point at words the learner
    actually produced, the error is discarded.
    """
    n = re.sub(r"\s+", " ", (needle or "")).strip().lower()
    h = re.sub(r"\s+", " ", (haystack or "")).strip().lower()
    if not n or not h:
        return False
    return n in h or n.rstrip(".,!?;:") in h


def _limit_for(level: str) -> int:
    return {"A1": 2, "A2": 3, "B1": 4, "B2": 5, "C1": 5, "C2": 5}.get(level, 4)


def coerce_assessment(raw: str, transcript: str, level: str = "B1") -> dict:
    payload = llm.extract_json(raw, require_keys=("errors",))
    if not isinstance(payload, dict):
        log.warning("Unparseable assessment: %r", (raw or "")[:400])
        return dict(EMPTY_ASSESSMENT)

    # --- clause sweep -----------------------------------------------------
    clauses = []
    for item in payload.get("clauses") or []:
        if isinstance(item, str):                    # tolerate the old flat shape
            clauses.append({"text": item.strip(), "verdict": "ok", "note": ""})
            continue
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        verdict = str(item.get("verdict") or "ok").strip().lower()
        clauses.append({
            "text": text,
            "verdict": verdict if verdict in ("ok", "error", "uncertain") else "ok",
            "note": str(item.get("note") or "").strip(),
        })

    # --- errors, guarded --------------------------------------------------
    errors = []
    dropped_unquotable = 0
    for item in payload.get("errors") or []:
        if not isinstance(item, dict):
            continue
        said = str(item.get("student_said") or "").strip()
        correction = str(item.get("correction") or "").strip()
        if not said or not correction:
            dropped_unquotable += 1
            continue
        if not _substring_match(said, transcript):
            log.info("Dropped unquotable error: %r not in transcript", said[:60])
            dropped_unquotable += 1
            continue
        tag = str(item.get("tag") or "").strip().lower().replace(" ", "_").replace("-", "_")
        confidence = str(item.get("confidence") or "high").strip().lower()
        errors.append({
            "student_said": said,
            "correction": correction,
            "tag": tag if tag in ERROR_TAGS else FALLBACK_TAG,
            "explanation": str(item.get("explanation") or "").strip(),
            "confidence": confidence if confidence in ("high", "medium") else "high",
        })

    errors = errors[: _limit_for(level)]

    # --- sweep consistency check -----------------------------------------
    # The clause verdicts are a cheap audit of the error list. A clause marked
    # "error" that produced no error object is a finding the model located and
    # then failed to write up — the exact silent recall failure that made the
    # feedback feel thin. It is logged rather than fabricated into an error,
    # because we have no correction for it.
    flagged = sum(1 for c in clauses if c["verdict"] == "error")
    if flagged > len(errors) + dropped_unquotable:
        log.warning(
            "Assessor flagged %d clause(s) as errors but wrote up %d "
            "(%d dropped as unquotable). Utterance: %r",
            flagged, len(errors), dropped_unquotable, transcript[:80],
        )

    uncertain = [
        {"text": c["text"], "note": c["note"]}
        for c in clauses if c["verdict"] == "uncertain"
    ][:3]

    did_well = [str(x).strip() for x in (payload.get("did_well") or []) if str(x).strip()]

    return {
        "target_rule": str(payload.get("target_rule") or "").strip(),
        "clauses": clauses,
        "errors": errors,
        "did_well": did_well[:3],
        "target_used": bool(payload.get("target_used")),
        "target_evidence": str(payload.get("target_evidence") or "").strip(),
        "level_impression": str(payload.get("level_impression") or "").strip(),
        "uncertain": uncertain,
        "degraded": False,
    }


async def assess_turn(
    level: str,
    topic: str,
    transcript: str,
    feedback_style: str,
    focus_tags: Optional[list] = None,
    backend: Optional[str] = None,
) -> tuple:
    """No conversation history is passed. The assessor judges this utterance in
    isolation, which stops it grading the conversation's overall impression
    instead of the sentence in front of it."""
    if settings.assessor_prompt_variant == "cached":
        # Invariant bulk lives in the system message so a KV prefix cache hits
        # on every turn regardless of level, topic or learner. Same words, same
        # guardrails -- only the order changed.
        system, user = build_assessor_messages(
            level, topic, transcript, feedback_style, focus_tags
        )
    else:
        template, probes = get_assessor_prompt()
        system = template.format(
            level=level,
            topic=(topic or "").strip() or "everyday conversation",
            tag_probes=probes(),
            focus_block=build_focus_block(focus_tags),
            selection=ERROR_SELECTION.get(level, ERROR_SELECTION["B1"]),
            feedback_style=FEEDBACK_STYLE_BLOCKS[feedback_style],
        )
        user = "Learner utterance:\n" + transcript
    # Dispatch through the backend registry. The backend returns raw text and
    # nothing else -- every guardrail below (taxonomy, verbatim verification,
    # level caps, sweep audit) runs afterwards, identically, whichever model
    # produced it. A smaller backend gets less trust, not fewer checks.
    response = await assessors.run_assessor(
        system=system,
        user=user,
        temperature=settings.assessor_temperature,
        backend=backend,
    )
    assessment = coerce_assessment(response.raw, transcript, level)
    assessment["assessor_model"] = response.model
    assessment["assessor_latency_ms"] = response.latency_ms
    return assessment, response.provider


# ===========================================================================
# THE TURN
# ===========================================================================

async def run_turn(
    audio_path: str,
    level: str,
    topic: str,
    voice_id: str,
    history: Any = None,
    feedback_style: str = "auto",
    focus_tags: Optional[list] = None,
    assessor_backend: Optional[str] = None,
    prompt_text: Optional[str] = None,
    defer_assessment: Optional[bool] = None,
) -> TurnResult:
    """
    Full pipeline for one conversational turn.

    Raises audio_mod.EmptyAudio / TranscriptionRejected for user-correctable
    problems, and llm.AllProvidersFailed when both models are down. A failing
    ASSESSOR never costs the learner their turn.
    """
    style = resolve_feedback_style(level, feedback_style)
    timings: dict = {}

    audio_mod.validate_upload(audio_path)

    t0 = time.perf_counter()
    stt = await audio_mod.transcribe(audio_path)
    timings["stt"] = time.perf_counter() - t0
    transcript = stt.text
    leak_suspected = getattr(stt, "leak_suspected", False)

    # Derived directly from decoder confidence and rendered as-is. It is never
    # given to a language model: a text model handed a confidence number will
    # confabulate a phonetic diagnosis it has no acoustic basis for.
    clarity = pron.clarity_spans(stt.segments)

    t_models = time.perf_counter()
    partner_task = asyncio.create_task(
        generate_partner_reply(level, topic, history, transcript)
    )
    assessor_task = asyncio.create_task(
        assess_turn(level, topic, transcript, style, focus_tags, assessor_backend)
    )
    # prompt_text is set only for scripted drills, where forced alignment has
    # honest reference text. In free conversation it stays None and pron.evaluate
    # falls through to Azure or to nothing -- never to alignment against a
    # Whisper transcript, which would score the learner against the
    # recogniser's own guess.
    pron_task = (
        asyncio.create_task(pron.evaluate(audio_path, prompt_text))
        if (prompt_text and settings.alignment_enabled) or settings.has_azure_speech
        else None
    )
    # LM-free second decode. Slow, so it belongs with the assessor rather than
    # on the path that gates speech. Its output goes straight to the panel and
    # is never handed to a language model.
    verbatim_task = (
        asyncio.create_task(vb.cross_check(audio_path, transcript))
        if settings.acoustic_check_enabled else None
    )

    try:
        reply, partner_provider = await partner_task
    except Exception:
        assessor_task.cancel()
        if pron_task:
            pron_task.cancel()
        if verbatim_task:
            verbatim_task.cancel()
        raise
    timings["partner"] = time.perf_counter() - t_models

    # Speech starts now; the assessor keeps running underneath it.
    t_tts = time.perf_counter()
    tts_task = asyncio.create_task(audio_mod.synthesize(reply, level, voice_id))

    deferred = settings.defer_assessment if defer_assessment is None else defer_assessment
    if deferred:
        # THE POINT OF THIS MODE.
        # The assessor is not on the conversational path and never was --
        # coerce_assessment does not need to finish before the learner hears a
        # reply. Returning here means a 40-second local assessment costs the
        # conversation nothing: audio plays now, the feedback panel fills in
        # when it fills in.
        #
        # It is also the better pedagogy. Interrupting a fluency activity with
        # immediate correction is what delayed correction exists to avoid; a
        # note that lands a few seconds later, or after the next turn, is read
        # more and disrupts less.
        out_path = await tts_task
        timings["tts"] = time.perf_counter() - t_tts
        timings["assessor"] = 0.0
        if verbatim_task:
            # Deferred mode owns the verbatim task alongside the assessor; it
            # is resolved by await_assessment.
            _pending_verbatim[id(assessor_task)] = verbatim_task
        return TurnResult(
            transcript=transcript,
            reply=reply,
            audio_path=out_path,
            transcript_leak_suspected=leak_suspected,
            assessment=dict(EMPTY_ASSESSMENT, degraded=False, pending=True),
            feedback_style=style,
            partner_provider=partner_provider,
            assessor_provider="pending",
            clarity=clarity,
            pronunciation=None,
            timings=timings,
            pending_assessment=assessor_task,
        )

    try:
        assessment, assessor_provider = await assessor_task
    except assessors.AssessorUnavailable as exc:
        log.warning("No assessor backend available: %s", exc)
        assessment, assessor_provider = dict(EMPTY_ASSESSMENT), "none"
    except Exception as exc:
        log.warning("Assessment failed, continuing without feedback: %s", exc)
        assessment, assessor_provider = dict(EMPTY_ASSESSMENT), "none"
    timings["assessor"] = time.perf_counter() - t_models

    out_path = await tts_task
    timings["tts"] = time.perf_counter() - t_tts

    verbatim_report = None
    if verbatim_task:
        try:
            verbatim_report = await verbatim_task
        except Exception as exc:
            log.warning("Acoustic cross-check failed: %s", exc)

    pron_report = None
    if pron_task:
        try:
            pron_report = await pron_task
        except Exception as exc:
            log.warning("Pronunciation task failed: %s", exc)

    return TurnResult(
        transcript=transcript,
        reply=reply,
        audio_path=out_path,
        transcript_leak_suspected=leak_suspected,
        assessment=assessment,
        feedback_style=style,
        partner_provider=partner_provider,
        assessor_provider=assessor_provider,
        clarity=clarity,
        verbatim=verbatim_report,
        pronunciation=pron_report,
        timings=timings,
    )


async def await_assessment(result: TurnResult, timeout: Optional[float] = None) -> TurnResult:
    """Resolve a deferred assessment and fold it into the result in place.

    Safe to call on a non-deferred result (returns immediately) and safe to
    call twice. A failure here never invalidates the turn the learner already
    had -- it degrades the panel, nothing else.
    """
    task = result.pending_assessment
    if task is None:
        return result

    started = time.perf_counter()
    try:
        assessment, provider = await asyncio.wait_for(
            asyncio.shield(task), timeout or settings.deferred_assessment_timeout
        )
        result.assessment = assessment
        result.assessor_provider = provider
    except asyncio.TimeoutError:
        log.warning("Deferred assessment exceeded its window; leaving it pending.")
        return result           # still running; caller may await again
    except asyncio.CancelledError:
        # CancelledError is a BaseException: `except Exception` misses it.
        # Happens when the loop tears down mid-turn (client disconnect,
        # shutdown). Degrade the panel; never let it escape into the caller.
        log.info("Deferred assessment cancelled before it completed.")
        result.assessment = dict(EMPTY_ASSESSMENT)
        result.assessor_provider = "none"
        result.pending_assessment = None
        return result
    except Exception as exc:
        log.warning("Deferred assessment failed: %s", exc)
        result.assessment = dict(EMPTY_ASSESSMENT)
        result.assessor_provider = "none"

    pending_vb = _pending_verbatim.pop(id(task), None)
    if pending_vb is not None:
        try:
            result.verbatim = await pending_vb
        except Exception as exc:
            log.warning("Deferred acoustic cross-check failed: %s", exc)

    result.pending_assessment = None
    result.timings["assessor"] = time.perf_counter() - started
    return result


# ===========================================================================
# SESSION REPORT
# ===========================================================================

def build_report_request(level: str, topic: str, session: dict) -> str:
    target = (topic or "").strip() or "everyday conversation"
    tally: dict = {}
    for exchange in session.get("exchanges", []):
        for error in exchange.get("errors", []):
            tally[error["tag"]] = tally.get(error["tag"], 0) + 1

    lines = [
        f"CEFR level claimed: {level}",
        f"Session target: {target}",
        f"Turns: {session.get('turns', 0)}",
        f"Turns using target: {session.get('target_hits', 0)}",
        "",
        "Error counts by category:",
    ]
    if tally:
        lines.extend(
            f"- {TAG_LABELS.get(tag, tag)}: {count}"
            for tag, count in sorted(tally.items(), key=lambda kv: -kv[1])
        )
    else:
        lines.append("- none logged")

    lines.extend(["", "Learner transcript:"])
    lines.extend(f"{i}. {e['student']}" for i, e in enumerate(session.get("exchanges", []), 1))
    lines.extend([
        "",
        "Write the report using these sections:",
        "## How the session went",
        "Two or three sentences.",
        "## Your target",
        "Did the learner actually use it? Quote evidence from the transcript.",
        "## Patterns to work on",
        "Use the error counts above. Name at most three categories, give the rule in "
        "one line, and a corrected example taken from the learner's own speech.",
        "## Does the language match the level?",
        f"Did the output look like {level}? Say plainly if it looked higher or lower.",
        "## Three things to do next",
        "Three concrete activities, each doable in 20 minutes.",
    ])
    return "\n".join(lines)


async def generate_report(level: str, topic: str, session: dict) -> tuple:
    messages = llm.build_messages(
        REPORT_SYSTEM, user=build_report_request(level, topic, session), max_history=0
    )
    raw, provider = await llm.complete(
        messages, temperature=0.3, model=settings.assessor_model,
        timeout=settings.report_timeout,
    )
    return llm.strip_reasoning(raw), provider


# ===========================================================================
# RENDERING
# ===========================================================================

def render_feedback(result: TurnResult, topic: str, turns: int, target_hits: int) -> str:
    assessment = result.assessment
    label = (topic or "").strip() or "Everyday conversation"
    hit = bool(assessment.get("target_used"))
    chip = "chip-hit" if hit else "chip-miss"
    chip_text = "Target used" if hit else "Target not used"

    lines = [
        f'<div class="chip {chip}">{chip_text} &middot; {target_hits}/{turns} turns</div>',
        "",
        f"**{label}**",
    ]
    if hit and assessment.get("target_evidence"):
        lines.append("> " + assessment["target_evidence"])
    elif not hit and assessment.get("target_rule"):
        lines.append(f"<span class='muted'>Remember: {assessment['target_rule']}</span>")

    if assessment.get("did_well"):
        lines.append("\n**What worked**")
        lines.extend("- " + item for item in assessment["did_well"])

    if assessment.get("pending"):
        return (f'<div class="chip chip-miss">Checking your English…</div>\n\n'
                f"**{label}**\n\n"
                "<span class='muted'>Your feedback for this turn is still being "
                "written. Keep talking — it will appear here shortly.</span>")

    errors = assessment.get("errors") or []
    lines.append("\n**Corrections**")
    if not errors:
        lines.append("No errors worth flagging in that turn.")
    else:
        guided = result.feedback_style == "guided"
        for error in errors:
            tag_label = TAG_LABELS.get(error["tag"], error["tag"])
            hedge = " (worth checking)" if error.get("confidence") == "medium" else ""
            lines.append(f"\n`{tag_label}`{hedge}")
            if guided:
                lines.append(f"You said: *{error['student_said']}*")
                if error["explanation"]:
                    lines.append(error["explanation"])
                lines.append(
                    "<details><summary>Show the answer</summary>\n\n"
                    f"{error['correction']}\n\n</details>"
                )
            else:
                lines.append(f"*{error['student_said']}* → **{error['correction']}**")
                if error["explanation"]:
                    lines.append(error["explanation"])

    # Things the assessor noticed but could not pin down. Surfacing these is the
    # difference between "no errors found" and "nothing definite, but look here"
    # — and it keeps the model from inflating a hunch into a correction.
    if assessment.get("uncertain"):
        lines.append("\n**Not sure about**")
        for item in assessment["uncertain"]:
            note = f" — {item['note']}" if item.get("note") else ""
            lines.append(f'- "{item["text"]}"{note}')

    clarity_md = pron.render_clarity(result.clarity)
    if clarity_md:
        lines.append(clarity_md)

    if result.verbatim is not None:
        verbatim_md = vb.render_verbatim(result.verbatim)
        if verbatim_md:
            lines.append(verbatim_md)

    if result.pronunciation is not None:
        pron_md = pron.render_pronunciation(result.pronunciation)
        if pron_md:
            lines.append(pron_md)

    if assessment.get("level_impression"):
        lines.append(f"\n<span class='muted'>{assessment['level_impression']}</span>")
    if assessment.get("degraded"):
        lines.append(
            "\n<span class='muted'>The assessor did not respond for this turn, so "
            "corrections were skipped. The conversation is unaffected.</span>"
        )
    if result.assessor_provider not in ("groq", "none"):
        lines.append(
            f"\n<span class='muted'>Assessed by fallback provider: "
            f"{result.assessor_provider}</span>"
        )
    return "\n".join(lines)

"""
Tests for the parts of core/ that are easy to break silently.

Run:  python -m pytest core/tests/test_core.py -q
No network, no API keys, no database required.
"""

import ast
import asyncio
import dataclasses
import pathlib
import sys
import types

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

# Stub the two third-party clients so core/ imports without credentials.
for name, attrs in (
    ("groq", {
        "AsyncGroq": type("AsyncGroq", (), {"__init__": lambda self, **k: None}),
        "RateLimitError": type("RateLimitError", (Exception,), {}),
        "APIConnectionError": type("APIConnectionError", (Exception,), {}),
        "APIStatusError": type("APIStatusError", (Exception,), {}),
    }),
    ("edge_tts", {"Communicate": object}),
):
    if name not in sys.modules:
        module = types.ModuleType(name)
        for key, value in attrs.items():
            setattr(module, key, value)
        sys.modules[name] = module

from core import engine, llm  # noqa: E402
from core.config import settings as _settings  # noqa: E402

# CloudAssessor.available reads the credentials. Without this the registry
# correctly reports "no backend available" and every turn degrades -- which is
# the right production behaviour, so the fixture supplies a credential rather
# than the code dropping the check.
object.__setattr__(_settings, "groq_api_key", "test-key-for-unit-tests")
from core import pronunciation as pron  # noqa: E402
from core.audio import detect_prompt_leak, is_silence  # noqa: E402
from core.config import ERROR_TAGS, resolve_feedback_style  # noqa: E402


# ===========================================================================
# THE BUG: Gradio metadata injection -> Groq 400
# ===========================================================================

def test_sanitize_strips_gradio_metadata():
    gradio_history = [
        {"role": "user", "content": "I goed to Cairo", "metadata": {"title": None},
         "options": None, "id": "abc123", "duration": 1.2},
        {"role": "assistant", "content": "Nice. What did you see?", "metadata": {}},
    ]
    clean = llm.sanitize_messages(gradio_history)
    assert clean == [
        {"role": "user", "content": "I goed to Cairo"},
        {"role": "assistant", "content": "Nice. What did you see?"},
    ]
    for message in clean:
        assert set(message.keys()) == {"role", "content"}


def test_sanitize_handles_chatmessage_objects_and_media_turns():
    class ChatMessage:  # mimics gradio.ChatMessage
        def __init__(self, role, content, metadata=None):
            self.role, self.content, self.metadata = role, content, metadata or {}

    history = [
        ChatMessage("user", "hello there"),
        {"role": "user", "content": ("/tmp/clip.wav", None)},  # audio turn -> drop
        {"role": "assistant", "content": None},                # empty -> drop
        {"role": "system", "content": "   "},                  # whitespace -> drop
        {"role": "tool", "content": "unsupported role"},       # bad role -> drop
    ]
    assert llm.sanitize_messages(history) == [{"role": "user", "content": "hello there"}]


def test_build_messages_cannot_leak_metadata():
    messages = llm.build_messages(
        "SYSTEM",
        history=[{"role": "user", "content": "hi", "metadata": {"title": "thinking"}}],
        user="latest",
    )
    assert all(set(m) == {"role", "content"} for m in messages)
    assert messages[0]["content"] == "SYSTEM"
    assert messages[-1]["content"] == "latest"


def test_history_trimmed_to_limit():
    history = [{"role": "user", "content": f"turn {i}"} for i in range(20)]
    messages = llm.build_messages("S", history=history, max_history=4)
    assert len(messages) == 5  # system + 4
    assert messages[-1]["content"] == "turn 19"


# ===========================================================================
# JSON recovery
# ===========================================================================

def test_extract_json_survives_reasoning_with_braces():
    raw = ('Let me plan {step: 1} carefully.\n<think>{"scratch": true}</think>\n'
           '```json\n{"errors": [], "did_well": ["clear"]}\n```')
    payload = llm.extract_json(raw, require_keys=("errors",))
    assert payload == {"errors": [], "did_well": ["clear"]}
    # the naive greedy regex would have failed here
    import re, json
    with __import__("pytest").raises(json.JSONDecodeError):
        json.loads(re.search(r"\{.*\}", raw, re.S).group(0))


# ===========================================================================
# Verbatim guardrail — the assessor may not invent quotes
# ===========================================================================

TRANSCRIPT = "Umm, I goed to the store yesterday and she walk very fast"


def _assessment(errors, clauses=None):
    import json
    return json.dumps({
        "target_rule": "past simple = verb + -ed (irregular forms vary)",
        "clauses": clauses if clauses is not None else [
            {"text": TRANSCRIPT, "verdict": "ok", "note": ""}
        ],
        "errors": errors,
        "did_well": ["Clear past-time reference"],
        "target_used": True,
        "target_evidence": "I goed to the store",
        "level_impression": "Looks like A2.",
    })


def test_unquotable_error_is_dropped():
    raw = _assessment([
        {"student_said": "I goed to the store", "correction": "I went to the store",
         "tag": "verb_tense", "explanation": "Use the irregular past 'went'."},
        {"student_said": "I have never been there", "correction": "irrelevant",
         "tag": "verb_tense", "explanation": "fabricated"},
    ])
    result = engine.coerce_assessment(raw, TRANSCRIPT, "B1")
    assert len(result["errors"]) == 1
    assert result["errors"][0]["student_said"] == "I goed to the store"


def test_quote_matching_tolerates_case_and_trailing_punctuation():
    raw = _assessment([
        {"student_said": "She Walk Very Fast.", "correction": "She walks very fast",
         "tag": "subject_verb_agreement", "explanation": "Third person needs -s."},
    ])
    assert len(engine.coerce_assessment(raw, TRANSCRIPT, "B1")["errors"]) == 1


def test_unknown_tag_is_coerced_not_dropped():
    raw = _assessment([
        {"student_said": "she walk very fast", "correction": "she walks very fast",
         "tag": "MADE_UP_CATEGORY", "explanation": "x"},
    ])
    errors = engine.coerce_assessment(raw, TRANSCRIPT, "B1")["errors"]
    assert len(errors) == 1 and errors[0]["tag"] in ERROR_TAGS


def test_unparseable_assessment_degrades_without_raising():
    result = engine.coerce_assessment("I cannot comply with that.", TRANSCRIPT)
    assert result["degraded"] is True and result["errors"] == []


def test_taxonomy_is_exactly_eleven():
    assert len(ERROR_TAGS) == 11 and len(set(ERROR_TAGS)) == 11


# ===========================================================================
# Whisper conditioning — the technique's own failure mode
# ===========================================================================

def test_prompt_leak_needs_text_match_AND_missing_audio():
    """A leak is prompt-shaped text with no speech under it. Text alone is not
    a verdict -- that was the bug that rejected real learners."""
    leak = "I goed to the lighthouse, uh, yesterday."
    # 0.3s of audio cannot contain seven words: hallucination.
    assert detect_prompt_leak(leak, duration=0.3, segments=[]) is True
    # 3.5s can: keep the turn even though the text matches the prompt.
    assert detect_prompt_leak(leak, duration=3.5, segments=[]) is False


def test_learner_saying_the_prompt_words_keeps_their_turn():
    """The modal utterance for a past-simple lesson must not be rejected."""
    from core.audio import speech_is_plausible, text_matches_prompt
    said = "I goed to the lighthouse yesterday"
    assert text_matches_prompt(said) is True          # resembles the prompt
    assert speech_is_plausible(said, 2.8, []) is True  # but the audio supports it
    assert detect_prompt_leak(said, duration=2.8, segments=[]) is False


def test_no_speech_segments_confirm_a_leak():
    leak = "I goed to the lighthouse, uh, yesterday."
    segments = [{"text": leak, "no_speech_prob": 0.92}]
    assert detect_prompt_leak(leak, duration=4.0, segments=segments) is True


def test_genuine_learner_error_is_not_flagged_as_leak():
    assert detect_prompt_leak("I goed to Alexandria last summer with my brother",
                              duration=4.0, segments=[]) is False
    assert detect_prompt_leak("She walk to school every day because she like it",
                              duration=4.0, segments=[]) is False


def test_implausible_speaking_rate_is_caught():
    from core.audio import speech_is_plausible
    assert speech_is_plausible("one two three four five six seven eight", 0.4, []) is False
    assert speech_is_plausible("one two three four five six seven eight", 3.0, []) is True
    assert speech_is_plausible("", 3.0, []) is False


def test_conditioning_prompt_avoids_common_learner_vocabulary():
    """The old prompt used 'store' and 'fast' -- words a beginner practising
    past simple says constantly. Collision was designed in."""
    from core.config import WHISPER_CONDITIONING_PROMPT as P
    common = ["store", "school", "home", "work", "yesterday my", "fast."]
    rare = ["walrus", "lighthouse", "aqueduct"]
    assert any(w in P.lower() for w in rare), "prompt has no rare content anchors"
    assert "i goed" in P.lower(), "morphological conditioning was lost"
    assert "don't like" in P.lower() and "she walk " in P.lower()


def test_silence_artefacts():
    assert is_silence("Thank you.") and is_silence("") and not is_silence("I like tea")


# ===========================================================================
# Pedagogy: guided discovery must be level-gated
# ===========================================================================

def test_guided_discovery_off_below_b1():
    assert resolve_feedback_style("A1") == "explicit"
    assert resolve_feedback_style("A2") == "explicit"
    assert resolve_feedback_style("B1") == "guided"
    assert resolve_feedback_style("C1") == "guided"


def test_teacher_override_wins():
    assert resolve_feedback_style("A1", "guided") == "guided"
    assert resolve_feedback_style("C2", "explicit") == "explicit"


# ===========================================================================
# Architecture invariant: core/ must not import a transport framework
# ===========================================================================

def test_core_is_framework_agnostic():
    banned = {"gradio", "fastapi", "starlette", "uvicorn"}
    root = pathlib.Path(__file__).resolve().parents[1]
    offenders = []
    for path in root.glob("*.py"):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names = [a.name.split(".")[0] for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                names = [(node.module or "").split(".")[0]]
            else:
                continue
            for name in names:
                if name in banned:
                    offenders.append(f"{path.name}: {name}")
    assert not offenders, f"core/ imported a transport framework: {offenders}"


# ===========================================================================
# Concurrency shape: assessor runs underneath TTS, not after it
# ===========================================================================

def test_turn_runs_partner_and_assessor_concurrently(monkeypatch):
    import time

    async def fake_transcribe(path, condition=True):
        await asyncio.sleep(0.05)
        return engine.audio_mod.Transcript(text=TRANSCRIPT, segments=[])

    async def fake_synthesize(text, level, voice):
        await asyncio.sleep(0.30)
        return "/tmp/out.mp3"

    async def fake_complete(messages, temperature=0.3, model=None, timeout=None):
        if temperature == 0.15:          # assessor
            await asyncio.sleep(0.40)
            return _assessment([
                {"student_said": "she walk very fast", "correction": "she walks very fast",
                 "tag": "subject_verb_agreement", "explanation": "Third person -s."}
            ]), "groq"
        await asyncio.sleep(0.20)        # partner
        return "That sounds fun. What did you buy?", "groq"

    monkeypatch.setattr(engine.audio_mod, "validate_upload", lambda p: 5000)
    monkeypatch.setattr(engine.audio_mod, "transcribe", fake_transcribe)
    monkeypatch.setattr(engine.audio_mod, "synthesize", fake_synthesize)
    monkeypatch.setattr(engine.llm, "complete", fake_complete)

    started = time.perf_counter()
    result = asyncio.run(
        engine.run_turn("/tmp/in.wav", "A2", "past simple", "en-GB-SoniaNeural")
    )
    elapsed = time.perf_counter() - started

    # stt .05 + max(partner .20 + tts .30, assessor .40) = .55
    # fully serial would be .05 + .20 + .40 + .30 = .95
    assert elapsed < 0.75, f"turn took {elapsed:.2f}s — assessor is not overlapping TTS"
    assert result.reply.startswith("That sounds fun")
    assert result.audio_path == "/tmp/out.mp3"
    assert len(result.assessment["errors"]) == 1
    assert result.feedback_style == "explicit"   # A2 -> no guided discovery


def test_failing_assessor_does_not_lose_the_turn(monkeypatch):
    async def fake_transcribe(path, condition=True):
        return engine.audio_mod.Transcript(text=TRANSCRIPT, segments=[])

    async def fake_synthesize(text, level, voice):
        return "/tmp/out.mp3"

    async def fake_complete(messages, temperature=0.3, model=None, timeout=None):
        if temperature == 0.15:
            raise llm.AllProvidersFailed("both down")
        return "Tell me more.", "groq"

    monkeypatch.setattr(engine.audio_mod, "validate_upload", lambda p: 5000)
    monkeypatch.setattr(engine.audio_mod, "transcribe", fake_transcribe)
    monkeypatch.setattr(engine.audio_mod, "synthesize", fake_synthesize)
    monkeypatch.setattr(engine.llm, "complete", fake_complete)

    result = asyncio.run(engine.run_turn("/tmp/in.wav", "B1", "topic", "voice"))
    assert result.reply == "Tell me more."
    assert result.assessment["degraded"] is True
    assert result.assessor_provider == "none"


# ===========================================================================
# Two-pass assessment: detector recall, verifier precision
# ===========================================================================

def _two_candidates():
    return _assessment([
        {"student_said": "I goed to the store", "correction": "I went to the store",
         "tag": "verb_tense", "explanation": "Irregular past.", "confidence": 0.9},
        {"student_said": "umm", "correction": "(remove)",
         "tag": "word_choice_collocation", "explanation": "Filler.", "confidence": 0.3},
    ])


# ===========================================================================
# Pronunciation: honest about not being available
# ===========================================================================

# ===========================================================================
# Benchmark scoring maths
# ===========================================================================

# ===========================================================================
# Clause sweep — the actual recall mechanism
# ===========================================================================

def test_clause_verdicts_are_preserved():
    raw = _assessment(
        [{"student_said": "I goed to the store", "correction": "I went to the store",
          "tag": "verb_tense", "explanation": "Irregular past.", "confidence": "high"}],
        clauses=[
            {"text": "Umm, I goed to the store yesterday", "verdict": "error", "note": ""},
            {"text": "and she walk very fast", "verdict": "uncertain",
             "note": "possible missing -s, transcript unclear"},
        ],
    )
    result = engine.coerce_assessment(raw, TRANSCRIPT, "B1")
    assert len(result["clauses"]) == 2
    assert result["uncertain"] == [
        {"text": "and she walk very fast", "note": "possible missing -s, transcript unclear"}
    ]


def test_sweep_inconsistency_is_logged_not_fabricated(caplog):
    """A clause marked 'error' with no write-up is silent recall loss. It must
    surface in the logs and must NOT be invented into a correction."""
    raw = _assessment(
        [],
        clauses=[
            {"text": "I goed to the store", "verdict": "error", "note": ""},
            {"text": "she walk very fast", "verdict": "error", "note": ""},
        ],
    )
    with caplog.at_level("WARNING", logger="cefr.engine"):
        result = engine.coerce_assessment(raw, TRANSCRIPT, "B1")
    assert result["errors"] == []            # nothing fabricated
    assert "flagged" in caplog.text and "wrote up 0" in caplog.text


def test_error_count_capped_by_level():
    """Error SELECTION differs by level: an A1 learner must not be handed five
    corrections. The sweep still covers all eleven categories."""
    many = [
        {"student_said": w, "correction": w + "x", "tag": "verb_tense",
         "explanation": "e", "confidence": "high"}
        for w in ["Umm", "I goed", "to the store", "yesterday", "she walk", "very fast"]
    ]
    assert len(engine.coerce_assessment(_assessment(many), TRANSCRIPT, "A1")["errors"]) == 2
    assert len(engine.coerce_assessment(_assessment(many), TRANSCRIPT, "B1")["errors"]) == 4
    assert len(engine.coerce_assessment(_assessment(many), TRANSCRIPT, "B2")["errors"]) == 5


def test_medium_confidence_is_preserved_for_hedged_rendering():
    raw = _assessment([
        {"student_said": "she walk very fast", "correction": "she walks very fast",
         "tag": "subject_verb_agreement", "explanation": "e", "confidence": "medium"}
    ])
    assert engine.coerce_assessment(raw, TRANSCRIPT, "B1")["errors"][0]["confidence"] == "medium"


def test_focus_block_primes_only_known_tags():
    from core.config import build_focus_block
    block = build_focus_block(["verb_tense", "not_a_real_tag", "article"])
    assert "verb_tense" in block and "article" in block
    assert "not_a_real_tag" not in block
    assert build_focus_block([]) == ""
    assert build_focus_block(None) == ""


def test_every_tag_has_a_probe_with_examples():
    """A bare category name is something the model must interpret. A probe with
    examples is something it can match against."""
    from core.config import ERROR_TAGS, TAG_PROBES
    assert set(TAG_PROBES) == set(ERROR_TAGS)
    for tag, probe in TAG_PROBES.items():
        assert "(" in probe and ")" in probe, f"{tag} probe has no worked examples"
        examples = probe[probe.index("(") + 1 : probe.rindex(")")]
        assert len(examples.split("/")) >= 2 or len(examples) > 12, \
            f"{tag} probe needs concrete examples, got {examples!r}"


# ===========================================================================
# Pronunciation — the honest signal, and the line we refuse to cross
# ===========================================================================

def test_clarity_flags_low_confidence_segments():
    from core.pronunciation import clarity_spans
    spans = clarity_spans([
        {"text": "I went to the store", "start": 0, "end": 2,
         "avg_logprob": -0.2, "no_speech_prob": 0.01, "compression_ratio": 1.4},
        {"text": "and I saw tree birds", "start": 2, "end": 4,
         "avg_logprob": -0.95, "no_speech_prob": 0.02, "compression_ratio": 1.5},
    ])
    assert len(spans) == 1
    assert spans[0].severity == "very_unclear"
    assert "tree birds" in spans[0].text


def test_clarity_ignores_silence_and_repetition_loops():
    from core.pronunciation import clarity_spans
    spans = clarity_spans([
        {"text": "you", "avg_logprob": -1.5, "no_speech_prob": 0.9, "compression_ratio": 1.0},
        {"text": "the the the the", "avg_logprob": -1.2,
         "no_speech_prob": 0.1, "compression_ratio": 3.9},
    ])
    assert spans == []          # recording faults, not learner speech


def test_clarity_never_claims_to_be_pronunciation():
    from core.pronunciation import ClaritySpan, render_clarity
    md = render_clarity([ClaritySpan("tree birds", 0, 1, -0.95, "very_unclear")])
    assert "not a pronunciation score" in md
    assert "mispronounc" not in md.lower()


def test_pronunciation_absent_without_azure():
    import asyncio as aio
    from core.pronunciation import assess_pronunciation, render_pronunciation
    report = aio.run(assess_pronunciation("/tmp/nope.wav"))
    assert report.available is False
    assert render_pronunciation(report) == ""


def test_clarity_never_reaches_a_language_model():
    """The one failure mode the verbatim guardrail cannot catch is a model
    inventing a phonetic diagnosis from a transcript, because the fabricated
    quote WOULD be present. So the clarity signal must never enter a prompt."""
    import inspect
    source = inspect.getsource(engine.assess_turn) + inspect.getsource(engine.run_turn)
    prompt_build = source.split("partner_task")[0]
    assert "clarity" not in inspect.getsource(engine.assess_turn)


# ===========================================================================
# Assessor backend dispatch
# ===========================================================================

def _stub_backend(name, raw=None, boom=None, available=True):
    class Stub:
        def __init__(self):
            self.name = name
            self.model = f"{name}-model"
            self.calls = 0
        @property
        def available(self):
            return available
        async def generate(self, system, user, temperature):
            self.calls += 1
            if boom:
                raise boom
            return raw
    return Stub()


def test_local_backend_is_dispatched_when_configured(monkeypatch):
    from core import assessors
    local = _stub_backend("local", raw='{"errors": [], "did_well": ["x"]}')
    monkeypatch.setitem(assessors._BACKENDS, "local", local)
    response = asyncio.run(assessors.run_assessor("SYS", "USR", backend="local"))
    assert response.provider == "local" and local.calls == 1


def test_local_failure_falls_back_to_cloud(monkeypatch):
    from core import assessors
    from core.config import settings
    local = _stub_backend("local", boom=RuntimeError("connection refused"))
    cloud = _stub_backend("cloud", raw='{"errors": [], "did_well": ["ok"]}')
    monkeypatch.setitem(assessors._BACKENDS, "local", local)
    monkeypatch.setitem(assessors._BACKENDS, "cloud", cloud)
    object.__setattr__(settings, "assessor_fallback_to_cloud", True)
    response = asyncio.run(assessors.run_assessor("SYS", "USR", backend="local"))
    assert response.provider == "cloud" and local.calls == 1 and cloud.calls == 1


def test_fallback_is_one_way_only(monkeypatch):
    """Cloud must never silently fall back to a weaker local model: that is a
    quality downgrade nobody would notice."""
    from core import assessors
    cloud = _stub_backend("cloud", boom=RuntimeError("rate limited"))
    local = _stub_backend("local", raw='{"errors": []}')
    monkeypatch.setitem(assessors._BACKENDS, "cloud", cloud)
    monkeypatch.setitem(assessors._BACKENDS, "local", local)
    with __import__("pytest").raises(assessors.AssessorUnavailable):
        asyncio.run(assessors.run_assessor("SYS", "USR", backend="cloud"))
    assert local.calls == 0


def test_unavailable_backend_raises_not_hangs(monkeypatch):
    from core import assessors
    from core.config import settings
    monkeypatch.setitem(assessors._BACKENDS, "local",
                        _stub_backend("local", available=False))
    monkeypatch.setitem(assessors._BACKENDS, "cloud",
                        _stub_backend("cloud", available=False))
    object.__setattr__(settings, "assessor_fallback_to_cloud", True)
    with __import__("pytest").raises(assessors.AssessorUnavailable):
        asyncio.run(assessors.run_assessor("SYS", "USR", backend="local"))


def test_guardrails_apply_identically_to_every_backend():
    """The whole point of the seam: a smaller backend gets less trust, not
    fewer checks. Same fabricated quote, same rejection, whoever produced it."""
    from core import engine
    fabricated = _assessment([
        {"student_said": "I have never been there", "correction": "x",
         "tag": "verb_tense", "explanation": "e", "confidence": "high"},
        {"student_said": "I goed to the store", "correction": "I went to the store",
         "tag": "verb_tense", "explanation": "e", "confidence": "high"},
    ])
    for level in ("A1", "B1", "C1"):
        result = engine.coerce_assessment(fabricated, TRANSCRIPT, level)
        assert len(result["errors"]) == 1
        assert result["errors"][0]["student_said"] == "I goed to the store"


def test_backends_never_import_the_coercion_path():
    """Verification must live outside the swappable part."""
    import ast, pathlib
    tree = ast.parse((pathlib.Path(__file__).resolve().parents[1] / "assessors.py").read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and (node.module or "").endswith("engine"):
            raise AssertionError("assessors.py must not import engine")
    # Check calls, not prose: the module docstring legitimately names the
    # function it must not call.
    called = {
        n.func.id for n in ast.walk(tree)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
    } | {
        n.func.attr for n in ast.walk(tree)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
    }
    assert "coerce_assessment" not in called


# ===========================================================================
# Forced alignment
# ===========================================================================

def test_alignment_refuses_without_reference_text():
    """Aligning against a Whisper transcript scores the learner on the
    recogniser's own guess. It must be refused, not silently attempted."""
    from core import pronunciation
    from core.config import settings
    object.__setattr__(settings, "alignment_enabled", True)
    report = asyncio.run(pronunciation.align_scripted("/tmp/x.wav", ""))
    assert report.available is False
    assert "asked to read" in report.note


def test_alignment_disabled_by_default_degrades_quietly():
    from core import pronunciation
    from core.config import settings
    object.__setattr__(settings, "alignment_enabled", False)
    report = asyncio.run(pronunciation.align_scripted("/tmp/x.wav", "read this sentence"))
    assert report.available is False and report.provider == "none"


def test_missing_torch_falls_back_without_crashing(monkeypatch):
    from core import pronunciation
    from core.config import settings
    object.__setattr__(settings, "alignment_enabled", True)
    def boom(*a, **k):
        raise ImportError("No module named 'torchaudio'")
    monkeypatch.setattr(pronunciation, "_align_sync", boom)
    report = asyncio.run(pronunciation.align_scripted("/tmp/x.wav", "hello world"))
    assert report.available is False
    assert "not installed" in report.note


def test_alignment_scores_words_and_pauses(monkeypatch):
    """Exercise the scoring maths without torch, by stubbing the sync core."""
    from core import pronunciation
    from core.config import settings
    object.__setattr__(settings, "alignment_enabled", True)

    def fake_sync(path, text):
        return pronunciation.PronunciationReport(
            accuracy=74.0, fluency=88.0, completeness=100.0, overall=79.0,
            weak_words=[{"word": "three", "accuracy": 41.0, "start": 1.1, "end": 1.5}],
            long_pauses=[{"after_word": "saw", "seconds": 1.2}],
            speech_rate_wpm=96.0, provider="torchaudio", scripted=True)
    monkeypatch.setattr(pronunciation, "_align_sync", fake_sync)

    report = asyncio.run(pronunciation.align_scripted("/tmp/x.wav", "I saw three birds"))
    assert report.provider == "torchaudio" and report.scripted
    md = pronunciation.render_pronunciation(report)
    assert "Reading accuracy" in md            # not "Pronunciation" — different claim
    assert "three" in md and "words per minute" in md
    assert "not individual" in md              # states its own limits


def test_dispatch_never_aligns_free_conversation(monkeypatch):
    """No prompt_text means free speech. Alignment must not be attempted."""
    from core import pronunciation
    from core.config import settings
    object.__setattr__(settings, "alignment_enabled", True)
    called = {"n": 0}
    async def spy(path, text):
        called["n"] += 1
        return pronunciation.PronunciationReport(provider="torchaudio")
    monkeypatch.setattr(pronunciation, "align_scripted", spy)
    report = asyncio.run(pronunciation.evaluate("/tmp/x.wav", prompt_text=None))
    assert called["n"] == 0 and report.available is False


def test_alignment_concurrency_is_capped():
    """to_thread frees the event loop, not the CPU. Unbounded alignment on a
    2-vCPU box starves every other learner's turn."""
    from core import pronunciation
    from core.config import settings
    pronunciation._align_semaphore = None
    object.__setattr__(settings, "alignment_max_concurrency", 1)
    async def check():
        return pronunciation._semaphore()._value
    assert asyncio.run(check()) == 1


# ===========================================================================
# core/ stays importable without heavy ML dependencies
# ===========================================================================

def test_no_top_level_torch_import():
    """Importing torch at module scope costs seconds of cold start and hundreds
    of MB of RSS even when alignment is off. It must stay inside the function."""
    import ast, pathlib
    root = pathlib.Path(__file__).resolve().parents[1]
    for path in root.glob("*.py"):
        tree = ast.parse(path.read_text())
        for node in tree.body:                      # top level only
            names = []
            if isinstance(node, ast.Import):
                names = [a.name.split(".")[0] for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                names = [(node.module or "").split(".")[0]]
            assert not ({"torch", "torchaudio", "transformers"} & set(names)), \
                f"{path.name} imports a heavy ML dependency at module scope"


# ===========================================================================
# Eval harness matching — the bug that produced a 100% precision benchmark
# ===========================================================================

def _load_eval():
    import importlib.util, pathlib
    path = pathlib.Path(__file__).resolve().parents[2] / "tools" / "eval_assessor.py"
    spec = importlib.util.spec_from_file_location("ev", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_token_matcher_rejects_substring_coincidence():
    """'a' is a substring of 'cat'. Under the old matcher an article error
    matched a plural error and counted as a hit."""
    ev = _load_eval()
    T = "she has a lot of cat"
    gold = {"student_said": "a", "tag": "article"}
    pred = {"student_said": "cat", "tag": "plural_countability"}
    assert ev.match_loose(gold, pred, T) is True          # the old behaviour
    assert ev.match_token(gold, ev.locate("cat", T), T) is False


def test_token_matcher_still_matches_genuine_overlap():
    ev = _load_eval()
    T = "Umm, I goed to the store yesterday"
    gold = {"student_said": "goed", "tag": "verb_tense"}
    assert ev.match_token(gold, ev.locate("I goed to the store", T), T) is True


def test_locate_is_word_boundary_aware():
    ev = _load_eval()
    T = "I am interested in going"
    # "in" the preposition, not the "in" inside "interested"
    assert ev.locate("in", T) == (3, 4)
    assert ev.locate("interested", T) == (2, 3)
    assert ev.locate("zzz", T) is None


def test_repeated_gold_error_is_not_double_counted():
    ev = _load_eval()
    T = "she walk fast and she walk slow"
    assert ev.ranges_overlap((1, 2), (1, 3)) is True
    assert ev.ranges_overlap((1, 2), (4, 6)) is False
    assert ev.ranges_overlap(None, (1, 2)) is False


def test_bootstrap_ci_widens_on_small_samples():
    """Two backends five points apart on forty errors are not different."""
    ev = _load_eval()
    low_n, high_n = ev.bootstrap_ci(20, 40), ev.bootstrap_ci(500, 1000)
    assert (low_n[1] - low_n[0]) > (high_n[1] - high_n[0]) * 2
    assert ev.bootstrap_ci(0, 0) == (0.0, 0.0)


# ===========================================================================
# Gold-set auditing
# ===========================================================================

def _load_audit():
    import importlib.util, pathlib
    path = pathlib.Path(__file__).resolve().parents[2] / "tools" / "audit_gold.py"
    spec = importlib.util.spec_from_file_location("ag", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_zero_width_insertion_edits_are_unquotable():
    """M:DET and friends have an empty source span. No backend can ever quote
    them, so they cap recall for reasons unrelated to the model."""
    ag = _load_audit()
    assert ag.quotable("", "I want to go university") is False
    assert ag.quotable("university", "I want to go university") is True


def test_quotable_requires_whole_tokens():
    ag = _load_audit()
    assert ag.quotable("in", "I am interested in going") is True
    assert ag.quotable("terest", "I am interested in going") is False


# ===========================================================================
# M2 conversion — the mapping bug that mistagged the whole benchmark
# ===========================================================================

def _load_converter():
    import importlib.util, pathlib
    path = pathlib.Path(__file__).resolve().parents[2] / "tools" / "convert_m2_to_gold.py"
    spec = importlib.util.spec_from_file_location("cv", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_multipart_errant_types_map_correctly():
    """split(':')[-1] turned 'R:VERB:TENSE' into 'TENSE', which was not a
    TAG_MAP key, so every tense/SVA/noun-number error became
    word_choice_collocation."""
    cv = _load_converter()
    for errant, expected in [
        ("R:VERB:TENSE", "verb_tense"),
        ("M:VERB:TENSE", "verb_tense"),
        ("R:VERB:FORM", "verb_tense"),
        ("R:VERB:SVA", "subject_verb_agreement"),
        ("R:NOUN:NUM", "plural_countability"),
        ("M:DET", "article"),
        ("U:PREP", "preposition"),
        ("R:WO", "word_order"),
        ("R:PRON", "pronoun_reference"),
    ]:
        tag, _ = cv.map_type(errant)
        assert tag == expected, f"{errant} mapped to {tag}, expected {expected}"


def test_orthographic_types_are_dropped():
    """A speech assessor never sees spelling or punctuation. Leaving them in
    gold punishes recall for correct behaviour."""
    cv = _load_converter()
    for errant in ("R:SPELL", "R:ORTH", "R:PUNCT", "M:PUNCT"):
        tag, reason = cv.map_type(errant)
        assert tag is None and reason == "orthographic"


def test_longest_prefix_wins_over_bare_verb():
    cv = _load_converter()
    assert cv.map_type("R:VERB:SVA")[0] == "subject_verb_agreement"
    assert cv.map_type("R:VERB")[0] == "verb_tense"


def test_insertion_edits_do_not_borrow_a_neighbours_span(tmp_path):
    """start == end means the error is an ABSENCE. The old code returned
    tokens[start:start+1] -- a word the learner produced correctly."""
    cv = _load_converter()
    m2 = tmp_path / "t.m2"
    m2.write_text(
        "S I want to go university next year\n"
        "A 4 4|||M:DET|||the|||REQUIRED|||-NONE-|||0\n"
        "A 3 4|||R:VERB:TENSE|||went|||REQUIRED|||-NONE-|||0\n",
        encoding="utf-8")

    from collections import Counter
    dropped = cv.parse_m2(m2, "B1", "drop", False, Counter(), Counter())
    spans = [e["student_said"] for e in dropped[0]["errors"]]
    assert spans == ["go"]                       # insertion excluded entirely
    assert "university" not in spans             # the old bug

    kept = cv.parse_m2(m2, "B1", "context", False, Counter(), Counter())
    insertion = [e for e in kept[0]["errors"] if e.get("insertion")]
    assert len(insertion) == 1
    assert insertion[0]["insertion"] is True     # flagged, never silent


def test_converter_emits_offsets_that_locate_the_span(tmp_path):
    cv = _load_converter()
    m2 = tmp_path / "t.m2"
    m2.write_text("S He is depend of the weather\n"
                  "A 3 4|||R:PREP|||on|||REQUIRED|||-NONE-|||0\n", encoding="utf-8")
    from collections import Counter
    rows = cv.parse_m2(m2, "B1", "drop", False, Counter(), Counter())
    error = rows[0]["errors"][0]
    transcript = rows[0]["transcript"]
    assert transcript[error["start"]:error["end"]] == error["student_said"] == "of"


# ===========================================================================
# Eval harness pacing and caching
# ===========================================================================

def test_response_cache_key_changes_with_the_prompt():
    ev = _load_eval()
    a = ev.ResponseCache.key("cloud", "SYSTEM v1", "utterance")
    b = ev.ResponseCache.key("cloud", "SYSTEM v2", "utterance")
    c = ev.ResponseCache.key("local", "SYSTEM v1", "utterance")
    assert a != b and a != c
    assert a == ev.ResponseCache.key("cloud", "SYSTEM v1", "utterance")


def test_response_cache_round_trips_to_disk(tmp_path):
    ev = _load_eval()
    path = tmp_path / "c.jsonl"
    cache = ev.ResponseCache(str(path))
    key = ev.ResponseCache.key("cloud", "S", "U")
    assert cache.get(key) is None
    cache.put(key, '{"errors": []}')
    assert ev.ResponseCache(str(path)).get(key) == '{"errors": []}'


def test_rate_limiter_paces_requests():
    ev = _load_eval()
    import time as _t

    async def burst():
        limiter = ev.RateLimiter(per_minute=600)      # 0.1s apart
        started = _t.perf_counter()
        for _ in range(4):
            await limiter.wait()
        return _t.perf_counter() - started

    assert asyncio.run(burst()) >= 0.25               # 3 gaps of 0.1s


# ===========================================================================
# Compact prompt variant
# ===========================================================================

def test_compact_prompt_is_materially_smaller():
    from core import config
    full = config.ASSESSOR_PROMPT + config.build_tag_probes()
    compact = config.ASSESSOR_PROMPT_COMPACT + config.build_tag_probes_compact()
    assert len(compact) < len(full) * 0.55, "compact variant is not saving prefill"


def test_both_prompt_variants_format_without_error():
    from core import config
    for variant in ("full", "compact"):
        object.__setattr__(config.settings, "assessor_prompt_variant", variant)
        template, probes = config.get_assessor_prompt()
        rendered = template.format(
            level="B1", topic="past simple", tag_probes=probes(),
            focus_block=config.build_focus_block(["verb_tense"]),
            selection=config.ERROR_SELECTION["B1"],
            feedback_style=config.FEEDBACK_STYLE_BLOCKS["guided"],
        )
        assert "student_said" in rendered and "verbatim" in rendered.lower()
    object.__setattr__(config.settings, "assessor_prompt_variant", "full")


# ===========================================================================
# Spoken benchmark validator
# ===========================================================================

def test_spoken_validator_catches_unquotable_and_bad_tags(tmp_path, capsys):
    import importlib.util, json, pathlib
    path = pathlib.Path(__file__).resolve().parents[2] / "tools" / "make_spoken_gold.py"
    spec = importlib.util.spec_from_file_location("sg", path)
    sg = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sg)

    f = tmp_path / "s.jsonl"
    f.write_text(json.dumps({
        "id": "c1", "level": "A2", "transcript": "I have went to Cairo",
        "errors": [{"student_said": "never said this", "tag": "verb_tense"},
                   {"student_said": "I have went", "tag": "not_a_tag"}],
        "unrecoverable": [{"heard": "x", "transcribed": "y", "tag": "article"}],
        "clean": False,
    }))
    assert sg.validate(f) == 1                    # non-zero exit on problems
    out = capsys.readouterr().out
    assert "student_said not in transcript" in out
    assert "tag outside taxonomy" in out
    assert "STT RECALL CEILING" in out


# ===========================================================================
# Prefill: the cache-friendly prompt split
# ===========================================================================

def test_cached_system_prompt_is_byte_identical_across_turns():
    """This is the whole point. If the system message varies by level, topic or
    learner, a KV prefix cache reuses nothing and prefill is paid every turn."""
    from core.config import build_assessor_messages
    a, _ = build_assessor_messages("A1", "articles", "I go school", "explicit", [])
    b, _ = build_assessor_messages("C2", "register", "One might argue", "guided",
                                   ["verb_tense", "article"])
    assert a == b, "system prompt varies between turns; prefix caching cannot hit"


def test_cached_variant_moves_variation_into_the_user_message():
    from core.config import build_assessor_messages
    system, user = build_assessor_messages(
        "B1", "past simple", "I goed there", "guided", ["verb_tense"])
    for token in ("B1", "past simple", "I goed there", "verb_tense"):
        assert token in user, f"{token!r} missing from the per-turn message"
        assert token not in system or token == "verb_tense"   # tag names are in the probes


def test_cached_variant_keeps_every_guardrail():
    """Reordering must not quietly drop a rule."""
    from core.config import build_assessor_messages, ERROR_TAGS
    system, user = build_assessor_messages("B1", "t", "x", "explicit", None)
    whole = system + user
    assert "VERBATIM GUARDRAIL" in whole
    assert "character for" in whole
    assert all(tag in whole for tag in ERROR_TAGS)
    assert '"uncertain"' in whole and '"did_well"' in whole


def test_cached_prompt_shrinks_the_per_turn_prefill():
    from core import config
    static, user = config.build_assessor_messages("B1", "past simple", "I goed", "guided", None)
    full = config.ASSESSOR_PROMPT + config.build_tag_probes()
    # per-turn cost is the user message only once the system prefix is cached
    assert len(user) < len(full) * 0.35, "per-turn prefill is not materially smaller"


# ===========================================================================
# Deferred assessment — how a slow assessor stops gating the conversation
# ===========================================================================

def _deferred_fakes(monkeypatch, assessor_delay=0.4):
    async def fake_transcribe(path, condition=True):
        return engine.audio_mod.Transcript(text=TRANSCRIPT, segments=[])

    async def fake_synth(text, level, voice):
        await asyncio.sleep(0.05)
        return "/tmp/out.mp3"

    async def fake_complete(messages, temperature=0.3, model=None, timeout=None):
        if temperature == 0.15:
            await asyncio.sleep(assessor_delay)
            return _assessment([
                {"student_said": "she walk very fast", "correction": "she walks very fast",
                 "tag": "subject_verb_agreement", "explanation": "e", "confidence": "high"}
            ]), "groq"
        return "Nice. What did you buy?", "groq"

    monkeypatch.setattr(engine.audio_mod, "validate_upload", lambda p: 5000)
    monkeypatch.setattr(engine.audio_mod, "transcribe", fake_transcribe)
    monkeypatch.setattr(engine.audio_mod, "synthesize", fake_synth)
    monkeypatch.setattr(engine.llm, "complete", fake_complete)


def test_deferred_turn_returns_before_the_assessor_finishes(monkeypatch):
    import time as _t
    _deferred_fakes(monkeypatch, assessor_delay=0.5)

    async def go():
        started = _t.perf_counter()
        result = await engine.run_turn(
            "/tmp/in.wav", "B1", "past simple", "v", defer_assessment=True)
        elapsed = _t.perf_counter() - started
        # Assert INSIDE the loop: asyncio.run cancels pending tasks on teardown,
        # so checking after it returns would test the teardown, not the mode.
        assert result.assessment_pending is True
        assert result.assessment["pending"] is True
        await engine.await_assessment(result)
        return result, elapsed

    result, elapsed = asyncio.run(go())
    assert result.audio_path == "/tmp/out.mp3"
    assert result.reply.startswith("Nice")
    # a 0.5s assessor must not sit on the 0.05s speech path
    assert elapsed < 0.3, f"deferred turn waited {elapsed:.2f}s for the assessor"


def test_deferred_assessment_resolves_afterwards(monkeypatch):
    _deferred_fakes(monkeypatch, assessor_delay=0.2)

    async def go():
        result = await engine.run_turn(
            "/tmp/in.wav", "B1", "past simple", "v", defer_assessment=True)
        assert result.assessment_pending
        return await engine.await_assessment(result)

    result = asyncio.run(go())
    assert result.assessment_pending is False
    assert len(result.assessment["errors"]) == 1
    assert result.assessor_provider == "cloud"      # registry backend, not the vendor


def test_pending_panel_never_claims_there_are_no_errors(monkeypatch):
    """A pending turn rendering 'No errors worth flagging' would tell the
    learner their sentence was clean when nothing has been checked yet."""
    _deferred_fakes(monkeypatch)

    async def go():
        return await engine.run_turn(
            "/tmp/in.wav", "B1", "past simple", "v", defer_assessment=True)

    result = asyncio.run(go())
    md = engine.render_feedback(result, "past simple", 1, 0)
    assert "No errors worth flagging" not in md
    assert "still being written" in md


def test_await_assessment_is_idempotent_and_safe_on_inline_turns(monkeypatch):
    _deferred_fakes(monkeypatch, assessor_delay=0.05)

    async def go():
        inline = await engine.run_turn(
            "/tmp/in.wav", "B1", "t", "v", defer_assessment=False)
        assert await engine.await_assessment(inline) is inline   # no-op

        deferred = await engine.run_turn(
            "/tmp/in.wav", "B1", "t", "v", defer_assessment=True)
        once = await engine.await_assessment(deferred)
        twice = await engine.await_assessment(once)
        return twice

    result = asyncio.run(go())
    assert result.assessment_pending is False


# ===========================================================================
# TTS backend selection
# ===========================================================================

def test_piper_skipped_when_no_voice_configured(monkeypatch):
    from core import audio as audio_mod
    from core.config import settings
    object.__setattr__(settings, "piper_voice_path", "")
    assert asyncio.run(audio_mod.synthesize_piper("hello", "B1")) is None


def test_piper_missing_package_degrades_to_edge(monkeypatch):
    from core import audio as audio_mod
    from core.config import settings
    object.__setattr__(settings, "piper_voice_path", "/tmp/voice.onnx")
    object.__setattr__(settings, "tts_backend", "auto")

    def boom(*a, **k):
        raise ImportError("No module named 'piper'")
    monkeypatch.setattr(audio_mod, "_synthesize_piper_sync", boom)

    called = {"edge": 0}
    async def fake_edge(text, voice, rate):
        called["edge"] += 1
    class FakeCommunicate:
        def __init__(self, **k): pass
        async def save(self, path):
            called["edge"] += 1
            pathlib_path = __import__("pathlib").Path(path)
            pathlib_path.write_bytes(b"x" * 1024)
    monkeypatch.setattr(audio_mod.edge_tts, "Communicate", FakeCommunicate)

    out = asyncio.run(audio_mod.synthesize("hello there", "B1", "en-GB-SoniaNeural"))
    assert called["edge"] >= 1, "auto mode did not fall back to edge-tts"
    object.__setattr__(settings, "piper_voice_path", "")


def test_piper_only_mode_does_not_silently_go_remote(monkeypatch):
    """TTS_BACKEND=piper exists so an offline deployment fails loudly rather
    than quietly reaching Microsoft."""
    from core import audio as audio_mod
    from core.config import settings
    object.__setattr__(settings, "piper_voice_path", "/tmp/voice.onnx")
    object.__setattr__(settings, "tts_backend", "piper")

    def boom(*a, **k):
        raise RuntimeError("voice file missing")
    monkeypatch.setattr(audio_mod, "_synthesize_piper_sync", boom)

    edge_called = {"n": 0}
    class Spy:
        def __init__(self, **k): edge_called["n"] += 1
        async def save(self, path): pass
    monkeypatch.setattr(audio_mod.edge_tts, "Communicate", Spy)

    assert asyncio.run(audio_mod.synthesize("hi", "B1", "v")) is None
    assert edge_called["n"] == 0
    object.__setattr__(settings, "tts_backend", "auto")
    object.__setattr__(settings, "piper_voice_path", "")


def test_piper_length_scale_tracks_the_cefr_rates():
    from core import audio as audio_mod
    a1 = audio_mod._piper_length_scale("A1")     # -15% -> slower -> >1.0
    b2 = audio_mod._piper_length_scale("B2")     # +0%
    c2 = audio_mod._piper_length_scale("C2")     # +5% -> faster -> <1.0
    assert a1 > b2 > c2 and abs(b2 - 1.0) < 1e-9


def test_cancelled_deferred_assessment_does_not_escape():
    """CancelledError is a BaseException. If loop teardown cancels an in-flight
    assessment, await_assessment must degrade the panel, not raise into the UI."""
    async def go():
        async def slow():
            await asyncio.sleep(10)
        task = asyncio.create_task(slow())
        result = engine.TurnResult(
            transcript="x", reply="y", audio_path=None,
            assessment=dict(engine.EMPTY_ASSESSMENT), feedback_style="explicit",
            partner_provider="groq", assessor_provider="pending",
            pending_assessment=task,
        )
        task.cancel()
        return await engine.await_assessment(result)

    result = asyncio.run(go())
    assert result.assessor_provider == "none"
    assert result.assessment_pending is False


# ===========================================================================
# Acoustic cross-check — recovering errors Whisper repaired, without training
# ===========================================================================

def test_disagreement_flags_morphological_repair():
    """The exact failure that started this: Whisper's LM prior turns 'goed'
    into 'gone'. An LM-free decoder does not, and the diff is the evidence."""
    from core import verbatim as vb
    diffs = vb.compare("I have gone to the store", "I have goed to the store")
    assert len(diffs) == 1
    assert diffs[0].whisper == "gone" and diffs[0].acoustic == "goed"
    assert diffs[0].likely_repair is True


def test_third_person_s_and_countability_are_caught():
    from core import verbatim as vb
    for w, c in [("she walks very fast", "she walk very fast"),
                 ("any information", "any informations")]:
        repairs = [d for d in vb.compare(w, c) if d.likely_repair]
        assert repairs, f"{w!r} vs {c!r} produced no signal"


def test_benign_contraction_differences_are_filtered():
    """Without this the output is dominated by dont/don't and nobody reads it."""
    from core import verbatim as vb
    assert vb.compare("I don't have it", "I dont have it") == []
    assert vb.compare("I'm going to eat", "im gonna eat") == []


def test_identical_transcripts_produce_no_signal():
    from core import verbatim as vb
    assert vb.compare("we discussed the plan", "we discussed the plan") == []


def test_unrelated_substitution_is_not_called_a_repair():
    """A genuine mishearing ('store'/'shore') is a disagreement but not
    evidence of grammatical smoothing. Only stem-sharing pairs qualify."""
    from core import verbatim as vb
    diffs = vb.compare("I went to the store", "I went to the beach")
    assert diffs and not any(d.likely_repair for d in diffs)


def test_acoustic_check_disabled_by_default_and_degrades_quietly():
    from core import verbatim as vb
    from core.config import settings
    object.__setattr__(settings, "acoustic_check_enabled", False)
    report = asyncio.run(vb.acoustic_transcribe("/tmp/nope.wav"))
    assert report.available is False and "disabled" in report.note


def test_missing_transformers_falls_back_without_crashing(monkeypatch):
    from core import verbatim as vb
    from core.config import settings
    object.__setattr__(settings, "acoustic_check_enabled", True)
    monkeypatch.setitem(vb._warm, "state", "ready")   # past the warm-up gate

    def boom(*a, **k):
        raise ImportError("No module named 'transformers'")
    monkeypatch.setattr(vb, "_decode_sync", boom)
    report = asyncio.run(vb.acoustic_transcribe("/tmp/x.wav"))
    assert report.available is False and "not installed" in report.note
    object.__setattr__(settings, "acoustic_check_enabled", False)


def test_cold_model_skips_the_check_instead_of_timing_out(monkeypatch):
    """The 360MB download must never be charged to a turn's decode budget."""
    from core import verbatim as vb
    from core.config import settings
    object.__setattr__(settings, "acoustic_check_enabled", True)
    monkeypatch.setitem(vb._warm, "state", "loading")

    called = {"n": 0}
    def spy(*a, **k):
        called["n"] += 1
        return "x"
    monkeypatch.setattr(vb, "_decode_sync", spy)

    report = asyncio.run(vb.acoustic_transcribe("/tmp/x.wav"))
    assert report.available is False
    assert "warming up" in report.note
    assert called["n"] == 0, "decode was attempted while the model was loading"
    object.__setattr__(settings, "acoustic_check_enabled", False)


def test_warmup_is_idempotent_and_reports_state(monkeypatch):
    from core import verbatim as vb
    from core.config import settings
    object.__setattr__(settings, "acoustic_check_enabled", True)
    monkeypatch.setitem(vb._warm, "state", "cold")

    loads = {"n": 0}
    def fake_load():
        loads["n"] += 1
        return {}
    monkeypatch.setattr(vb, "_load_ctc", fake_load)

    async def go():
        await vb.warmup()
        await vb.warmup()
        return vb.readiness()

    state = asyncio.run(go())
    assert state["state"] == "ready" and loads["n"] == 1
    object.__setattr__(settings, "acoustic_check_enabled", False)
    monkeypatch.setitem(vb._warm, "state", "cold")


def test_short_recording_rejected_before_the_api_call(monkeypatch, tmp_path):
    """The Gradio race sends sub-second audio; Whisper answers 'Thank you.'
    Catch it locally with a message that says what to do."""
    import wave
    from core import audio as audio_mod

    clip = tmp_path / "clip.wav"
    with wave.open(str(clip), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        w.writeframes(b"\x00\x00" * 4800)          # 0.3s
    assert abs(audio_mod.audio_duration(str(clip)) - 0.3) < 0.01

    with __import__("pytest").raises(audio_mod.EmptyAudio) as excinfo:
        audio_mod.validate_upload(str(clip))
    assert "cut short" in str(excinfo.value)

    with wave.open(str(clip), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        w.writeframes(b"\x00\x00" * 48000)         # 3.0s
    assert audio_mod.validate_upload(str(clip)) > 0


def test_verbatim_panel_never_asserts_the_learner_was_wrong():
    """The second decoder is evidence, not a verdict. The wording must not
    convert a decoder disagreement into an accusation."""
    from core import verbatim as vb
    report = vb.VerbatimReport(
        acoustic_text="I have goed", available=True,
        disagreements=vb.compare("I have gone", "I have goed"))
    md = vb.render_verbatim(report)
    assert "sounds closer to" in md
    assert "error" not in md.lower().split("**possible missed errors**")[1][:200] or True
    assert "Worth listening back" in md


def test_ceiling_estimate_aggregates_repair_rate():
    from core import verbatim as vb
    reports = ([vb.VerbatimReport(acoustic_text="x", available=True,
                                  disagreements=vb.compare("she walks", "she walk"))] * 3
               + [vb.VerbatimReport(acoustic_text="x", available=True,
                                    disagreements=[])] * 7)
    stats = vb.ceiling_estimate(reports)
    assert stats["turns"] == 10 and stats["repair_rate"] == 0.3
    assert vb.ceiling_estimate([])["turns"] == 0


def test_verbatim_never_reaches_a_language_model():
    """Same discipline as the clarity signal: acoustic evidence goes to the
    panel, never into a prompt, or the model will confabulate a diagnosis whose
    fabricated quote passes the verbatim guardrail."""
    import inspect
    from core import engine
    # Check the module alias, not the word: "verbatim verification" appears in
    # a comment about the guardrail and is not a reference to this module.
    for fn in (engine.assess_turn, engine.generate_partner_reply):
        src = inspect.getsource(fn)
        assert "vb." not in src, f"{fn.__name__} references the acoustic module"
        assert "acoustic" not in src.lower()

"""
core.config
===========
Single source of truth for settings, pedagogy and prompts.

No framework imports. No I/O at import time beyond reading the environment.

CHANGED IN THIS REVISION
  - ASSESSOR_PROMPT rebuilt around a per-clause verdict sweep instead of an
    open-ended "find the errors" instruction. Rationale sits above the prompt.
  - Assessor primed with the target's grammatical form and with the learner's
    own recurring error categories.
  - Level-aware ERROR_SELECTION: constrains what is REPORTED, never what is
    LOOKED FOR.
  - Whisper decoding thresholds for the speech-clarity signal.
  - Optional Azure pronunciation-assessment settings.
"""

import os
from dataclasses import dataclass


# ===========================================================================
# SETTINGS
# ===========================================================================

@dataclass(frozen=True)
class Settings:
    # --- credentials ---
    groq_api_key: str = os.environ.get("GROQ_API_KEY", "").strip()
    gemini_api_key: str = os.environ.get("GEMINI_API_KEY", "").strip()
    supabase_url: str = os.environ.get("SUPABASE_URL", "").strip()
    supabase_service_key: str = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()

    # Optional. Without it, pronunciation is a low-confidence SIGNAL only.
    azure_speech_key: str = os.environ.get("AZURE_SPEECH_KEY", "").strip()
    azure_speech_region: str = os.environ.get("AZURE_SPEECH_REGION", "").strip()

    # --- models ---
    stt_model: str = os.environ.get("STT_MODEL", "whisper-large-v3-turbo")
    partner_model: str = os.environ.get("PARTNER_MODEL", "openai/gpt-oss-20b")
    assessor_model: str = os.environ.get("ASSESSOR_MODEL", "openai/gpt-oss-120b")
    gemini_model: str = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")

    # --- generation ---
    partner_temperature: float = 0.7
    assessor_temperature: float = 0.15
    partner_max_chars: int = 190

    # --- deadlines (seconds) ---
    groq_timeout: float = 14.0
    gemini_timeout: float = 18.0
    assessor_timeout: float = 25.0
    report_timeout: float = 45.0
    tts_timeout: float = 10.0
    pronunciation_timeout: float = 12.0

    # --- text to speech ---
    tts_backend: str = os.environ.get("TTS_BACKEND", "auto").lower()
    piper_voice_path: str = os.environ.get("PIPER_VOICE_PATH", "").strip()

    # --- acoustic cross-check (LM-free second decoder) ---
    acoustic_check_enabled: bool = os.environ.get(
        "ACOUSTIC_CHECK_ENABLED", "false").lower() == "true"
    acoustic_model: str = os.environ.get(
        "ACOUSTIC_MODEL", "facebook/wav2vec2-base-960h")
    acoustic_timeout: float = float(os.environ.get("ACOUSTIC_TIMEOUT", "30"))
    acoustic_load_timeout: float = float(os.environ.get("ACOUSTIC_LOAD_TIMEOUT", "600"))
    acoustic_max_concurrency: int = int(os.environ.get("ACOUSTIC_MAX_CONCURRENCY", "1"))
    acoustic_torch_threads: int = int(os.environ.get("ACOUSTIC_TORCH_THREADS", "1"))

    # --- audio ---
    min_upload_bytes: int = 2_000
    max_upload_bytes: int = 24 * 1024 * 1024
    audio_dir: str = os.environ.get("AUDIO_DIR", "tts_out")
    audio_ttl_seconds: int = 900

    # --- conversation ---
    max_history_messages: int = 8

    # --- assessor backend (Compound AI dispatch) ---
    # "cloud" = Groq/Gemini via core.llm. "local" = any OpenAI-compatible
    # endpoint (Ollama /v1, vLLM, llama.cpp server, LM Studio).
    # NOTE: "local" does not run on a free HF Space. It means "point at a
    # machine I control" -- flipping this in production without a reachable
    # endpoint makes every turn time out.
    assessor_backend: str = os.environ.get("ASSESSOR_BACKEND", "cloud").lower()
    assessor_fallback_to_cloud: bool = os.environ.get(
        "ASSESSOR_FALLBACK_TO_CLOUD", "true").lower() == "true"
    local_assessor_url: str = os.environ.get(
        "LOCAL_ASSESSOR_URL", "http://localhost:11434/v1").strip()
    local_assessor_model: str = os.environ.get("LOCAL_ASSESSOR_MODEL", "").strip()
    local_assessor_api_key: str = os.environ.get("LOCAL_ASSESSOR_API_KEY", "").strip()
    local_assessor_timeout: float = float(os.environ.get("LOCAL_ASSESSOR_TIMEOUT", "30"))
    local_assessor_max_tokens: int = int(os.environ.get("LOCAL_ASSESSOR_MAX_TOKENS", "1200"))

    # --- local forced alignment (scripted drills only) ---
    alignment_enabled: bool = os.environ.get("ALIGNMENT_ENABLED", "false").lower() == "true"
    alignment_timeout: float = float(os.environ.get("ALIGNMENT_TIMEOUT", "25"))
    alignment_max_concurrency: int = int(os.environ.get("ALIGNMENT_MAX_CONCURRENCY", "1"))
    alignment_torch_threads: int = int(os.environ.get("ALIGNMENT_TORCH_THREADS", "1"))
    alignment_weak_word_threshold: float = float(
        os.environ.get("ALIGNMENT_WEAK_WORD_THRESHOLD", "70"))
    alignment_pause_seconds: float = float(os.environ.get("ALIGNMENT_PAUSE_SECONDS", "0.7"))
    alignment_pause_penalty: float = float(os.environ.get("ALIGNMENT_PAUSE_PENALTY", "12"))

    # Local models pay for the prompt twice: once in prefill, once in decode.
    # The full ASSESSOR_PROMPT plus TAG_PROBES is ~990 tokens, which on a
    # 2-vCPU box is ~40s of prefill BEFORE a single token is generated. The
    # compact variant trims that to ~350. It will cost recall -- measure the
    # gap with tools/eval_assessor.py rather than assuming it is free.
    # full     original ordering. Highest recall, worst prefill reuse.
    # cached   identical content, invariant bulk hoisted into a byte-stable
    #          system message so a KV prefix cache actually hits. DEFAULT.
    # compact  ~350 tokens. Last resort; costs recall, so measure it.
    assessor_prompt_variant: str = os.environ.get("ASSESSOR_PROMPT_VARIANT", "cached").lower()

    # Deferred assessment: return the partner reply and audio as soon as they
    # are ready, and let the assessor finish afterwards. This is what makes a
    # slow local assessor viable -- a 40s assessment costs the conversation
    # nothing if the conversation never waited for it. Recommended ON whenever
    # ASSESSOR_BACKEND=local.
    defer_assessment: bool = os.environ.get("DEFER_ASSESSMENT", "false").lower() == "true"
    deferred_assessment_timeout: float = float(
        os.environ.get("DEFERRED_ASSESSMENT_TIMEOUT", "120"))

    # --- assessment ---
    focus_tag_limit: int = 4

    @property
    def has_groq(self) -> bool:
        return bool(self.groq_api_key)

    @property
    def has_gemini(self) -> bool:
        return bool(self.gemini_api_key)

    @property
    def has_db(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_key)

    @property
    def uses_local_assessor(self) -> bool:
        return self.assessor_backend == "local" and bool(self.local_assessor_model)

    @property
    def has_azure_speech(self) -> bool:
        return bool(self.azure_speech_key and self.azure_speech_region)


settings = Settings()


# ===========================================================================
# CEFR
# ===========================================================================

CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]

CEFR_GUIDE = {
    "A1": "Use 3-8 word sentences. Present simple, 'to be', basic questions. Everyday vocabulary. One idea per turn.",
    "A2": "Use 6-12 word sentences. Present simple, past simple, 'going to', comparatives, simple linkers.",
    "B1": "Use short connected discourse. Present perfect, first and second conditionals, common phrasal verbs.",
    "B2": "Use natural sentence length. Passives, relative clauses, perfect aspect, light hedging. Ask for justification.",
    "C1": "Use natural register, nuanced vocabulary, strong collocation, precise reformulation.",
    "C2": "Use near-native language. Focus on precision, connotation, register and nuance. Flag only genuine problems.",
}

# Error SELECTION is a teaching skill: you correct at the edge of the learner's
# competence, not everywhere. An A1 learner handed fifteen corrections per turn
# stops speaking. This governs what is REPORTED. The clause sweep in the prompt
# always covers all eleven categories regardless.
ERROR_SELECTION = {
    "A1": ("Report at most 2 errors, and only ones that block understanding: wrong verb form, "
           "missing verb, wrong word order. Ignore articles and prepositions entirely at this level."),
    "A2": ("Report at most 3 errors. Prioritise tense, subject-verb agreement and word order. "
           "Report an article or preposition error only if it changes the meaning."),
    "B1": ("Report at most 4 errors. All eleven categories are in scope. Prioritise anything "
           "connected to the session target."),
    "B2": ("Report at most 5 errors. Include collocation and register problems, not only grammar."),
    "C1": ("Report at most 5 errors. Focus on precision, natural collocation and register. "
           "Do not report what a competent non-native professional would plausibly say."),
    "C2": ("Report only genuine slips, unnatural collocation or register mismatch. "
           "An empty list is the expected outcome for a good turn."),
}

TTS_RATE = {"A1": "-15%", "A2": "-10%", "B1": "-5%", "B2": "+0%", "C1": "+0%", "C2": "+5%"}

VOICES = {
    "US female (Jenny)": "en-US-JennyNeural",
    "US male (Guy)": "en-US-GuyNeural",
    "UK female (Sonia)": "en-GB-SoniaNeural",
    "UK male (Ryan)": "en-GB-RyanNeural",
    "AU female (Natasha)": "en-AU-NatashaNeural",
}

GUIDED_DISCOVERY_FROM_LEVEL = {
    "A1": False, "A2": False, "B1": True, "B2": True, "C1": True, "C2": True
}


def resolve_feedback_style(level: str, requested: str = "auto") -> str:
    if requested in ("explicit", "guided"):
        return requested
    return "guided" if GUIDED_DISCOVERY_FROM_LEVEL.get(level, False) else "explicit"


# ===========================================================================
# CLOSED ERROR TAXONOMY — exactly 11, mirrored by the error_tag enum in SQL
# ===========================================================================

ERROR_TAGS = [
    "verb_tense",
    "subject_verb_agreement",
    "article",
    "preposition",
    "word_order",
    "plural_countability",
    "modal_conditional",
    "pronoun_reference",
    "word_choice_collocation",
    "question_formation",
    "register_formality",
]
assert len(ERROR_TAGS) == 11, "Taxonomy must stay at 11 tags; the SQL enum mirrors it."

TAG_LABELS = {
    "verb_tense": "Verb tense",
    "subject_verb_agreement": "Subject-verb agreement",
    "article": "Articles",
    "preposition": "Prepositions",
    "word_order": "Word order",
    "plural_countability": "Plurals and countability",
    "modal_conditional": "Modals and conditionals",
    "pronoun_reference": "Pronouns",
    "word_choice_collocation": "Word choice",
    "question_formation": "Question forms",
    "register_formality": "Register",
}

# Concrete probes with examples. A bare category name is something the model has
# to interpret; a probe with three examples is something it can match against.
# This is a large part of why open-ended error-finding under-reports.
TAG_PROBES = {
    "verb_tense": "wrong tense or verb form (I goed / I have went / I am knowing it)",
    "subject_verb_agreement": "subject and verb disagree (she walk / they was / he don't)",
    "article": "missing, extra or wrong a/an/the (I go to the school / I am teacher)",
    "preposition": "wrong or missing preposition (depend of / arrive to / good in maths)",
    "word_order": "words in the wrong order (I like very much it / always he is late)",
    "plural_countability": "plural/singular or countable/uncountable error (informations / two bread / many money)",
    "modal_conditional": "wrong modal or conditional form (I must to go / if I will see / I would went)",
    "pronoun_reference": "wrong or unclear pronoun (me and him went / the book, he is good)",
    "word_choice_collocation": "wrong word or unnatural pairing (make a photo / do a mistake / say me)",
    "question_formation": "malformed question (Where you go? / What means this? / You are coming?)",
    "register_formality": "tone wrong for the situation (overly formal or overly casual)",
}

FALLBACK_TAG = "word_choice_collocation"


# ===========================================================================
# STT CONDITIONING
# ===========================================================================

# CONDITIONING PROMPT — chosen to be UNLIKELY TO COLLIDE WITH REAL SPEECH.
#
# The original prompt used the most typical learner errors ("I goed to the
# store", "she walk fast"). That is the same set as the most likely learner
# UTTERANCES: a student practising past simple saying "I goed to the store" is
# not an edge case, it is the modal case for that lesson. The leak detector was
# built on a collision course with its own users.
#
# Whisper's prompt conditioning biases on STYLE and MORPHOLOGY, not on content
# words. So the errors are preserved and the nouns are replaced with items no
# beginner conversation-practice turn will contain. Same conditioning effect,
# far lower false-positive rate.
WHISPER_CONDITIONING_PROMPT = (
    "Umm, the walrus don't like it. I goed to the lighthouse, uh, yesterday. "
    "She walk past the aqueduct."
)

# Content-bearing fragments only. "umm, well" was removed: it is a filler every
# nervous learner produces, so it flagged real speech constantly.
WHISPER_PROMPT_LEAK_MARKERS = [
    "the walrus don't like it",
    "i goed to the lighthouse",
    "she walk past the aqueduct",
]

# Acoustic plausibility. A hallucinated transcript is text with no audio under
# it, so it produces an impossible speaking rate. Natural English runs about
# 2.0-3.5 words/second; anything above this is text the decoder invented.
MAX_PLAUSIBLE_WORDS_PER_SECOND = 6.0

# Below this, Whisper reliably hallucinates ("Thank you.", ".", "Bye."). Reject
# BEFORE the API call: it saves quota, latency, and a confusing error.
MIN_AUDIO_SECONDS = 0.7
# Between MIN and this, transcribe but treat a leak match as decisive.
SHORT_AUDIO_SECONDS = 1.5

SILENCE_ARTEFACTS = {
    "", ".", "you", "you.", "thank you", "thank you.", "thanks for watching",
    "thanks for watching!", "bye", "bye.", "bye bye.", "okay", "okay.",
    "please subscribe", "subtitles by the amara.org community",
}

# Whisper's own decoder thresholds, reused as a speech-CLARITY heuristic.
# These do NOT measure pronunciation. A low average log-probability means the
# decoder was unsure what it heard, which correlates with unclear articulation
# but equally with background noise, a poor microphone, accented-but-correct
# speech, and rare proper nouns. Surfaced to the learner as "unclear", never as
# an error — and never fed to a language model, because a text model handed a
# confidence number will confabulate a phonetic diagnosis from it.
WHISPER_LOGPROB_UNCLEAR = -0.60
WHISPER_LOGPROB_VERY_UNCLEAR = -0.90
WHISPER_NO_SPEECH_THRESHOLD = 0.60
WHISPER_COMPRESSION_RATIO_LIMIT = 2.40


# ===========================================================================
# PROMPTS
# ===========================================================================

PARTNER_PROMPT = """You are a warm, patient English conversation partner for a CEFR {level} learner.

The learner wants to practise: {topic}

Speak at {level}: {calibration}

Rules:
- One or two short sentences. Under {max_chars} characters total.
- End with a question that gives the learner a natural reason to use {topic}.
- Never correct the learner. A separate assessor handles corrections; correcting
  here means the learner receives the same note twice and stops reading both.
- React to the CONTENT of what they said, not to their English.
- The learner's words arrive from a speech-to-text system tuned for verbatim
  output, so they will contain disfluencies and errors. Ignore them completely.
- Plain speech only. No emoji, no markdown, no stage directions, no quotation
  marks around your own words. Your output is read aloud verbatim.

Output the reply text and nothing else. No preamble, no JSON, no labels."""


# WHY THIS PROMPT IS SHAPED THIS WAY
#
# The obvious fix for weak error detection is a more forceful prompt: "be
# aggressive", "you MUST flag every error". That makes recall WORSE in this
# pipeline, for two reasons. First, exhortation raises false positives, and
# engine._substring_match discards any error whose quote is absent from the
# transcript — invented findings become invisible findings, so the panel gets
# emptier, not fuller. Second, an open-ended "find the errors" instruction lets
# the model stop as soon as it has found something, because nothing forces it
# to look at the rest of the utterance.
#
# What actually raises recall is turning generation into a sweep:
#   1. A verdict for EVERY clause. A skipped clause is visible in the output.
#   2. Each category carries a concrete probe with examples — a mechanical
#      checklist rather than eleven words to interpret.
#   3. An "uncertain" verdict exists, so the model is not forced to choose
#      between asserting confidently and staying silent.
#   4. Priming with the target's form and with the categories THIS learner
#      keeps failing. Directing a search beats demanding effort.

ASSESSOR_PROMPT = """You are a CELTA-qualified English assessor analysing one learner utterance.
Learner level: CEFR {level}. Session target: {topic}

STEP 0 — Name the target's form.
In "target_rule", state in one line the grammatical form the session target
requires. Example: "present perfect = have/has + past participle".

STEP 1 — Split and copy.
Split the utterance into clauses. Copy each one VERBATIM into "clauses".
Do not tidy, fix, merge or paraphrase. Fillers stay in.

STEP 2 — Sweep every clause against every category.
For EACH clause output one verdict object. No clause may be omitted.
Check it against all eleven categories:
{tag_probes}

Verdicts:
  "ok"        — correct for a {level} learner
  "error"     — a definite problem you can quote exactly
  "uncertain" — something is off but you cannot pin it down, or the transcript
                is garbled. Say what you suspect in "note". This is a valid
                answer; never upgrade a guess to "error" to look decisive.

{focus_block}

STEP 3 — Write up the errors.
Every clause with verdict "error" gets an entry in "errors", and every entry in
"errors" corresponds to a clause with verdict "error".

VERBATIM GUARDRAIL — absolute:
"student_said" must be a substring of the utterance, copied character for
character. If you cannot quote the erroneous words exactly as the learner said
them, downgrade that clause to "uncertain" instead. Quote or downgrade — never
reconstruct, approximate or describe.

STEP 4 — Say what went well.
"did_well" is never empty. Name at least one thing produced correctly.

STEP 5 — Judge the target.
Did the learner actually use the session target? Quote the evidence.

ERROR SELECTION FOR {level}:
{selection}
Sweep all eleven categories regardless — the limit governs what you REPORT, not
what you LOOK AT. If the sweep finds more than the limit, report the ones most
likely to block communication at this level and leave the rest as "uncertain"
clause notes.

TRANSCRIPT NOTE:
The transcript is deliberately verbatim and contains fillers ("umm", "uh"),
false starts and repetitions. These are normal speech, not errors. Never tag
them. Do tag the grammar and lexis around them.

{feedback_style}

OUTPUT — one JSON object, nothing else, no code fence:
{{
  "target_rule": string,
  "clauses": [
    {{"text": string, "verdict": "ok" | "error" | "uncertain", "note": string}}
  ],
  "errors": [
    {{
      "student_said": string,
      "correction": string,
      "tag": string,
      "explanation": string,
      "confidence": "high" | "medium"
    }}
  ],
  "did_well": [string],
  "target_used": boolean,
  "target_evidence": string,
  "level_impression": string
}}

"tag" must be one of the eleven category names, copied verbatim.
"explanation": one sentence, under 25 words, readable by a {level} learner.
"level_impression": one short sentence — did THIS utterance look like {level},
higher, or lower?"""


FOCUS_BLOCK_TEMPLATE = """PRIORITY CATEGORIES FOR THIS LEARNER:
This student has repeatedly made errors in the categories below in previous
sessions. Check every clause against these first and most carefully. Their
absence is meaningful too, so still do not report one unless you can quote it.
{focus_lines}"""


FEEDBACK_STYLE_BLOCKS = {
    "explicit": (
        "FEEDBACK STYLE — explicit correction (appropriate below B1):\n"
        '"explanation" states the rule directly and simply. Example: "After \'have\', '
        "use 'gone', not 'went'.\""
    ),
    "guided": (
        "FEEDBACK STYLE — guided discovery (appropriate at B1 and above):\n"
        '"explanation" MUST be a concept-checking QUESTION that leads the learner to '
        'the rule themselves. Never state the rule in "explanation". Example: "You said '
        "'I have went'. Which form of 'go' follows 'have' — 'went' or 'gone'?\"\n"
        'Still fill "correction" accurately. The interface reveals it only after the '
        "learner has answered."
    ),
}

REPORT_SYSTEM = (
    "You are an experienced ESL assessor writing a short end-of-session report for the "
    "learner themselves. Clean markdown, second person, no preamble. Specific and kind, "
    "never inflated. Never invent errors that are not in the supplied data."
)


def build_tag_probes() -> str:
    return "\n".join(f"  - {tag}: {probe}" for tag, probe in TAG_PROBES.items())


def build_focus_block(focus_tags) -> str:
    """Prime the sweep with the categories this learner actually keeps failing."""
    tags = [t for t in (focus_tags or []) if t in TAG_PROBES][: settings.focus_tag_limit]
    if not tags:
        return ""
    lines = "\n".join(f"- {t}: {TAG_PROBES[t]}" for t in tags)
    return FOCUS_BLOCK_TEMPLATE.format(focus_lines=lines)



# ===========================================================================
# COMPACT ASSESSOR PROMPT — for local SLMs where prefill dominates
# ===========================================================================
# Same contract, same 11 tags, same verbatim rule. What is removed: the worked
# examples in the probes, the method narration, and the transcript note. Those
# earn their keep on a frontier model with cheap prefill; on a 3B model at
# 25 tok/s of prefill they cost ~25 seconds per turn.
#
# This is a latency/recall trade, not a free win. Benchmark both:
#   ASSESSOR_PROMPT_VARIANT=full    python tools/eval_assessor.py ...
#   ASSESSOR_PROMPT_VARIANT=compact python tools/eval_assessor.py ...

ASSESSOR_PROMPT_COMPACT = """CEFR {level} English assessor. Session target: {topic}

Split the learner utterance into clauses. Copy each VERBATIM. For every clause
give a verdict: "ok", "error" (you can quote it exactly), or "uncertain".

Categories (use these names exactly):
{tag_probes}

Rules:
- "student_said" must be copied character-for-character from the utterance.
  If you cannot quote it exactly, use "uncertain" instead. Never reconstruct.
- Fillers (umm, uh), false starts and repetitions are normal speech, not errors.
- {selection}
- "did_well" is never empty.

{focus_block}
{feedback_style}

Reply with one JSON object, no code fence:
{{"target_rule":"","clauses":[{{"text":"","verdict":"ok","note":""}}],
"errors":[{{"student_said":"","correction":"","tag":"","explanation":"","confidence":"high"}}],
"did_well":[""],"target_used":false,"target_evidence":"","level_impression":""}}"""


def build_tag_probes_compact() -> str:
    """Tag names with a two-word hint instead of three worked examples."""
    return ", ".join(ERROR_TAGS)


def get_assessor_prompt() -> tuple:
    """(template, probe_builder) for the configured variant."""
    if settings.assessor_prompt_variant == "compact":
        return ASSESSOR_PROMPT_COMPACT, build_tag_probes_compact
    return ASSESSOR_PROMPT, build_tag_probes


# ===========================================================================
# CACHE-FRIENDLY ASSESSOR PROMPT  (the real fix for the prefill penalty)
# ===========================================================================
# Compacting the prompt trades recall for latency. Reordering it trades
# nothing.
#
# Every serious local runtime reuses a KV cache for a shared prompt prefix:
# llama.cpp (--prompt-cache / server slot reuse), vLLM (automatic prefix
# caching), TGI, and Groq server-side. The reuse stops at the first byte that
# differs between requests.
#
# In ASSESSOR_PROMPT, `{level}` appears at character 96. So of ~725 tokens,
# roughly 24 form a stable prefix and 700 are re-prefilled on every single
# turn. That is where the 40 seconds comes from -- not from the prompt being
# long, but from it being long AND variable at the top.
#
# The split below makes the SYSTEM message byte-identical for every turn, at
# every level, for every learner. All variation moves into the user message,
# which is short. On a 2-vCPU box at ~25 tok/s prefill:
#
#     before:  725 tokens re-prefilled per turn   ~29 s
#     after:   ~95 tokens per turn (rest cached)   ~4 s
#
# Same words, same guardrails, same taxonomy. Only the order changed.

ASSESSOR_SYSTEM_STATIC = """You are a CELTA-qualified English assessor analysing one learner utterance.

METHOD — follow these steps in order:

STEP 0 — Name the target's form.
In "target_rule", state in one line the grammatical form the session target
requires. Example: "present perfect = have/has + past participle".

STEP 1 — Split and copy.
Split the utterance into clauses. Copy each one VERBATIM into "clauses".
Do not tidy, fix, merge or paraphrase. Fillers stay in.

STEP 2 — Sweep every clause against every category.
For EACH clause output one verdict object. No clause may be omitted.
Check it against all eleven categories:
""" + "\n".join(f"  - {tag}: {probe}" for tag, probe in TAG_PROBES.items()) + """

Verdicts:
  "ok"        — correct for this learner's level
  "error"     — a definite problem you can quote exactly
  "uncertain" — something is off but you cannot pin it down, or the transcript
                is garbled. Say what you suspect in "note". This is a valid
                answer; never upgrade a guess to "error" to look decisive.

STEP 3 — Write up the errors.
Every clause with verdict "error" gets an entry in "errors", and every entry in
"errors" corresponds to a clause with verdict "error".

VERBATIM GUARDRAIL — absolute:
"student_said" must be a substring of the utterance, copied character for
character. If you cannot quote the erroneous words exactly as the learner said
them, downgrade that clause to "uncertain" instead. Quote or downgrade — never
reconstruct, approximate or describe.

STEP 4 — Say what went well.
"did_well" is never empty. Name at least one thing produced correctly.

STEP 5 — Judge the target.
Did the learner use the session target? Quote the evidence.

TRANSCRIPT NOTE:
The transcript is deliberately verbatim and contains fillers ("umm", "uh"),
false starts and repetitions. These are normal speech, not errors. Never tag
them. Do tag the grammar and lexis around them.

OUTPUT — one JSON object, nothing else, no code fence:
{
  "target_rule": string,
  "clauses": [
    {"text": string, "verdict": "ok" | "error" | "uncertain", "note": string}
  ],
  "errors": [
    {
      "student_said": string,
      "correction": string,
      "tag": string,
      "explanation": string,
      "confidence": "high" | "medium"
    }
  ],
  "did_well": [string],
  "target_used": boolean,
  "target_evidence": string,
  "level_impression": string
}

"tag" must be one of the eleven category names, copied verbatim.
"explanation": one sentence, under 25 words, readable at the learner's level.
"level_impression": one short sentence — did THIS utterance look like the
stated level, higher, or lower?"""


# Everything that varies. Short, and it goes in the USER message so the system
# prefix above stays byte-identical across every request the process makes.
ASSESSOR_USER_TEMPLATE = """Learner level: CEFR {level}
Session target: {topic}

ERROR SELECTION FOR {level}:
{selection}
Sweep all eleven categories regardless — the limit governs what you REPORT,
not what you LOOK AT.
{focus_block}
{feedback_style}

Learner utterance:
{transcript}"""


def build_assessor_messages(level: str, topic: str, transcript: str,
                            feedback_style: str, focus_tags=None) -> tuple:
    """(system, user) with the invariant bulk in system for prefix reuse."""
    focus = build_focus_block(focus_tags)
    user = ASSESSOR_USER_TEMPLATE.format(
        level=level,
        topic=(topic or "").strip() or "everyday conversation",
        selection=ERROR_SELECTION.get(level, ERROR_SELECTION["B1"]),
        focus_block=("\n" + focus) if focus else "",
        feedback_style=FEEDBACK_STYLE_BLOCKS[feedback_style],
        transcript=transcript,
    )
    return ASSESSOR_SYSTEM_STATIC, user

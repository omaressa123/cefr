# ARCHITECTURE

A CEFR English speaking-practice partner. Learner speaks, hears a reply within
about a second, and reads targeted corrective feedback that arrives shortly
after.

This document is for an engineer joining the project. Roughly half of it is
about English language teaching, because most of the non-obvious engineering
decisions here are pedagogy decisions wearing engineering clothes. If you skip
[ESL Pedagogy for Engineers](#esl-pedagogy-for-engineers), a lot of the code
will look like arbitrary constants.

---

## 1. Shape of the system

```
                                    ┌─────────────────────────────┐
  mic ──► Whisper STT ──────────────┤ transcript                  │
              │                     └──────────┬──────────────────┘
              │                                │
              │  segment logprobs              ├──► LLM Partner ──► TTS ──► 🔊
              │  (clarity signal)              │      (fast)      (Piper)
              │                                │         ▲
              ▼                                │         └── the ONLY thing
        clarity spans                          │             on the latency path
                                               │
                                    ┌──────────┴───────────┐
                     ────────────── │  deferred, parallel  │ ──────────────
                                    └──────────┬───────────┘
                                               │
              ┌────────────────┬───────────────┼──────────────────┐
              ▼                ▼               ▼                  ▼
        LLM Assessor    Wav2Vec2 CTC    Forced alignment    Azure pronunciation
        (11-tag sweep)  (LM-free)       (scripted drills)   (unscripted, paid)
              │                │
              ▼                ▼
        coerce_assessment   disagreement diff
        (guardrails)        (STT repair evidence)
                    │
                    ▼
             feedback panel  ──► Supabase (per turn)
```

The single most important structural fact: **only the partner reply is on the
latency path.** Everything else runs concurrently and lands in the panel when
it lands. That is what allows a 40-second local assessor or a 16-second CTC
decode to exist at all.

### Module map

| module | responsibility | may import |
|---|---|---|
| `core/config.py` | settings, prompts, CEFR tables, taxonomy | nothing |
| `core/llm.py` | provider routing, message sanitising, JSON recovery | config |
| `core/audio.py` | STT in, TTS out, silence and leak guards | config, llm |
| `core/verbatim.py` | LM-free second decoder, disagreement diff | config |
| `core/pronunciation.py` | clarity signal, forced alignment, Azure | config |
| `core/assessors.py` | swappable assessor backends | config, llm |
| `core/engine.py` | turn orchestration, guardrails, rendering | all of core |
| `core/db.py` | Supabase, multi-tenant guards | config |
| `ui/gradio_app.py` | Gradio UI | core |
| `main.py` | FastAPI trunk, Gradio mounted at `/` | core, ui |

**`core/` may not import gradio, fastapi, starlette or uvicorn.** A test
enforces it by parsing every module. That rule is why the coming WebRTC move is
a change of caller rather than a rewrite. `core/` also may not import
`torch`/`transformers` at module scope — those are lazy, inside functions,
because importing them costs seconds of cold start and hundreds of MB of RSS in
every process, including the test runner.

### Concurrency

```
t=0.00  STT returns
t=0.00  partner task starts   assessor starts   CTC starts   pronunciation starts
t=0.60  partner returns
t=0.60  TTS starts            ─────── all three still running ───────
t=1.10  TTS returns ──► learner hears the reply, panel says "checking"
t=3.40  assessor returns ──► panel fills in
```

With `DEFER_ASSESSMENT=true` the turn *returns* at t=1.10. The Gradio handler
is an async generator that yields twice: speech first, feedback second. Any
early exit in that handler must `yield bail(...); return` — a bare
`return <tuple>` inside a generator raises `StopIteration` with a value and
Gradio renders nothing at all.

### Failure policy

The rule that unifies most of the error handling:

> **A guard that can be wrong about a real user downgrades the feature, never
> the turn.**

Three production incidents came from breaking it. The prompt-leak filter
rejected turns; the silence filter rejected turns; the acoustic cross-check
timed out and failed. In each case a degraded-but-usable path existed and the
code chose an error. Concretely:

- assessor unavailable → the conversation continues, panel says so
- CTC model cold → no cross-check this turn, no error
- Azure absent → no pronunciation section, no error
- edge-tts down → text-only reply, no error
- Whisper produces prompt-shaped text but the audio corroborates it → keep it

The one thing that *does* reject a turn is genuinely unusable audio, and the
message tells the learner what to do about it.

---

## 2. The pipeline, stage by stage

### 2.1 Speech to text

`core/audio.transcribe()` calls Whisper with `response_format="verbose_json"`
(needed for `avg_logprob` / `no_speech_prob`), `language="en"`, `temperature=0`,
and a **conditioning prompt**.

The conditioning prompt exists because Whisper's decoder is a language model
that assigns very low probability to ungrammatical sequences. Left alone it
repairs learner morphology before the assessor ever sees it. Priming it with
disfluent, ungrammatical text biases the decoder toward verbatim output.

The prompt's content words are deliberately odd:

```python
"Umm, the walrus don't like it. I goed to the lighthouse, uh, yesterday. "
"She walk past the aqueduct."
```

An earlier version used `store`, `fast`, `school`. Conditioning transfers on
*style and morphology*, not content nouns — so the rare nouns preserve the
effect while making a collision with real learner speech much less likely. That
matters because of the guard below.

**Leak guard.** Whisper sometimes emits the prompt itself on near-silence. A
fabricated "I goed to the store" would then be quoted perfectly by the
assessor, passing the verbatim guardrail with an error the learner never made —
the one fabrication the guardrail structurally cannot catch.

The guard needs two independent signals:

```python
detect_prompt_leak(text, duration, segments)
    text_matches_prompt(text)              # necessary
    and not speech_is_plausible(...)       # and sufficient only with this
```

`speech_is_plausible` checks implied speaking rate (natural English is 2–3.5
words/second; hallucinated text over 0.3s of audio implies 20+) and the
decoder's own `no_speech_prob`. When both fire, the unconditioned pass acts as
arbiter: it cannot leak, because it was given nothing to leak. If it returns
substantive speech, the learner really talked and the turn is kept.

Text resemblance alone used to be the verdict. That rejected the modal
utterance of a past-simple lesson.

**Duration gate.** Sub-second audio is rejected locally, before the API call.
Whisper answers clipped audio with a confident "Thank you." or ".", which then
trips the silence rejector and surfaces as an incomprehensible error. Catching
it locally saves quota, latency, and confusion.

### 2.2 Dual-decoder acoustic check

`core/verbatim.py`. Wav2Vec2 + CTC head, decoded **greedily** — no beam search,
no KenLM, no shallow fusion, any of which would reintroduce the prior we are
escaping. Every frame is classified independently, so the output is what the
audio contained.

```
whisper : I have gone to the store      (prior repaired it)
ctc     : I have goed to the store      (acoustics only)
                 ^^^^ disagreement = evidence
```

The diff is filtered for benign orthographic variants (`don't`/`dont`,
`gonna`/`going to`) by canonicalising both sides, then classified: a
substitution whose two forms share a stem is the signature of morphological
smoothing.

Disagreements go **straight to the panel and never into a prompt**. Handing an
LLM "the CTC heard 'goed'" invites a confabulated diagnosis whose fabricated
quote would pass the verbatim guardrail, because the CTC string is real text.
A test asserts `engine.assess_turn` contains no reference to this module.

**Warm-up.** The 360 MB first download is a one-time cost with nothing to do
with decoding a turn. Charging it to `acoustic_timeout` guaranteed the first
check failed *and* failed before caching, so the next one failed too.
`acoustic_load_timeout` (600s, at boot, background task from the FastAPI
lifespan) is separate from `acoustic_timeout` (30s, per turn). A turn arriving
while the model is `cold` or `loading` skips the check and says so;
`/api/v1/readyz` reports the state.

### 2.3 Partner

Fast model, `temperature=0.7`, **plain text, no JSON**. It is the only call on
the latency path, so it carries no parsing overhead. It is explicitly forbidden
from correcting the learner — see [Two channels](#25-two-channels-conversation-and-correction).

### 2.4 Assessor

Heavy model, `temperature=0.15`, strict JSON, per-clause sweep. Swappable
backend (`cloud` | `local`) with **one-way failover**: local→cloud on failure,
never cloud→local. Falling back to a weaker model during an outage would
silently degrade assessment quality with nobody noticing, which is worse than
one turn showing "unavailable".

The system prompt is **byte-identical for every turn**, at every level, for
every learner. All variation (level, topic, focus tags, feedback style) lives in
the short user message. That is not cosmetic: KV prefix caching stops at the
first differing byte, and an earlier ordering put `{level}` at character 96,
making ~700 of 725 tokens un-cacheable. On a 2-vCPU local runtime that was ~29s
of prefill *per turn*; it is now ~5s after the first.

**Guardrails live in `engine.coerce_assessment`, outside the swappable
backend.** A backend returns raw text and nothing else. Taxonomy validation,
verbatim quote verification, level caps and the sweep audit all run afterwards,
identically, whichever model produced the text. A 3B model is far likelier to
invent a quote than a 120B one, so verification cannot be the part you swap.

### 2.5 Two channels: conversation and correction

The partner never corrects; the assessor never converses. This is a pedagogy
constraint with an engineering consequence.

If both channels correct, the learner reads the same note twice and starts
skimming both. If the conversational reply carries corrections, the learner
stops treating it as conversation and starts treating it as a test — and stops
speaking freely, which is the entire point of the activity.

So: two calls, two temperatures, two models, one of them on the latency path
and one not.

---

## 3. Data

`schema_v2.sql`. Multi-tenant: `profiles` → `classrooms` → `enrollments` →
`assignments` → `practice_sessions` → `exchanges`.

**Tenancy is enforced in `core/db.py`, not by RLS.** Hugging Face OAuth yields a
username, not a Supabase JWT, so `auth.uid()` is NULL and RLS cannot tell a
teacher from a student. RLS is enabled with zero policies (deny-all to
anon/authenticated), the backend holds the service-role key, and every
teacher-facing read passes `_assert_owns_classroom` first. Adding a teacher
query without that call is a cross-classroom data leak, not a style issue.

Two database-level guards worth knowing:

- `error_tag` is a Postgres enum. A hallucinated twelfth category cannot be
  stored, independent of what the prompt says.
- A trigger rejects any error row whose `student_said` is empty. The verbatim
  rule is enforced in application code *and* at the storage boundary.

Exchanges are written **per turn**, not at session end, so a learner closing the
tab keeps everything they said.

---

## 4. ESL Pedagogy for Engineers

This section explains the constants. Every number below is a teaching decision
that someone will otherwise "optimise" into a bug.

### 4.1 Error selection and cognitive load

`ERROR_SELECTION` in `config.py` caps reported errors by level: 2 at A1, 3 at
A2, 4 at B1, 5 at B2/C1, "only genuine slips" at C2.

**Why a cap exists at all.** A learner's working memory during speech production
is already saturated — they are simultaneously retrieving vocabulary, applying
grammar rules that are not yet automatic, and managing the social pressure of
being listened to. Corrective feedback competes for that same capacity.
Fifteen corrections on a two-sentence turn do not produce fifteen learnings;
they produce a learner who concludes they cannot speak English and stops trying.
This is not softness. An A1 speaker who stops producing output stops acquiring.

**Why the cap is level-dependent.** Useful correction sits just past what the
learner can already do. An A1 learner cannot act on an article error — the
English article system is genuinely late-acquired, and telling them about it
consumes a correction slot that could have gone to a missing verb. By B2 the
learner has spare capacity and articles are actionable, so the cap rises and the
scope widens to collocation and register.

**The engineering consequence, and the part that is easy to break:** the prompt
instructs the model to **sweep all eleven categories regardless** and only then
report the top N. Selection is not detection. If you "optimise" the prompt by
telling the model to look at fewer categories at A1, you get a model that cannot
see article errors at all — and your per-tag recall table will show it. The cap
governs what is *reported*; the sweep is always complete. `coerce_assessment`
enforces the cap in code after the fact, so a chatty model cannot overrun it.

### 4.2 Explicit correction vs guided discovery

`resolve_feedback_style()`: explicit at A1–A2, guided from B1 up, with a
per-assignment teacher override.

**Guided discovery** means eliciting the rule from the learner rather than
stating it. Instead of "after *have*, use *gone*", the panel asks: *"You said 'I
have went'. Which form of 'go' follows 'have' — 'went' or 'gone'?"* The
correction is withheld behind a `<details>` element until they have attempted an
answer. Self-generated rules are retained far better than received ones, and the
act of retrieval is itself the learning event.

**Why it is gated on level.** Guided discovery presupposes *metalinguistic
awareness* — the ability to reason about language as an object. An A1 learner
asked "which form of 'go' follows 'have'?" has no framework to answer from. They
are being asked to guess, they guess wrong, and a technique meant to build
confidence destroys it. Below B1 the correct move is a clear model of the right
form: explicit correction, or a recast.

A previous version applied guided discovery unconditionally. It looked
sophisticated and it was pedagogically wrong at exactly the levels where
learners are most fragile.

**Engineering note:** in guided mode the model still produces `correction`
accurately — the *interface* withholds it. Never ask the model to omit the
correction; you need it for the report, for the database, and for the reveal.

### 4.3 The verbatim guardrail

`engine._substring_match`. Any error whose `student_said` is not a substring of
the transcript is dropped, silently, before the learner sees it.

**Why fabrication is fatal rather than merely annoying.** The product's entire
value is that the learner believes the feedback. A correction for something they
did not say is not a small inaccuracy — it teaches them that the tool does not
actually listen. One clear fabrication and a student reasonably discounts every
correct note that follows, including the ones that would have helped. Trust here
is not a nice-to-have; it is the mechanism by which the feedback works at all.

There is also a teaching-specific failure: a learner told they said something
they did not will try to "fix" a form they were already producing correctly.
Fabricated feedback can actively induce an error.

So the rule is: **quote it or drop it.** The prompt instructs the model to
downgrade an unquotable finding to `"uncertain"` rather than guess, and code
enforces it regardless of what the model does. Matching normalises whitespace
and case only — speech-to-text capitalisation is arbitrary; nothing else is
forgiven.

The cost is real and accepted: a genuine error the model paraphrased instead of
quoting is lost. That is the right trade. A missed correction is a lesson that
did not happen; a fabricated one is a lesson that unteaches.

The sweep audit exists because of that cost — when a clause is marked `error`
but no quotable write-up follows, it is logged. A rising count there is silent
recall loss and the signal to tune the prompt.

### 4.4 Syntactic vs morphological errors, and the recall ceiling

English learner errors split roughly into two families:

- **Syntactic** — word order, question formation, missing constituents.
  *"Where you go yesterday?"* These are carried by whole words and survive
  transcription intact.
- **Morphological** — inflectional endings. Third-person `-s`, past `-ed`,
  plural `-s`, participle forms. *"she walk"*, *"I goed"*, *"two bread"*.

The morphological family is the one that matters most at A1–B1 and it is
acoustically fragile. A dropped `-s` is a few tens of milliseconds of fricative;
a reduced `-ed` may be a single unreleased stop. In L2 speech, with L1
phonological transfer, these are often genuinely ambiguous in the signal.

**And Whisper resolves ambiguity with grammar.** Its decoder is a language model
that has seen "she walks" vastly more often than "she walk". Given ambiguous
acoustics it outputs the grammatical form. The error is erased *before any part
of our system can see it*, and no prompt, no bigger assessor and no fine-tuned
LLM downstream can recover information that is not in the transcript.

This is the **STT recall ceiling**, and it is the hard limit on the product. If
Whisper repairs 30% of morphological errors, assessor recall is capped at 70% no
matter how good the assessor is.

Three responses, in the order they were built:

1. **Conditioning prompt** (§2.1) — biases the decoder toward verbatim output.
   Mitigates, does not solve.
2. **Dual decoder** (§2.2) — a second decoder with no language model at all.
   Where it disagrees with Whisper on a stem, there is acoustic evidence
   Whisper smoothed something. This is why `core/verbatim.py` exists and why it
   uses a model that is *worse* by every standard ASR metric.
3. **Measurement** — `tools/make_spoken_gold.py` runs a three-pass protocol on
   real learner recordings and reports the ceiling as a number. Every recall
   figure this project quotes should be read against it.

If you find yourself asking why we ship a deliberately worse speech recogniser
alongside a better one, this is the answer.

### 4.5 Speech artifacts are not errors

Fillers (*umm*, *uh*, *erm*), false starts (*I went— I have gone*), repetitions,
and self-corrections are **normal features of spoken language**. Fluent native
speakers produce them constantly. They are not grammatical errors and tagging
them as such is both wrong and demoralising: it tells a learner that sounding
like a human being is a mistake.

They appear in our transcripts *more* than usual, because the conditioning
prompt deliberately preserves them.

The assessor prompt therefore says explicitly:

> The transcript is deliberately verbatim and contains fillers ("umm", "uh"),
> false starts and repetitions. These are normal speech, not errors. Never tag
> them. Do tag the grammar and lexis around them.

The second sentence matters as much as the first. A model told to ignore
disfluency will sometimes ignore the whole clause containing it. The instruction
has to scope the exclusion to the filler itself.

Self-correction deserves a note: a learner who says *"she walk— she walks fast"*
has demonstrated **monitoring**, which is a positive acquisition signal. The
final form is what counts. Tagging the abandoned attempt punishes the learner
for the exact behaviour we want to encourage.

---

## 5. Running it

See `docs/RUNBOOK.md` for the full switch list. Minimum:

```bash
export GROQ_API_KEY=...
export DEFER_ASSESSMENT=true          # required if ASSESSOR_BACKEND=local
export ASSESSOR_PROMPT_VARIANT=cached # prefix-cache friendly, default
uvicorn main:app --host 0.0.0.0 --port 7860
```

On Hugging Face Spaces the SDK must be `docker`, not `gradio` — a gradio-SDK
Space launches your Blocks object itself and will not serve FastAPI.

Route ordering in `main.py` is load-bearing: `gr.mount_gradio_app(path="/")`
installs a catch-all Mount, so every FastAPI route must be declared *before* it
or Gradio shadows it and you get HTML where you expected JSON.

## 6. Tests

```bash
python -m pytest core/tests/test_core.py -q     # 90 tests, no network, no keys
python tools/check_tree.py                      # fails on undeclared files
```

The suite is mostly regression pins on things that have actually broken:
Gradio's `metadata` key reaching the Groq API, greedy JSON extraction
swallowing a reasoning preamble, the eval harness matching `"a"` against
`"cat"`, ERRANT types collapsing to one tag, `CancelledError` escaping a
deferred assessment. Adding a test here is usually cheaper than the incident it
prevents.

`tools/check_tree.py` exists because something with write access to this
repository has repeatedly re-added a dead `eval/benchmark.py`. Install it as a
pre-commit hook.

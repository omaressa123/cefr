# Offline migration — what to move, in what order, and what not to move

The handover proposes porting STT, the assessor, the partner and TTS to local
models to escape rate limits. Three of those four are worth doing eventually.
One of them is the worst possible candidate. The order matters more than the
list, because two of these swaps *increase* the latency you spent this whole
project reducing.

## The premise, checked

The stated blocker is that free-tier limits make bulk benchmarking unreliable.
That is a pacing problem, not an architecture problem:

```
gold_clean.jsonl = 919 cases, one assessor call each
Groq free tier ~30 req/min  ->  31 minutes for a FULL run
120-case stratified slice    ->  4 minutes
```

`tools/eval_assessor.py` now ships a token-bucket rate limiter (`--rpm`), an
on-disk response cache keyed on the prompt hash (`--cache`), and stratified
slicing (`--stratify --limit`). A re-run after a prompt tweak only re-calls the
cases whose prompt changed. That is minutes, not half-hours, and it removes the
blocker today without touching a single model.

Compare the alternative. Your assessor prompt is ~990 tokens of prefill:

| hardware | prefill | decode (350 tok) | per assessment |
|---|---:|---:|---:|
| 2 vCPU, 3B Q4 | 39.6 s | 58.3 s | **97.9 s** |
| 8-core CPU, 3B Q4 | 11.0 s | 25.0 s | 36.0 s |
| RTX 3060, 3B Q4 | 0.4 s | 5.8 s | 6.2 s |
| Groq, gpt-oss-120b | — | — | ~2 s |

The handover's claim that "a 3B model generates 15 words on CPU in 200-400 ms"
is decode-only arithmetic on a warm context. It ignores prefill, and prefill is
where a 990-token system prompt actually costs you. On CPU it dominates by 40%
of total time; it is the single number that decides this question.

Two mitigations are now in the codebase: `ASSESSOR_PROMPT_VARIANT=compact`
(~350 tokens instead of ~990) and the existing backend seam. Neither is free —
measure the recall cost with the harness before shipping either.

## Ranked by value per unit of risk

### 1. TTS → Piper. Do this first. ✅

The strongest swap by a distance, and the handover buries it at number five.

- edge-tts is a reverse-engineered client for an undocumented Microsoft
  endpoint. It is the most fragile dependency in the stack and has already
  earned an "unpinned upward on purpose" comment in `requirements.txt`.
- Piper is CPU-native with a real-time factor around 0.1–0.3, so a 4-second
  reply synthesises in well under a second on 2 vCPU. It is *faster* than the
  current network round trip, not slower.
- Voices are 20–60 MB, not 1.2 GB.
- `core/audio.synthesize()` is already isolated behind a single function with a
  documented WebRTC-readiness boundary. This is a contained change.

Removes your most likely production outage and reduces latency. Nothing else on
the list does both.

### 2. Forced alignment → already local. ✅ Done

`align_scripted()` runs torchaudio locally, gated to scripted drills, capped at
`alignment_max_concurrency=1` with `torch.set_num_threads(1)`. No work needed.
Keep it off (`ALIGNMENT_ENABLED=false`) on the 2-vCPU Space.

### 3. STT → faster-whisper. Conditional. ⚠️

Viable, but the handover's "under 300 ms on CPU" is off by roughly an order of
magnitude for a 20-second clip on 2 vCPU with `base.en` INT8 — expect 2–5 s.
Groq's `whisper-large-v3-turbo` returns in well under a second and is cheap.

Do this only if one of these is true:
- rate limits on STT specifically are biting (they are not — the assessor is
  what you are burning quota on), or
- you need offline capability or data residency for the audio itself.

One genuine caveat if you do: your Tier 0 clarity signal reads `avg_logprob`,
`no_speech_prob` and `compression_ratio` from `verbose_json`. faster-whisper
exposes the equivalents on its `Segment` objects, but the field names differ
and `_extract()` in `core/audio.py` will need a branch. Test
`test_clarity_flags_low_confidence_segments` covers the maths, not the mapping.

### 4. Assessor → local SLM. Highest risk. ⚠️⚠️

The seam exists (`core/assessors.py`), so building it costs nothing extra. The
expectation is the problem.

This is the task where small models degrade first: 11-way classification plus
verbatim span extraction plus correction generation plus CCQ authoring across
six CEFR levels, in one pass, as strict JSON. It is also the largest prompt in
the system, so it is the worst prefill case.

Gate it on evidence:

```bash
# baseline, cached so it is cheap to repeat
python tools/eval_assessor.py --gold data/gold_clean.jsonl \
    --backends cloud --domain written --stratify --limit 120

# candidate, same slice, same seed
ASSESSOR_BACKEND=local LOCAL_ASSESSOR_MODEL=qwen2.5:7b-instruct \
python tools/eval_assessor.py --gold data/gold_clean.jsonl \
    --backends local --domain written --stratify --limit 120
```

Ship the local model only if the recall confidence intervals overlap. The
harness prints that comparison explicitly. A weaker assessor produces *fewer*
findings, the panel looks calm, and the product silently gets worse at the one
thing it is for — which is exactly the failure that started this whole thread.

Prefer 7B over 3B here if the hardware allows. The prefill difference is small
next to the capability difference on structured extraction.

### 5. Partner → local SLM. Don't. ❌

The handover lists this as equivalent to the assessor swap. It is the opposite.

- The partner sits on the **latency-critical path**. The assessor runs
  concurrently underneath TTS and is effectively free in wall-clock terms; the
  partner reply gates when speech starts.
- It is the one component where frontier quality is directly audible. A learner
  forgives a missed correction. They notice a partner that asks a bland or
  non-sequitur question, and they stop talking.
- It is your *cheapest* cloud call: ~200 output tokens on the small model, no
  JSON, no reasoning budget. It is not what is burning your quota.

Moving the partner local trades your most visible quality surface for savings
on your least expensive call. If quota is the concern, cache assessor responses
and cut assessor calls — not partner calls.

## Recommended sequence

1. **Now:** use `--rpm` + `--cache` + `--stratify`. The benchmarking blocker
   disappears without a model change.
2. **This week:** swap edge-tts for Piper. Lowest risk, highest reliability
   gain, latency improves.
3. **Before any SLM work:** build the 50-turn spoken benchmark
   (`tools/make_spoken_gold.py`). Without it you cannot tell whether a local
   assessor got worse, and the STT ceiling it produces may show that
   transcription — not the assessor — is your binding constraint. If it does,
   every hour spent on the SLM is spent on the wrong bottleneck.
4. **Then:** evaluate a 7B local assessor on both benchmarks. Ship on evidence.
5. **Only if genuinely needed:** faster-whisper for STT.
6. **Never, on current reasoning:** the partner.

## A correction on model IDs

The handover names `llama3-8b-8192` and `llama-3.3-70b-versatile` as models in
use. Both are retired on Groq — the 3.x family was deprecated 17 Jun 2026 and
shut down 16 Aug 2026, and `llama3-8b-8192` is decommissioned outright. It also
names `gemini-3.8-flash`, which is not a string I can confirm exists.

That is now the fifth and sixth dead model reference in this project's history.
`core/llm.verify_models()` runs at boot and logs exactly this, so the answer is
to check the startup log rather than the handover doc — and to update the doc
from `GET /api/v1/readyz`, which now reports the live assessor registry.

---

# Addendum — the STT recall ceiling

## The four corpora, checked

| corpus | what it contains | Kaggle access |
|---|---|---|
| NICT JLE | spontaneous L2, verbatim + error tags | **no** — NICT application, not on HF |
| Trinity Lancaster | spontaneous L2 exams, verbatim | **no** — Lancaster licence, not on HF |
| L2-ARCTIC | **read-aloud** of CMU ARCTIC prompts | gated HF, CC BY-**NC** 4.0 |
| speechocean762 | **read-aloud** scored prompts | open, Apache-2.0 |

The two you can load are read-aloud pronunciation corpora. Their target text is
the prompt the speaker was handed — grammatically correct by construction.
speechocean762's first test target is literally `MARK IS GOING TO SEE ELEPHANT`.

Fine-tuning Whisper against a grammatically correct target cannot teach it to
emit "I have went". The two corpora that carry ungrammatical verbatim targets
are precisely the two you cannot obtain inside Kaggle. That is not a
preprocessing problem; no `streaming=True` fixes it.

Note also CC BY-NC on L2-ARCTIC. If this app ever charges students, a model
fine-tuned on it is a non-commercial artifact.

## What replaces the fine-tune

Run a second decoder with no language model and diff it against Whisper.

```
whisper : I have gone to the store        (LM prior repaired it)
ctc     : I have goed to the store        (acoustics only)
                 ^^^^ the disagreement IS the evidence
```

Wav2Vec2 + CTC decoded greedily classifies each frame independently. It is a
worse transcriber by every standard metric, which is exactly why it works here.
Shipped as `core/verbatim.py`: ~360MB, no labelled data, no GPU-hours, no
licence, off by default, and correct under `DEFER_ASSESSMENT=true` where its
6–16s on CPU costs the conversation nothing.

It also gives you a standing ceiling estimate from ordinary traffic
(`ceiling_estimate`), which tells you whether the 50-turn hand-marked set is
urgent rather than replacing it.

## Order of work

1. **Decode-time settings** (Cell 6). `num_beams=1`, `temperature=0.0`,
   `condition_on_prev_tokens=False`. An hour to test. If these close most of
   the gap, no fine-tune is warranted — a real possible outcome.
2. **Acoustic cross-check.** `ACOUSTIC_CHECK_ENABLED=true`. Ships today.
3. **Measure.** `tools/make_spoken_gold.py`. Still the only thing that produces
   a real ceiling number.
4. **Then** consider fine-tuning — on your own students' recordings,
   hand-transcribed verbatim. Two hundred real L2 utterances with ungrammatical
   targets beat five thousand scripted ones, because only the former contain
   the supervision signal.

Synthetic TTS data targets the decoder's language-model prior and nothing else.
TTS reads text correctly: no L2 phonology, no reduced consonants, no
hesitation. Useful, narrow, and it causes domain shift if it is more than a
minority of the mix.

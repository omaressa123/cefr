# Verbatim quantization evaluation — whisper-verbatim-merged (Whisper-small)

Date: 2026-09-14. Tool: whisper.cpp `whisper-cli` (greedy: beam-size 1,
temperature 0.0), language `en`, initial prompt
`Umm, well, he don't like it. I goed to the store...` (same conditioning
prompt as `backend/src/core/audio.js` and `scripts/whisper-server.py`).
Clips: `eval/verbatim-test/*.wav` (t08 = t02 + added noise).
Reference: `hf_reference.json` (expected learner sentence per clip, errors intact).

## Per-clip transcripts (verbatim, exact CLI output, case as produced)

### Baseline f16 (`ggml-verbatim-small-f16.bin`, 487,634,339 bytes ≈ 465 MiB) — 8/8 exact

| clip | transcript |
|---|---|
| t01_he_dont.wav | HE DON'T LIKE IT |
| t02_goed.wav | I GOED TO THE STORE YESTERDAY |
| t03_she_have.wav | SHE HAVE TWO BROTHERS |
| t04_they_was.wav | THEY WAS HAPPY TO SEE US |
| t05_since.wav | I HAVE LIVED HERE SINCE FIVE YEARS |
| t06_clean.wav | THE WEATHER IS NICE TODAY AND I WENT FOR A WALK IN THE PARK |
| t07_childrens.wav | THE CHILDRENS PLAYED IN THE GARDEN ALL AFTERNOON |
| t08_goed_noisy.wav | I GOED TO THE STORE YESTERDAY |

### q5_1 (`ggml-verbatim-small-q5_1.bin`, 190,118,819 bytes ≈ 181 MiB) — 8/8 exact, identical to baseline

| clip | transcript |
|---|---|
| t01_he_dont.wav | HE DON'T LIKE IT |
| t02_goed.wav | I GOED TO THE STORE YESTERDAY |
| t03_she_have.wav | SHE HAVE TWO BROTHERS |
| t04_they_was.wav | THEY WAS HAPPY TO SEE US |
| t05_since.wav | I HAVE LIVED HERE SINCE FIVE YEARS |
| t06_clean.wav | THE WEATHER IS NICE TODAY AND I WENT FOR A WALK IN THE PARK |
| t07_childrens.wav | THE CHILDRENS PLAYED IN THE GARDEN ALL AFTERNOON |
| t08_goed_noisy.wav | I GOED TO THE STORE YESTERDAY |

### q5_0 (`ggml-verbatim-small-q5_0.bin`, 175,243,043 bytes ≈ 167 MiB) — 7/8 (⚠ t07 deviates)

| clip | transcript |
|---|---|
| t01_he_dont.wav | HE DON'T LIKE IT |
| t02_goed.wav | I GOED TO THE STORE YESTERDAY |
| t03_she_have.wav | SHE HAVE TWO BROTHERS |
| t04_they_was.wav | THEY WAS HAPPY TO SEE US |
| t05_since.wav | I HAVE LIVED HERE SINCE FIVE YEARS |
| t06_clean.wav | THE WEATHER IS NICE TODAY AND I WENT FOR A WALK IN THE PARK |
| t07_childrens.wav | ⚠ THE CHILDREN'S PLAYED IN THE GARDEN ALL AFTERNOON (baseline: CHILDRENS, no apostrophe) |
| t08_goed_noisy.wav | I GOED TO THE STORE YESTERDAY |

### q4_0 (`ggml-verbatim-small-q4_0.bin`, 145,491,491 bytes ≈ 139 MiB) — 7/8 (⚠ t07 deviates, same as q5_0)

| clip | transcript |
|---|---|
| t01_he_dont.wav | HE DON'T LIKE IT |
| t02_goed.wav | I GOED TO THE STORE YESTERDAY |
| t03_she_have.wav | SHE HAVE TWO BROTHERS |
| t04_they_was.wav | THEY WAS HAPPY TO SEE US |
| t05_since.wav | I HAVE LIVED HERE SINCE FIVE YEARS |
| t06_clean.wav | THE WEATHER IS NICE TODAY AND I WENT FOR A WALK IN THE PARK |
| t07_childrens.wav | ⚠ THE CHILDREN'S PLAYED IN THE GARDEN ALL AFTERNOON (baseline: CHILDRENS, no apostrophe) |
| t08_goed_noisy.wav | I GOED TO THE STORE YESTERDAY |

t07 deviation confirmed deterministic across 2 repeat runs on all 4 levels
(f16/q5_1 → CHILDRENS both times; q5_0/q4_0 → CHILDREN'S both times).

## Flags

- Grammar autocorrection: NONE observed at any level. No quantized version
  "fixed" a learner error the baseline preserved — `don't`, `goed`, `have`,
  `was`, `since five years`, `childrens` all survive; the noisy clip (t08)
  is transcribed word-identically to the clean take (t02) at every level.
- Word-accuracy drop on noisy clip: NONE. t08 == t02 == reference at all 4 levels.
- Verbatim deviation (not grammar, but breaks character-for-character
  fidelity): q5_0 and q4_0 both insert an apostrophe on t07
  (`CHILDRENS` → `CHILDREN'S`). The app's quotation guardrail matches error
  quotes character-for-character against the transcript, so even a
  punctuation insertion is a fidelity loss versus baseline. q5_1 matches the
  baseline exactly on all 8 clips.

## Recommendation

**Ship q5_1 (190,118,819 bytes ≈ 181 MiB) as the on-device model.** It is the
smallest tested quantization that preserves baseline verbatim behavior on
every clip (8/8 identical, no autocorrection, noisy-clip parity). q4_0 is
~45 MB smaller but demonstrably normalizes t07 punctuation, so per the
project rule (never trade verbatim fidelity for file size) it is rejected
despite the size win. Serve on-demand download on first launch (do NOT
bundle): 181 MB would ~5x the install size and risks the iOS 200 MB
cellular-install limit; the app already implements this via
`ensureOfflineModel()` + `GET /models/:file` on the backend.

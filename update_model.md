# Model Update — On-device STT quantization pick + offline-fallback integration

Date: 2026-09-14

## 1. Phase 2 — quantization evaluation

Method: `whisper.cpp whisper-cli`, greedy (`-bs 1 --temperature 0.0`), `-l en`,
initial prompt `Umm, well, he don't like it. I goed to the store...` (same
conditioning prompt, language, and greedy decoding the backend
`backend/src/core/audio.js` / `scripts/whisper-server.py` and the on-device
path `mobile/src/stt/offlineStt.js` use). 8 clips in `eval/verbatim-test/`
(t08 = t02 + added noise). Full per-clip table: `eval/verbatim-test/RESULTS.md`.

| Model | Size (bytes) | Score | Verdict |
|---|---|---|---|
| f16 (baseline) | 487,634,339 (~465 MiB) | 8/8 exact | reference |
| **q5_1** | **190,118,819 (~181 MiB)** | **8/8, identical to baseline** | ✅ ship |
| q5_0 | 175,243,043 (~167 MiB) | 7/8 (t07 deviates) | ❌ rejected |
| q4_0 | 145,491,491 (~139 MiB) | 7/8 (t07 deviates) | ❌ rejected |

Baseline f16 and q5_1 transcripts (identical on every clip):

- t01: `HE DON'T LIKE IT`
- t02: `I GOED TO THE STORE YESTERDAY`
- t03: `SHE HAVE TWO BROTHERS`
- t04: `THEY WAS HAPPY TO SEE US`
- t05: `I HAVE LIVED HERE SINCE FIVE YEARS`
- t06: `THE WEATHER IS NICE TODAY AND I WENT FOR A WALK IN THE PARK`
- t07: `THE CHILDRENS PLAYED IN THE GARDEN ALL AFTERNOON`
- t08 (noisy): `I GOED TO THE STORE YESTERDAY`

Flags:

- Grammar autocorrection: none at any level — no quantized model fixed an
  error the baseline preserved.
- Noisy-clip accuracy drop: none — t08 == t02 == reference at all 4 levels.
- Verbatim deviation (q5_0, q4_0, t07 only, deterministic across repeat runs):
  `CHILDRENS` → `CHILDREN'S`. Not a grammar fix, but breaks the
  character-for-character fidelity the quotation guardrail depends on.

**Recommendation: ship q5_1.** Smallest level verbatim-identical to baseline
on every clip. q4_0 is ~45 MB smaller but normalizes t07 punctuation, so it
is rejected per the no-size-over-fidelity rule.

## 2. Correction applied (prior claim was wrong)

In-progress code claimed q4_0 had baseline parity and hardcoded it. The runs
above disprove that. Changed:

- `backend/models/`: replaced `ggml-verbatim-small-q4_0.bin` with
  `ggml-verbatim-small-q5_1.bin` (190118819 bytes, gitignored, served via
  `GET /models/:file`).
- `mobile/src/stt/offlineStt.js`: `OFFLINE_MODEL_FILENAME` /
  `OFFLINE_MODEL_BYTES` → q5_1 values; verdict comment rewritten with the
  q4_0/q5_0 rejection rationale.
- `backend/src/index.js`: model-hosting comment → q5_1 name and size.

## 3. Phase 3 — offline fallback (on-device STT is a fallback, not a replacement)

Backend stays primary because `analyzeGrammar` (11-category taxonomy) is
server-side only. Mobile integration:

- `whisper.rn@0.7.4` + `expo-dev-client`; `run:android`/`run:ios` scripts;
  Expo Go blocked with explanatory error (`isOfflineSttSupported()`).
  whisper.rn needs no Expo config plugin (autolinking). Expo Go will not work.
- 181 MB model is **on-demand download on first launch**, not bundled
  (would ~5x install size, risks iOS 200 MB cellular-install limit).
- Audio flow (`PracticeSessionScreen.js`): backend `submitAudioTurn` first;
  only network/timeout errors fall back to `transcribeOffline`. Offline turns
  carry `errors: null` (never a fake-clean `[]`), an
  `OFFLINE — grammar feedback pending` badge, and the banner
  "You're offline — transcription only, no grammar feedback yet. ...".
- Reconnect: queued turns resubmit the **audio** through the normal backend
  path (auto after next online turn + manual sync button) for retroactive
  grammar assessment, replacing the transcription-only turn.

## 4. Verification done

- Quantization table above (real model bytes, real clips); evidence in
  `eval/verbatim-test/RESULTS.md`.
- Backend tests 6/6 pass; JS syntax checks pass on all touched files.
- `HEAD /models/ggml-verbatim-small-q5_1.bin` → `200 OK` (fresh server).
- `npx expo prebuild --platform android` re-ran clean; fixed missing
  `expo-asset` peer dep; `expo-doctor` down to 2 advisories (non-CNG sync
  note, RN-Directory metadata for `expo-av`/`whisper.rn`).

## 5. Remaining before sign-off

One physical-device pass (Gradle assemble was skipped): disable network →
record a deliberate mistake → confirm verbatim transcript + offline banner →
re-enable → confirm assessment appears and the queue drains.

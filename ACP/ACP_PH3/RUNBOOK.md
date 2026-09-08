# Runbook — the switches that matter

## Latency and the local-model question

| variable | default | what it does |
|---|---|---|
| `ASSESSOR_PROMPT_VARIANT` | `cached` | `cached` hoists the invariant bulk into a byte-stable system message so a KV prefix cache hits. `full` is the old ordering. `compact` trims content and costs recall — last resort. |
| `DEFER_ASSESSMENT` | `false` | Return speech as soon as it is ready and let the assessor finish afterwards. **Turn this on whenever `ASSESSOR_BACKEND=local`.** |
| `DEFERRED_ASSESSMENT_TIMEOUT` | `120` | How long a deferred assessment may run before the panel gives up. |
| `ASSESSOR_BACKEND` | `cloud` | `local` points at any OpenAI-compatible endpoint. Not the Space — a machine you control. |
| `LOCAL_ASSESSOR_URL` | `http://localhost:11434/v1` | Ollama, vLLM, llama.cpp server, LM Studio. |

### Making the prefix cache actually hit

The reordering only pays off if your runtime reuses the prefix:

```bash
# vLLM
vllm serve Qwen/Qwen2.5-7B-Instruct --enable-prefix-caching

# llama.cpp server (slot reuse is on by default; keep one slot per worker)
llama-server -m qwen2.5-7b-instruct-q4_k_m.gguf --parallel 1 --ctx-size 4096

# Ollama reuses the prefix automatically; keep the model resident
OLLAMA_KEEP_ALIVE=1h ollama serve
```

Verify it worked: the first assessment is slow, the second on the same process
is much faster. If turn 2 costs the same as turn 1, the cache is not hitting and
the reorder bought you nothing.

## Text to speech

| variable | default | notes |
|---|---|---|
| `TTS_BACKEND` | `auto` | `auto` uses Piper when a voice is set, else edge-tts. `piper` fails loudly rather than silently going remote. `edge` is the legacy path. |
| `PIPER_VOICE_PATH` | — | Path to a `.onnx` voice. Set this and `auto` stops depending on Microsoft. |

```bash
pip install piper-tts
# voices: https://huggingface.co/rhasspy/piper-voices  (en_GB-alba-medium is ~60MB)
export PIPER_VOICE_PATH=/opt/voices/en_GB-alba-medium.onnx
```

Per-level tempo is preserved: `TTS_RATE` percentages map onto Piper's
`length_scale`, so A1 still gets slower speech.

## Benchmarking without hitting quota

```bash
# full run, paced and cached — 919 cases in ~31 min, re-runs near-free
python tools/eval_assessor.py --gold data/gold_clean.jsonl \
    --domain written --rpm 25 --cache .eval_cache/responses.jsonl

# fast iteration slice, even across levels
python tools/eval_assessor.py --gold data/gold_clean.jsonl \
    --domain written --stratify --limit 120
```

The cache keys on the prompt hash, so a prompt edit re-calls only what changed.

## Regenerate the gold set (required — the old one is mistagged)

```bash
python tools/convert_m2_to_gold.py B.dev.gold.bea19.m2 data/gold.jsonl --level B --report
python tools/audit_gold.py --gold data/gold.jsonl --write-clean data/gold_clean.jsonl
```

## Drift guard

```bash
python tools/check_tree.py            # fails on undeclared files
python tools/check_tree.py --update   # accept an intentional change
```

Install as a pre-commit hook:

```bash
printf '#!/bin/sh\npython tools/check_tree.py || exit 1\npython -m pytest core/tests/test_core.py -q || exit 1\n' \
  > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
```

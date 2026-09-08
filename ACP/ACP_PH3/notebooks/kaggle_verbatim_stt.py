"""
notebooks/kaggle_verbatim_stt.py
================================
Kaggle cells for the verbatim-STT work. Each CELL block is one notebook cell.

READ CELL 0 BEFORE RUNNING ANYTHING. Two of your four corpora cannot be loaded
in Kaggle, and the two that can do not contain the supervision you need. The
cells below reflect that rather than pretending otherwise.

Environment assumed: Kaggle, 2x T4, 20GB /kaggle/working, 12h session.
T4 is Turing (sm_75): fp16 YES, bf16 NO. Every config here uses fp16.
"""

# =========================================================================
# CELL 0 — WHAT THIS CAN AND CANNOT DO
# =========================================================================
"""
| corpus            | content                         | Kaggle access        |
|-------------------|---------------------------------|----------------------|
| NICT JLE          | spontaneous L2, verbatim + tags | NO — NICT application|
| Trinity Lancaster | spontaneous L2, verbatim        | NO — Lancaster licence|
| L2-ARCTIC         | READ-ALOUD of ARCTIC prompts    | gated HF, CC BY-NC   |
| speechocean762    | READ-ALOUD scored prompts       | open, Apache-2.0     |

The two loadable corpora are read-aloud pronunciation sets. Their target text
is the PROMPT the speaker was given, which is grammatically correct by
construction — speechocean762's is literally "MARK IS GOING TO SEE ELEPHANT".

Fine-tuning Whisper against a grammatically correct target cannot teach it to
emit "I have went". The corpora with ungrammatical verbatim targets are exactly
the two you cannot obtain here.

So these cells do three honest things:
  A. Load speechocean762 and (optionally) L2-ARCTIC as ACOUSTIC EVALUATION
     sets — measuring how L2 speech degrades your models, not training on them.
  B. Build a synthetic set from gold_clean.jsonl that targets the DECODER'S
     LANGUAGE-MODEL PRIOR specifically. Scoped and caveated in Cell 3.
  C. Fine-tune with a config that survives a 12h Kaggle session on T4s.

CC BY-NC on L2-ARCTIC is a licence flag, not a formality: if this app ever
charges students, a model fine-tuned on it is a non-commercial artifact.
"""

# =========================================================================
# CELL 1 — ENVIRONMENT. Run first. Disk discipline matters more than speed.
# =========================================================================
CELL_1 = r'''
import os, shutil, subprocess, sys

# HF caches default to ~/.cache, which lives on the same 20GB as your outputs.
# Whisper-small + datasets + checkpoints will exhaust it without this.
os.environ["HF_HOME"]            = "/kaggle/working/hf"
os.environ["HF_DATASETS_CACHE"]  = "/kaggle/working/hf/datasets"
os.environ["TRANSFORMERS_CACHE"] = "/kaggle/working/hf/models"
os.environ["TOKENIZERS_PARALLELISM"] = "false"
# One visible GPU. Seq2SeqTrainer on 2xT4 in a notebook falls back to
# DataParallel, which replicates the model to GPU0 and OOMs on the larger
# batches you are about to simulate. One T4 + gradient accumulation is both
# simpler and, in a notebook, usually faster.
os.environ["CUDA_VISIBLE_DEVICES"] = "0"

!pip -q install -U "transformers>=4.44" "datasets>=2.20" "accelerate>=0.33" evaluate jiwer soundfile librosa

import torch
print("torch", torch.__version__, "| cuda", torch.cuda.is_available())
print("gpu:", torch.cuda.get_device_name(0))
print("bf16 supported:", torch.cuda.is_bf16_supported())   # False on T4 -> use fp16

def disk():
    total, used, free = shutil.disk_usage("/kaggle/working")
    print(f"/kaggle/working: {used/2**30:.1f}GB used, {free/2**30:.1f}GB free")
disk()
'''

# =========================================================================
# CELL 2 — DATA. Evaluation corpora, loaded honestly.
# =========================================================================
CELL_2 = r'''
from datasets import load_dataset, Audio
import numpy as np

# --- speechocean762: open, Apache-2.0, 2500 train / 2500 test -------------
# NOTE: streaming=True is the wrong tool here. This set is ~1.4GB and streaming
# forbids the random access the Trainer wants. Load it, cap it, cast the audio
# column. Reach for streaming when a corpus exceeds disk, not by default.
so762 = load_dataset("mispeech/speechocean762", split="test")
so762 = so762.cast_column("audio", Audio(sampling_rate=16_000))
print("speechocean762:", len(so762), "utterances")
print("target text is the PROMPT:", so762[0]["text"])
print("  -> grammatically correct by construction. Evaluation only.")

# --- L2-ARCTIC: gated. Accept terms on the dataset page first. -------------
# from huggingface_hub import login; login(token="hf_...")   # gated-read token
USE_L2ARCTIC = False
if USE_L2ARCTIC:
    l2 = load_dataset("KoelLabs/L2Arctic", split="scripted")
    l2 = l2.cast_column("audio", Audio(sampling_rate=16_000))
    print("L2-ARCTIC:", len(l2), "| LICENCE: CC BY-NC 4.0 — non-commercial only")

# --- Memory-safe 16kHz handling -------------------------------------------
# datasets' Audio feature decodes lazily, one example at a time, and resamples
# on access. That already avoids the RAM spike; an explicit torchaudio pass
# over the whole corpus would materialise every waveform and is what actually
# blows Kaggle's RAM. Do not "optimise" this into a .map() that returns arrays.

def peek(ds, n=3):
    for i in range(n):
        a = ds[i]["audio"]
        print(f"  {a['array'].shape[0]/a['sampling_rate']:.1f}s @ {a['sampling_rate']}Hz"
              f" | {ds[i]['text'][:60]}")
peek(so762)
'''

# =========================================================================
# CELL 3 — SYNTHETIC DATA. Scoped to what it can actually teach.
# =========================================================================
CELL_3 = r'''
"""
WHAT THIS DOES AND DOES NOT DO

TTS reads text correctly. Feed Piper "I have went to the store" and it
pronounces "went" clearly, in a native voice, with no L2 phonology, no reduced
/d/, no epenthesis, no hesitation. The ACOUSTIC problem you are trying to fix
is entirely absent from the output.

What this data CAN do is move the decoder's language-model prior. Whisper's
decoder currently assigns near-zero probability to the token sequence
"have went". Training on audio-text pairs where that sequence is the target
raises it. That is a real and useful effect, and it is the mechanism behind the
repair you are seeing.

What it CANNOT do is teach the encoder to hear L2 speech. And used alone it
causes documented domain shift: models fine-tuned on synthetic speech degrade
on real speech. MIX_RATIO below keeps real audio in the majority for that
reason. Do not raise it because the synthetic data is easier to get.
"""
import json, io, os, subprocess, tempfile, wave
import numpy as np, torch
from torch.utils.data import IterableDataset

GOLD = "/kaggle/input/cefr-gold/gold_clean.jsonl"   # upload as a Kaggle dataset
MIX_RATIO = 0.30            # synthetic share of the training mix. Ceiling, not target.

!pip -q install piper-tts
VOICE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx"
!mkdir -p /kaggle/working/voices
!wget -q -O /kaggle/working/voices/en_US-lessac-medium.onnx {VOICE_URL}
!wget -q -O /kaggle/working/voices/en_US-lessac-medium.onnx.json {VOICE_URL}.json
VOICE = "/kaggle/working/voices/en_US-lessac-medium.onnx"

class SyntheticErrorSpeech(IterableDataset):
    """Synthesises in the __iter__ loop and yields arrays. Nothing is written to
    disk, so 900 utterances cost ~0 of your 20GB instead of ~2GB of wav."""

    def __init__(self, jsonl_path, voice_path, processor, max_items=None):
        self.rows = [json.loads(l) for l in open(jsonl_path) if l.strip()]
        if max_items:
            self.rows = self.rows[:max_items]
        self.voice_path, self.processor = voice_path, processor
        self._voice = None

    def _load(self):
        if self._voice is None:
            from piper import PiperVoice
            self._voice = PiperVoice.load(self.voice_path)
        return self._voice

    def _synth(self, text):
        voice = self._load()
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            voice.synthesize(text, w)
        buf.seek(0)
        with wave.open(buf, "rb") as w:
            sr = w.getframerate()
            audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
        audio = audio.astype(np.float32) / 32768.0
        if sr != 16_000:
            import librosa
            audio = librosa.resample(audio, orig_sr=sr, target_sr=16_000)
        return audio

    def __iter__(self):
        info = torch.utils.data.get_worker_info()
        rows = self.rows if info is None else self.rows[info.id::info.num_workers]
        for row in rows:
            text = row.get("transcript", "").strip()
            if not (3 < len(text.split()) < 40):
                continue                     # Whisper's 30s window; keep it short
            try:
                audio = self._synth(text)
            except Exception:
                continue                     # one bad row must not kill the epoch
            feats = self.processor.feature_extractor(
                audio, sampling_rate=16_000).input_features[0]
            labels = self.processor.tokenizer(text).input_ids
            yield {"input_features": feats, "labels": labels}

print("Synthetic set targets the DECODER PRIOR only. Keep it a minority of the mix.")
'''

# =========================================================================
# CELL 4 — TRAINING. T4-correct, resumable, disk-bounded.
# =========================================================================
CELL_4 = r'''
from dataclasses import dataclass
from typing import Any
import torch, evaluate
from transformers import (WhisperProcessor, WhisperForConditionalGeneration,
                          Seq2SeqTrainer, Seq2SeqTrainingArguments)

MODEL = "openai/whisper-small"       # large-v3 does not fit a single T4 for training
OUT   = "/kaggle/working/whisper-verbatim"

processor = WhisperProcessor.from_pretrained(MODEL, language="english", task="transcribe")
model = WhisperForConditionalGeneration.from_pretrained(MODEL)

# THE ACTUAL "PENALISE THE LM PRIOR" LEVER.
# There is no Seq2SeqTrainingArguments flag for this. The prior lives in the
# decoder weights, so the decoder must be trainable — freezing it, which is the
# usual Whisper fine-tuning advice, is exactly backwards for this goal.
model.freeze_encoder()               # keep acoustic features; adapt the LM
for p in model.model.decoder.parameters():
    p.requires_grad = True

# forced_decoder_ids injects a language/task prefix that also nudges toward
# fluent output. Clear it and set generation config explicitly instead.
model.generation_config.forced_decoder_ids = None
model.generation_config.suppress_tokens = []
model.config.suppress_tokens = []

@dataclass
class Collator:
    processor: Any
    def __call__(self, features):
        batch = self.processor.feature_extractor.pad(
            [{"input_features": f["input_features"]} for f in features],
            return_tensors="pt")
        labels = self.processor.tokenizer.pad(
            [{"input_ids": f["labels"]} for f in features], return_tensors="pt")
        ids = labels["input_ids"].masked_fill(labels.attention_mask.ne(1), -100)
        if (ids[:, 0] == self.processor.tokenizer.bos_token_id).all():
            ids = ids[:, 1:]
        batch["labels"] = ids
        return batch

wer = evaluate.load("wer")
def compute_metrics(pred):
    ids = pred.label_ids.copy()
    ids[ids == -100] = processor.tokenizer.pad_token_id
    return {"wer": 100 * wer.compute(
        predictions=processor.batch_decode(pred.predictions, skip_special_tokens=True),
        references=processor.batch_decode(ids, skip_special_tokens=True))}

args = Seq2SeqTrainingArguments(
    output_dir=OUT,
    # 8 x 4 = effective batch 32 on 16GB. Raise accumulation, never batch size.
    per_device_train_batch_size=8,
    gradient_accumulation_steps=4,
    gradient_checkpointing=True,          # ~40% VRAM back for ~20% throughput
    learning_rate=1e-5,                   # decoder-only adaptation; higher forgets
    warmup_steps=200,
    max_steps=3000,
    fp16=True,                            # T4 is sm_75: fp16 only, NO bf16
    bf16=False,
    # SURVIVING THE 12h WALL
    save_steps=250,
    save_total_limit=2,                   # ~3GB each with optimiser state
    eval_strategy="steps",
    eval_steps=250,
    load_best_model_at_end=True,
    metric_for_best_model="wer",
    greater_is_better=False,
    predict_with_generate=True,
    generation_max_length=200,
    logging_steps=25,
    report_to=[],
    dataloader_num_workers=2,             # >2 starves Kaggle's 4 vCPUs
    remove_unused_columns=False,          # required for IterableDataset
)

trainer = Seq2SeqTrainer(
    args=args, model=model, data_collator=Collator(processor),
    compute_metrics=compute_metrics, tokenizer=processor.feature_extractor,
    # train_dataset=..., eval_dataset=...
)

# RESUME after a session times out. Re-run this cell in a fresh session with
# the previous /kaggle/working committed as a dataset input.
import glob, os
ckpts = sorted(glob.glob(f"{OUT}/checkpoint-*"), key=os.path.getmtime)
trainer.train(resume_from_checkpoint=ckpts[-1] if ckpts else None)
'''

# =========================================================================
# CELL 5 — THE ACOUSTIC ALTERNATIVE. No language model at all.
# =========================================================================
CELL_5 = r'''
"""
This is the architectural answer to "prioritise acoustic fidelity over
grammatical probability", and it needs no fine-tuning whatsoever.

Wav2Vec2 + CTC head, decoded greedily, has NO language model. Every frame is
classified independently, so the output is what the audio contained. It is a
worse transcriber than Whisper on every standard metric — which is the point.

Do not attach a KenLM decoder or use beam search here. Either one reintroduces
the exact prior you are removing.
"""
import torch, torchaudio
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

CTC = "facebook/wav2vec2-base-960h"          # 360MB; large-960h-lv60-self is better, 1.2GB
proc = Wav2Vec2Processor.from_pretrained(CTC)
ctc  = Wav2Vec2ForCTC.from_pretrained(CTC).eval()

def acoustic(path):
    wav, sr = torchaudio.load(path)
    if wav.shape[0] > 1: wav = wav.mean(0, keepdim=True)
    if sr != 16_000: wav = torchaudio.functional.resample(wav, sr, 16_000)
    with torch.inference_mode():
        logits = ctc(proc(wav.squeeze().numpy(), sampling_rate=16_000,
                          return_tensors="pt").input_values).logits
    return proc.batch_decode(torch.argmax(logits, -1))[0]

# Pair it with Whisper and diff. Disagreement = acoustic evidence that Whisper
# smoothed something. That is core/verbatim.py in the main repo, and it ships
# today with no GPU-hours and no licence.
from transformers import pipeline
whisper = pipeline("automatic-speech-recognition", model="openai/whisper-small",
                   generate_kwargs={"language": "english", "num_beams": 1})

def compare(path):
    return {"whisper": whisper(path)["text"].strip(), "acoustic": acoustic(path)}
'''

# =========================================================================
# CELL 6 — CHEAP WINS TO TRY BEFORE ANY OF THE ABOVE
# =========================================================================
CELL_6 = r'''
"""
Decode-time settings that reduce Whisper's smoothing at zero cost. Measure
these against your 50-turn spoken set BEFORE spending a 12-hour session.

  num_beams=1                    beam search averages over hypotheses and
                                 favours the fluent one. Greedy does not.
  temperature=0.0                no fallback sampling
  condition_on_prev_tokens=False stops earlier fluent context priming the
                                 decoder toward more fluent continuations
  no_repeat_ngram_size=0         leave learner repetition alone
  prompt=<learner-error text>    already in core/audio.py

If the four together close most of the gap, the fine-tune is not worth a
12-hour session. That is a real possible outcome and worth an hour to check.
"""
gen_kwargs = dict(
    language="english", task="transcribe",
    num_beams=1, temperature=0.0,
    condition_on_prev_tokens=False,
    no_repeat_ngram_size=0,
)
'''

CELLS = [CELL_1, CELL_2, CELL_3, CELL_4, CELL_5, CELL_6]

if __name__ == "__main__":
    for i, cell in enumerate(CELLS, 1):
        print(f"\n{'='*70}\n# CELL {i}\n{'='*70}{cell}")

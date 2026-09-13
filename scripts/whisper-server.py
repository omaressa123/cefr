"""
Local Verbatim-Whisper STT sidecar for the CEFR Practice Partner.

Loads the fine-tuned checkpoint in `whisper-verbatim-merged/` (a Whisper
encoder-decoder model trained to transcribe learner speech VERBATIM — i.e. it
preserves morphological/grammar errors instead of auto-correcting them, which
is exactly what the downstream grammar assessor needs) and serves it behind
an OpenAI-compatible `/audio/transcriptions` endpoint.

Both the web app and the mobile app reach this model through the SAME path:

    web/mobile -> POST /api/v1/sessions/:id/turns/audio (backend)
               -> core/audio.js transcribe()
               -> POST {STT_BASE_URL}/audio/transcriptions (this server)
               -> whisper-verbatim-merged -> {"text": "..."}

so behaviour cannot drift between platforms.

Usage:
    /tmp/opencode/whisper-env/bin/python scripts/whisper-server.py \
        --model /home/omaressa/omar/cefr-practice-partner/whisper-verbatim-merged \
        --host 0.0.0.0 --port 7860

    # then in backend/.env:
    STT_BASE_URL=http://localhost:7860
    STT_MODEL=whisper-verbatim-merged

Endpoints:
    GET  /health                 -> {status, model, device, loaded}
    POST /audio/transcriptions   -> {text}  (OpenAI-compatible shape;
                                     accepts multipart `file`, plus optional
                                     `prompt` (used as initial prompt to nudge
                                     verbatim transcription), `language`,
                                     `response_format`)
"""

from __future__ import annotations

import argparse
import io
import os
import subprocess
import tempfile

import numpy as np
import torch
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse
from transformers import WhisperFeatureExtractor, WhisperProcessor, WhisperForConditionalGeneration

# Same conditioning prompt the backend sends (backend/src/core/audio.js).
# It nudges the model to transcribe errors verbatim rather than "fixing" them.
DEFAULT_CONDITIONING_PROMPT = "Umm, well, he don't like it. I goed to the store..."

# Whisper natively handles up to 30 s per forward pass.
MAX_CLIP_SECONDS = 30
TARGET_SAMPLE_RATE = 16000

app = FastAPI(title="CEFR Verbatim-Whisper STT")
state: dict = {"model": None, "processor": None, "extractor": None, "model_id": "", "device": "cpu"}


def load_model(model_path: str) -> None:
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32
    model = WhisperForConditionalGeneration.from_pretrained(model_path, dtype=dtype)
    model.to(device)
    model.eval()
    state["model"] = model
    state["processor"] = WhisperProcessor.from_pretrained(model_path)
    state["extractor"] = WhisperFeatureExtractor.from_pretrained(model_path)
    state["model_id"] = os.path.basename(os.path.normpath(model_path))
    state["device"] = device
    print(f"[whisper-server] loaded '{model_path}' on {device} ({dtype})", flush=True)


def _decode_audio(raw: bytes) -> "tuple":
    """Decode arbitrary uploaded audio bytes (webm, mp4, ogg, wav, …) to
    16 kHz mono float32 numpy array.

    Chrome/Firefox MediaRecorder produces audio/webm (Opus codec) which
    soundfile cannot open.  We try soundfile first (fast, works for WAV/FLAC),
    then fall back to ffmpeg which handles every container the browser can emit.
    """
    import soundfile as sf

    # Fast path: WAV / FLAC / OGG already work with soundfile
    try:
        data, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=False)
        return _postprocess(data, sr)
    except Exception:
        pass  # fall through to ffmpeg

    # ffmpeg path: webm/opus, mp4/aac, etc.
    tmp_in = tmp_out = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".input", delete=False) as f:
            f.write(raw)
            tmp_in = f.name
        tmp_out = tmp_in + ".wav"
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", tmp_in,
                "-ar", str(TARGET_SAMPLE_RATE),
                "-ac", "1",
                "-f", "wav",
                tmp_out,
            ],
            capture_output=True,
        )
        if result.returncode != 0:
            stderr = result.stderr.decode(errors="replace")
            raise RuntimeError(f"ffmpeg failed (exit {result.returncode}): {stderr[-300:]}")
        data, sr = sf.read(tmp_out, dtype="float32", always_2d=False)
        return _postprocess(data, sr)
    finally:
        for p in (tmp_in, tmp_out):
            if p:
                try:
                    os.unlink(p)
                except OSError:
                    pass


def _postprocess(data: np.ndarray, sr: int) -> "tuple":
    """Ensure mono, resample to 16 kHz, and truncate to 30 s."""
    if data.ndim > 1:
        data = data.mean(axis=1)
    if sr != TARGET_SAMPLE_RATE:
        try:
            import librosa
            data = librosa.resample(data, orig_sr=sr, target_sr=TARGET_SAMPLE_RATE)
        except ImportError:
            ratio = TARGET_SAMPLE_RATE / sr
            new_len = int(len(data) * ratio)
            data = np.interp(
                np.linspace(0, len(data) - 1, new_len),
                np.arange(len(data)),
                data,
            ).astype(np.float32)
    max_samples = MAX_CLIP_SECONDS * TARGET_SAMPLE_RATE
    if len(data) > max_samples:
        print(f"[whisper-server] clip truncated to {MAX_CLIP_SECONDS}s", flush=True)
        data = data[:max_samples]
    return data, TARGET_SAMPLE_RATE


def transcribe_array(waveform, sample_rate: int, initial_prompt: str, language: str = "en") -> str:
    extractor = state["extractor"]
    processor = state["processor"]
    model = state["model"]

    inputs = extractor(waveform, sampling_rate=sample_rate, return_tensors="pt")
    input_features = inputs.input_features.to(model.device, dtype=model.dtype)

    prompt_ids = None
    if initial_prompt:
        prompt_ids = processor.get_prompt_ids(initial_prompt, return_tensors="pt").to(model.device)

    forced_ids = processor.get_decoder_prompt_ids(language=language, task="transcribe")
    # Whisper's decoder is capped at 448 target positions total, INCLUDING the
    # prompt_ids we prepend for verbatim conditioning plus the 4 special start
    # tokens (<sot><lang><transcribe><notimestamps>). With the default
    # conditioning prompt a fixed max_new_tokens=448 always overflows, so
    # every transcription fails. Shrink the generation budget to fit.
    prompt_len = prompt_ids.shape[-1] if prompt_ids is not None else 0
    max_new = max(1, 448 - prompt_len - 4)
    with torch.no_grad():
        predicted = model.generate(
            input_features,
            forced_decoder_ids=forced_ids,
            prompt_ids=prompt_ids,
            max_new_tokens=max_new,
            num_beams=1,
            do_sample=False,
        )
    text = processor.batch_decode(predicted, skip_special_tokens=True)[0]
    return text.strip()


@app.get("/health")
def health():
    return {
        "status": "ok" if state["model"] is not None else "loading",
        "model": state["model_id"],
        "device": state["device"],
        "loaded": state["model"] is not None,
        "verbatim": True,
    }


@app.post("/audio/transcriptions")
async def audio_transcriptions(
    file: UploadFile = File(...),
    model: str = Form("whisper-verbatim-merged"),
    prompt: str = Form(DEFAULT_CONDITIONING_PROMPT),
    language: str = Form("en"),
    response_format: str = Form("json"),
):
    if state["model"] is None:
        return JSONResponse({"error": "model not loaded yet"}, status_code=503)
    try:
        raw = await file.read()
        if not raw:
            return JSONResponse({"error": "empty audio file"}, status_code=400)
        waveform, sr = _decode_audio(raw)
        text = transcribe_array(waveform, sr, initial_prompt=prompt or "", language=language or "en")
        if response_format == "text":
            return JSONResponse(text, status_code=200)
        return {"text": text}
    except Exception as exc:  # never leak a stack trace over the wire
        print(f"[whisper-server] transcription failed: {exc}", flush=True)
        return JSONResponse({"error": f"transcription failed: {exc}"}, status_code=500)


def main() -> None:
    parser = argparse.ArgumentParser(description="CEFR verbatim-Whisper STT sidecar")
    parser.add_argument("--model", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "whisper-verbatim-merged"))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7860)
    args = parser.parse_args()

    load_model(args.model)

    import uvicorn

    with tempfile.TemporaryDirectory():
        uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()

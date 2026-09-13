# Verbatim-Whisper STT sidecar image.
# Serves the fine-tuned checkpoint in whisper-verbatim-merged/ behind an
# OpenAI-compatible /audio/transcriptions endpoint (scripts/whisper-server.py).
# The model directory is mounted read-only at /model by docker-compose.yml;
# it is intentionally NOT baked into the image so the 467MB checkpoint
# doesn't bloat every rebuild.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# ffmpeg: decodes browser audio (webm/opus, mp4/aac) that soundfile can't open.
# libsndfile1: runtime lib for the `soundfile` package.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Build context is the repo root (see docker-compose.yml); the root
# .dockerignore keeps the context to just these two files.
COPY stt/requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt
COPY scripts/whisper-server.py ./whisper-server.py

EXPOSE 7860
CMD ["python", "whisper-server.py", "--model", "/models/whisper-verbatim-merged", "--host", "0.0.0.0", "--port", "7860"]

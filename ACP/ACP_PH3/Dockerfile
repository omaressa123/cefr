# Hugging Face Spaces: set `sdk: docker` and `app_port: 7860` in README.md
# front matter. The gradio SDK cannot serve a FastAPI app.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

RUN useradd -m -u 1000 appuser
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=appuser:appuser . .
RUN mkdir -p tts_out && chown appuser:appuser tts_out
USER appuser

EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request;urllib.request.urlopen('http://localhost:7860/healthz')"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]

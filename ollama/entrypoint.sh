#!/bin/sh
# Ollama entrypoint: serve the API, then ensure the models the app needs are
# present. `ollama pull` is idempotent (skips models already in /root/.ollama,
# which persists via the ./data/ollama bind mount), so this is safe to run on
# every `docker compose up`.
set -e

# Models required by the backend (must match LLM_FAST_MODEL / LLM_HEAVY_MODEL).
REQUIRED_MODELS="qwen3:4b"

ollama serve &
SERVER_PID=$!
trap "kill $SERVER_PID" TERM INT

# Wait for the daemon before pulling.
i=0
until ollama list >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "[entrypoint] ollama daemon did not start in time" >&2
    exit 1
  fi
  sleep 2
done

for model in $REQUIRED_MODELS; do
  echo "[entrypoint] ensuring model: $model"
  # Retry transient registry/network failures, but never kill the daemon:
  # if the pull ultimately fails the healthcheck stays red (model absent)
  # and dependent services correctly wait instead of starting broken.
  attempt=0
  until ollama pull "$model"; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 5 ]; then
      echo "[entrypoint] giving up on $model after $attempt attempts - daemon stays up, healthcheck stays red" >&2
      break
    fi
    echo "[entrypoint] pull failed, retrying in 30s (attempt $attempt/5)..." >&2
    sleep 30
  done
done
echo "[entrypoint] model setup finished"

wait "$SERVER_PID"

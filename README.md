# CEFR English Practice Partner — Self-Hosted Stack

A self-hosted rebuild of the CEFR English Practice Partner: a Node.js/Express
API, a React web app, and a React Native (Expo) mobile app, sharing one
MySQL database. Dark theme UI, matching the violet/amber palette from the
original architecture diagrams.

**No AI model is bundled.** Every place that needs speech-to-text, an LLM,
or text-to-speech is a small, clearly-marked adapter in
`backend/src/core/` that you point at whatever you're running (Groq, a local
vLLM/Ollama server, OpenAI-compatible endpoint, etc.) via environment
variables. Text-to-speech uses the free Microsoft Edge TTS voices through the
`msedge-tts` package — no model to host for that part.

## What's inside

```
cefr-practice-partner/
├── docker-compose.yml       # database + api + web, one command up
├── backend/                 # Node.js (Express) API — the "core" package
│   └── src/
│       ├── core/
│       │   ├── llmRouter.js   # <-- plug your LLM here (env-configured)
│       │   ├── audio.js       # <-- plug your STT here / real Edge-TTS
│       │   ├── engine.js      # orchestrator: concurrent reply + assessment
│       │   └── taxonomy.js    # the 11 closed error categories
│       ├── db/               # schema.sql + pool + migrate script
│       ├── routes/           # /api/v1/* endpoints
│       └── middleware/       # JWT auth, tenancy checks
├── web/                      # React (Vite) dark-theme web app
└── mobile/                   # React Native (Expo) app, same API, same theme
```

## Architecture (kept from the original spec)

- **API-first**: everything lives behind `/api/v1/*`; the web app and mobile
  app are both just clients of it.
- **Multi-tenant classrooms**: `profiles → classrooms → enrollments →
  assignments → practice_sessions → exchanges`, enforced at the application
  layer (`backend/src/middleware/auth.js` + per-route ownership checks) —
  same "deny-all at the DB, enforce in code" posture as the original, except
  here Postgres RLS is simply not used at all since auth is our own JWTs.
- **Zero perceived latency**: `core/engine.js` fires the fast conversational
  reply and the heavy 11-category grammar assessment **concurrently**
  (`Promise.allSettled`), then synthesizes TTS while the assessment finishes
  in the background — same trick as the original `core/engine.py`.
- **Verbatim quotation guardrail**: `core/engine.js` throws out any grammar
  error whose `quote` field isn't a character-for-character substring of the
  transcript, so the assessor can't hallucinate mistakes the student didn't
  make.
- **Closed error taxonomy**: exactly 11 hardcoded categories in
  `core/taxonomy.js`, injected into the assessor prompt so it can't invent
  new ones.
- **Guided discovery vs. explicit correction**: `core/engine.js` switches
  prompt strategy by CEFR level (A1–A2 = explicit rule; B1+ = concept-check
  question with the answer hidden client-side).

## Quick start (self-hosted, one command)

1. Copy `backend/.env.example` to `backend/.env` and fill in:
  - `JWT_SECRET` — a long random string (at least 32 characters)
   - `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_FAST_MODEL`, `LLM_HEAVY_MODEL` —
     your OpenAI-compatible chat endpoint (Groq, a local Ollama/vLLM server
     with an OpenAI-compatible shim, etc.)
   - `LLM_FALLBACK_BASE_URL` / `LLM_FALLBACK_API_KEY` — optional fallback
     provider (Google's OpenAI-compatible endpoint works here)
   - `STT_BASE_URL`, `STT_API_KEY`, `STT_MODEL` — an OpenAI-compatible
     `/audio/transcriptions` endpoint (Groq's Whisper endpoint matches this
     shape directly)
   - TTS needs no key — it uses free Microsoft Edge voices out of the box.

2. From the repo root:
   ```bash
  cp .env.example .env
  # edit .env and set all required secrets
   docker compose up --build
   ```
  This starts MySQL, runs the schema migration, and serves both the frontend
  and `/api` through the web container on `:8080`. The API and database are
  internal services and are not published to the host.

3. Point the mobile app at your server with `EXPO_PUBLIC_API_URL`. Use a LAN
  URL such as `http://192.168.x.x:4000/api/v1` for development, or the HTTPS
  public URL in production:
  ```bash
  export EXPO_PUBLIC_API_URL=https://your-host/api/v1
  ```
   ```bash
   cd mobile && npm install && npx expo start
   ```

## Running without Docker

```bash
# 1. MySQL running locally, then:
cd backend
cp .env.example .env        # edit DATABASE_URL + the rest
npm install
npm run migrate
npm run dev                 # http://localhost:4000

# 2. In another terminal
cd web
npm install
npm run dev                 # http://localhost:5173

# 3. Mobile
cd mobile
npm install
npx expo start
```

## Plugging in your own AI

| Slot | File | What it expects |
|---|---|---|
| Conversational + assessor LLM | `backend/src/core/llmRouter.js` | Any OpenAI-compatible `/chat/completions` endpoint, set via `LLM_BASE_URL` |
| Speech-to-text | `backend/src/core/audio.js` → `transcribe()` | Any OpenAI-compatible `/audio/transcriptions` endpoint, set via `STT_BASE_URL` |
| Text-to-speech | `backend/src/core/audio.js` → `synthesize()` | Already implemented with `msedge-tts` — swap it out here if you want a different voice engine |

Nothing else in the codebase needs to change to switch providers — only the
`.env` values.
# cefr

# CEFR English Practice Partner

A production-ready, self-hosted English language learning and conversational practice platform built around the Common European Framework of Reference for Languages (CEFR A1–C2).

The system integrates a **Node.js/Express API**, a **React 18 web application**, a **React Native (Expo) mobile app**, and an optional **local Verbatim-Whisper STT server**, all sharing a unified MySQL database and a cohesive dark-theme UI with violet/amber accents.

---

## Highlights & Features

- **Conversational Practice Partner**: Real-time turn-based spoken and text conversation tailored to learner CEFR levels (A1 through C2).
- **Verbatim Speech-to-Text (STT)**: Uses Whisper (including fine-tuned local verbatim models) to transcribe speech *without* auto-correcting student grammar or pronunciation mistakes, ensuring errors reach the assessment layer.
- **Zero Perceived Latency Architecture**: Concurrently generates conversational replies and performs 11-category grammar analysis (`Promise.allSettled`), streaming TTS synthesis back to the learner while the assessor finishes.
- **Verbatim Quotation Guardrail**: Discards any flagged error whose quote cannot be matched character-for-character in the student's transcript, preventing hallucinated errors.
- **Guided Discovery vs. Explicit Correction**: Automatically toggles pedagogical strategy based on CEFR level (explicit rule corrections for A1–A2; concept-check prompts and collapsible clues for B1+).
- **Comprehensive Learning Suite**:
  - **Vocabulary Lab**: Spaced-repetition review, category filters, bilingual translations, examples, and favorites.
  - **Grammar Roadmap**: Structured A1–C2 curriculum with interactive exercises, rule breakdowns, and scoring.
  - **Pronunciation Lab**: Phoneme training, text-to-speech audio synthesis via Edge-TTS, and voice recording.
  - **Sentence Builder**: Interactive token unscrambling and syntax assembly exercises.
  - **Adaptive Quizzes**: Topic-specific and multi-skill quizzes with instant feedback and score histories.
  - **Learning Analytics**: Skill progress tracking and personalized AI recommendations.
- **Multi-Tenant Classroom Management**: Teacher and student roles, join codes, assignments, session logs, and cohort-wide error distribution reports.
- **Complete Web & Mobile Parity**: 100% endpoint and feature parity verified by automated test suites between React Web and React Native Mobile.
- **Enterprise Security**: Content Security Policy (CSP), HTTP Parameter Pollution (`hpp`) protection, SQL wildcard sanitization, rate-limiting, and sanitized CORS handling.

---

## System Architecture & Repository Layout

```
cefr-practice-partner/
├── backend/                       # Node.js / Express API
│   ├── src/
│   │   ├── config.js              # Environment configuration & fallbacks
│   │   ├── core/
│   │   │   ├── audio.js           # Audio handling & Edge-TTS synthesis
│   │   │   ├── engine.js          # Core orchestrator: concurrent LLM + verbatim guardrail
│   │   │   ├── llmRouter.js       # Cloud/Local LLM completions router (Groq/Ollama/OpenAI)
│   │   │   └── taxonomy.js        # 11 closed error categories
│   │   ├── db/                    # MySQL connection pool, schema.sql & seed scripts
│   │   ├── middleware/            # JWT authentication & role-based access control
│   │   └── routes/                # Express routes (/auth, /classrooms, /sessions, /learning, /engine)
│   └── test/                      # Parity and content verification test suite
├── web/                           # React 18 / Vite Web Application
│   ├── src/
│   │   ├── api/client.js          # Normalized API client with response validation
│   │   ├── components/            # Layout, navigation, Lucide icons, responsive drawer
│   │   ├── pages/                 # Dashboard, Practice, Vocabulary, Grammar, Pronunciation, Quiz...
│   │   └── theme.css              # Custom responsive stylesheet (mobile bottom-bar <700px)
│   └── vite.config.js             # Dev server with reverse proxy to backend
├── mobile/                        # React Native / Expo Mobile Application
│   ├── src/
│   │   ├── api/client.js          # Cross-platform API client matching web
│   │   └── screens/               # Matching screens for all practice and learning modules
│   └── App.js                     # Navigation container & auth flow
├── scripts/
│   ├── whisper-server.py          # Standalone OpenAI-compatible Verbatim Whisper STT server
│   └── backup.sh                  # Database backup utility
├── whisper-verbatim-merged/       # Local fine-tuned Verbatim Whisper model checkpoint
└── docker-compose.yml             # Single-command deployment (DB + Backend + Web)
```

---

## AI Pipeline & Integration Options

The backend is completely modular and provider-agnostic:

```
                  ┌─────────────────────────────────────────────────────────┐
                  │                 Web & Mobile Clients                    │
                  └────────────────────────────┬────────────────────────────┘
                                               │
                                               ▼
                  ┌─────────────────────────────────────────────────────────┐
                  │              Node.js Express Backend (:4000)            │
                  │             GET /api/v1/engine/status (Probe)           │
                  └──────────────┬───────────────────────────┬──────────────┘
                                 │                           │
          [STT Path]             │                           │  [LLM Path]
                                 ▼                           ▼
        ┌──────────────────────────────────┐       ┌──────────────────────────────────┐
        │  Whisper STT Provider            │       │  LLM Provider (/chat/completions)│
        │  • Local: whisper-server.py      │       │  • Local: Ollama / LM Studio     │
        │    (whisper-verbatim-merged)     │       │  • Cloud: Groq / OpenAI / Gemini │
        │  • Cloud: Groq Whisper API       │       │                                  │
        └──────────────────────────────────┘       └──────────────────────────────────┘
                                 │
                                 ▼
        ┌──────────────────────────────────┐
        │  Text-to-Speech (TTS)            │
        │  • Free Microsoft Edge TTS       │
        │    (msedge-tts, built-in)        │
        └──────────────────────────────────┘
```

1. **Local Verbatim Whisper STT (Recommended)**:
   Run `scripts/whisper-server.py` and set `STT_BASE_URL=http://localhost:7860` in `backend/.env`. Transcribes speech locally using the included `whisper-verbatim-merged` model without auto-correcting student grammar mistakes.
2. **Local or Cloud LLM**:
   Point `LLM_BASE_URL` to any OpenAI-compatible `/chat/completions` endpoint (e.g. local Ollama at `http://localhost:11434/v1`, local LM Studio at `http://localhost:1234/v1`, or Groq at `https://api.groq.com/openai/v1`).
3. **Text-to-Speech (TTS)**:
   Runs out of the box with zero configuration using the free Microsoft Edge neural voices via `msedge-tts` (no external server or API keys required).

---

## Getting Started

### Prerequisites

- **Node.js**: v18 or later (Node 20+ recommended)
- **MySQL**: 8.0+ or compatible MariaDB
- **Python**: 3.10+ (optional, only needed for local Whisper STT sidecar)
- **Docker & Docker Compose**: (optional, for containerized deployment)

---

### Method 1: Docker Compose (Quickest)

1. Copy and configure the root environment file:
   ```bash
   cp .env.example .env
   # Edit .env and set JWT_SECRET, LLM keys, etc.
   ```
2. Build and launch all services:
   ```bash
   docker compose up --build
   ```
3. Access the web app at `http://localhost:8080`.

---

### Method 2: Manual Local Setup

#### 1. Database Setup
Create a MySQL database and user:
```sql
CREATE DATABASE cefr_practice_partner CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'cefr'@'localhost' IDENTIFIED BY 'cefr_local_password';
GRANT ALL PRIVILEGES ON cefr_practice_partner.* TO 'cefr'@'localhost';
FLUSH PRIVILEGES;
```

#### 2. Backend Setup
```bash
cd backend
cp .env.example .env

# Edit backend/.env with your DATABASE_URL, JWT_SECRET, and LLM credentials:
# DATABASE_URL=mysql://cefr:cefr_local_password@localhost:3306/cefr_practice_partner
# JWT_SECRET=your-secure-32-char-random-secret-key
# LLM_BASE_URL=https://api.groq.com/openai/v1  (or http://localhost:11434/v1 for Ollama)
# LLM_API_KEY=your-api-key

npm install
npm run migrate      # Applies database schema
npm run seed:learning # Loads vocabulary, grammar, phonemes, and exercises
npm run dev          # Starts Express API on http://localhost:4000
```

#### 3. Web Frontend Setup
```bash
cd ../web
npm install
npm run dev          # Starts Vite dev server on http://localhost:5173
```
*Note: Vite automatically proxies `/api` requests to `http://localhost:4000`.*

#### 4. Mobile App Setup (React Native / Expo)
```bash
cd ../mobile
npm install

# For local development with a device or emulator:
export EXPO_PUBLIC_API_URL=http://YOUR_LOCAL_IP:4000/api/v1
npx expo start
```

#### 5. Local Verbatim Whisper Server (Optional)
To run the local speech-to-text server:
```bash
python scripts/whisper-server.py \
    --model /home/omaressa/omar/cefr-practice-partner/whisper-verbatim-merged \
    --host 0.0.0.0 --port 7860
```
Then verify `STT_BASE_URL=http://localhost:7860` in `backend/.env`.

---

## Environment Variables Reference (`backend/.env`)

| Variable | Required | Description | Default |
|---|---|---|---|
| `PORT` | No | API port | `4000` |
| `DATABASE_URL` | **Yes** | MySQL connection URL | — |
| `JWT_SECRET` | **Yes** | Secret for signing JWT tokens (min 32 chars in prod) | — |
| `CORS_ORIGIN` | No | Allowed CORS origin(s), comma-separated | `*` or `http://localhost:5173` |
| `LLM_BASE_URL` | **Yes** | OpenAI-compatible chat endpoint (Ollama, Groq, etc.) | `http://localhost:11434/v1` |
| `LLM_API_KEY` | No | API key for LLM completions (if required by provider) | — |
| `LLM_FAST_MODEL` | No | Fast conversational partner model name | `gpt-oss-20b` or `llama3` |
| `LLM_HEAVY_MODEL` | No | Heavy grammar assessor model name | `gpt-oss-120b` or `llama3` |
| `LLM_FALLBACK_BASE_URL` | No | Fallback LLM endpoint (e.g., Google Gemini) | — |
| `LLM_FALLBACK_API_KEY` | No | Fallback LLM API key | — |
| `LLM_FALLBACK_MODEL` | No | Fallback model name | `gemini-flash-latest` |
| `STT_BASE_URL` | No | OpenAI-compatible transcription endpoint | `http://localhost:7860` |
| `STT_API_KEY` | No | STT provider key (if required) | — |
| `STT_MODEL` | No | Model name passed to the STT server | `whisper-verbatim-merged` |
| `TTS_VOICE` | No | Microsoft Edge voice identifier | `en-US-AriaNeural` |

---

## Verification & Testing

Run the automated backend test suite to verify platform parity and content integrity:
```bash
cd backend
npm test
```

This runs:
- **Client Parity Test**: Asserts identical API routes and quiz skill sets between `web/src/api/client.js` and `mobile/src/api/client.js`.
- **Content Test**: Validates CEFR level progression, Arabic translations, and exercise schemas.

---

## Error Taxonomy

The assessor classifies grammar issues strictly into 11 closed categories defined in `backend/src/core/taxonomy.js`:

1. `verb_tense` — Incorrect tense selection
2. `subject_verb_agreement` — Number mismatch between subject and verb
3. `preposition` — Omitted, extra, or substituted prepositions
4. `article` — Definite/indefinite article misuse
5. `word_order` — Syntactic ordering errors
6. `pluralization` — Singular/plural noun inflections
7. `collocation` — Unnatural phrasing or word combinations
8. `pronoun` — Case, gender, or referent mismatch
9. `modal_verb` — Auxiliary and modal verb errors
10. `condition` — If-clause and conditional structure errors
11. `other` — Miscellaneous syntax or morphological errors

---

## License

MIT License. See `LICENSE` for details.

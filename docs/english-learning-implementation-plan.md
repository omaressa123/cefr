# English Learning System Implementation Plan

## Current Architecture

- **Web:** React 18, Vite, and React Router 6. Routes are centralized in `web/src/App.jsx`; authenticated pages use the shared shell in `web/src/components/Layout.jsx`; global styles live in `web/src/theme.css`.
- **Mobile:** Expo 57 / React Native with a native stack rooted at `mobile/App.js`.
- **Backend:** Node.js ES modules with Express 4. The API is mounted at `/api/v1` from `backend/src/routes/index.js`.
- **Database:** MySQL through `mysql2/promise`. The schema is currently maintained in `backend/src/db/schema.sql`; `backend/src/db/migrate.js` applies additive SQL and tolerates existing tables/indexes.
- **Authentication:** JWT bearer tokens, with user identity and role stored in `profiles`. The existing `requireAuth` middleware is the authorization boundary for personalized resources.
- **Existing learning functionality:** CEFR levels are already used by assignments and conversational practice sessions. Audio already supports speech-to-text and text-to-speech, but there is no pronunciation scoring and no structured learning-content subsystem.
- **Testing:** No project test runner or test files currently exist. The first implementation phase will add a lightweight backend test harness and focused API tests without changing runtime dependencies unnecessarily.

## Proposed Architecture

Add a modular learning-content layer beside the existing classroom and practice routes:

1. A normalized MySQL content schema for CEFR levels, vocabulary, grammar, pronunciation, sentence exercises, quizzes, progress, and recommendations.
2. Version-controlled seed data under `backend/src/content/`, imported by an idempotent seed script.
3. Authenticated Express routes under `/api/v1/cefr`, `/vocabulary`, `/grammar`, `/pronunciation`, `/sentence-structure`, `/quiz`, `/progress`, and `/recommendations`.
4. Shared progress aggregation in a backend service so dashboard, roadmap, and recommendations use the same source of truth.
5. A web learning area integrated into the existing router and sidebar. Existing classroom and conversational-practice routes remain unchanged.
6. Pronunciation listening/repetition support using the existing TTS provider. Speech analysis will be represented as an explicit unavailable capability until a real scoring provider is configured; no synthetic scores will be returned.

## Database Changes

Add tables, foreign keys, indexes, timestamps, and uniqueness constraints for:

- `cefr_levels`
- `vocabulary_categories`
- `vocabulary`
- `vocabulary_progress`
- `vocabulary_favorites`
- `grammar_topics`
- `grammar_lessons`
- `grammar_progress`
- `pronunciation_lessons`
- `pronunciation_exercises`
- `pronunciation_progress`
- `sentence_structure_topics`
- `sentence_exercises`
- `sentence_progress`
- `quiz_questions`
- `quiz_attempts`
- `user_skill_progress`
- `learning_recommendations`

All user-owned records reference `profiles(id)` and are scoped by the authenticated user. Content records are independent of users and can be expanded through seed/import files.

## API Changes

Implement paginated content reads with optional level/category/search filters. Add authenticated mutations for learning, favorites, review, lesson completion, quiz attempts, and progress retrieval. Route handlers will validate CEFR levels, IDs, pagination, and answer payloads before querying MySQL.

The initial API surface will include:

- `GET /cefr/levels`
- `GET /vocabulary`, `GET /vocabulary/:id`, `POST /vocabulary/:id/learn`, `POST /vocabulary/:id/favorite`, `POST /vocabulary/:id/review`
- `GET /grammar`, `GET /grammar/:id`, `POST /grammar/:id/complete`
- `GET /pronunciation`, `GET /pronunciation/:id`
- `GET /sentence-structure`, `GET /sentence-structure/:id`
- `POST /quiz/start`, `POST /quiz/answer`, `POST /quiz/finish`
- `GET /progress`, `GET /recommendations`

Existing `/auth`, `/classrooms`, `/assignments`, `/sessions`, and classroom-report endpoints are preserved.

## Frontend Changes

Add a learning dashboard and focused pages for roadmap, vocabulary, grammar, pronunciation, sentence building, quizzes, progress, favorites, review, and recommendations. The new pages will use the existing authenticated route pattern, API client, global tokens, and shared layout. Content is fetched from the backend; no large vocabulary or lesson dataset is embedded in React components.

The first web release will prioritize the complete student workflow. Mobile navigation and screens can consume the same APIs in a follow-up phase after the web vertical slice is stable.

## Migration Strategy

1. Extend `schema.sql` with additive tables and indexes.
2. Add seed/import scripts that can be rerun safely using content keys and unique constraints.
3. Run the migration against a disposable MySQL instance before touching existing application flows.
4. Add backend routes and API tests using a test database or mocked pool boundary.
5. Add web routes and screens incrementally, retaining existing dashboard/classroom/practice behavior.
6. Verify existing auth, classroom, assignment, and conversational-practice endpoints after migration.

## Implementation Phases

1. **Foundation:** schema, CEFR seed content, validation helpers, and content services.
2. **Core APIs:** vocabulary, grammar, pronunciation, sentence structure, progress, and recommendations.
3. **Quiz engine:** reusable question retrieval and attempt persistence for the four skills.
4. **Web learning area:** dashboard, roadmap, vocabulary, grammar, pronunciation, sentence builder, quiz, and progress views.
5. **Quality:** API tests, build checks, migration verification, authorization/user-isolation checks, and documentation.
6. **Expansion:** mobile screens, larger content imports, provider-backed pronunciation analysis, and teacher-facing analytics.

## Risks and Controls

- **Schema drift:** keep all new tables in the existing schema file and use idempotent seed keys.
- **User data leakage:** require JWT auth on all personalized endpoints and filter every query by `req.user.sub`.
- **Content scale:** paginate list endpoints and index level/category/search fields.
- **Fake pronunciation scoring:** expose listening/repetition only until a real analysis provider is configured; label unavailable analysis explicitly.
- **Existing regressions:** preserve route registration and run existing endpoint smoke checks after migration.
- **Incomplete content coverage:** ship a useful foundational dataset and make import structure extensible rather than claiming exhaustive CEFR certification.

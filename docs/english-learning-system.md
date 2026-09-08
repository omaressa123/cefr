# CEFR English Learning System

The learning system extends CEFR Practice Partner with structured content and personalized practice while preserving classroom and conversational practice. It uses the existing Express API, MySQL database, JWT authentication, React/Vite web client, and current dark theme.

## Architecture

Learning content is stored in MySQL and imported from version-controlled JavaScript data under `backend/src/content/seedData.js`. The idempotent importer is `backend/src/db/seed-learning.js` and uses deterministic UUIDs so content can be re-seeded without duplicating rows.

Personalized records always reference `profiles.id`. The learning router applies `requireAuth` and scopes reads and writes using `req.user.sub`. Content reads are paginated where lists can grow; user progress is joined into content responses so the client does not need a second request for every item.

## CEFR Structure

`cefr_levels` contains A1, A2, B1, B2, C1, and C2 with display metadata and ordering. Vocabulary, grammar, pronunciation, sentence topics, and quiz questions each carry one of those levels. The current seed is a foundational dataset, not a claim that every item is officially CEFR-certified.

## Database

The schema additions in `backend/src/db/schema.sql` cover:

- `cefr_levels`, `vocabulary_categories`, and `vocabulary`
- `vocabulary_progress` and `vocabulary_favorites`
- `grammar_topics` and `grammar_progress`
- `pronunciation_lessons`, `pronunciation_exercises`, and `pronunciation_progress`
- `sentence_structure_topics`, `sentence_exercises`, and `sentence_progress`
- `quiz_questions` and `quiz_attempts`
- `user_skill_progress` and `learning_recommendations`

JSON columns hold content-shaped lists such as synonyms, examples, and minimal pairs. User-specific tables have uniqueness constraints to make repeated favorites and progress writes idempotent.

## API

All endpoints are under `/api/v1`:

| Endpoint | Purpose |
| --- | --- |
| `GET /cefr/levels` | Ordered CEFR level metadata |
| `GET /vocabulary` | Paginated level/category/search/favorites/review listing |
| `GET /vocabulary/:id` | Vocabulary details and the current user's progress |
| `POST /vocabulary/:id/learn` | Mark a word learned |
| `POST /vocabulary/:id/favorite` | Add or remove a favorite with `{ "favorite": boolean }` |
| `POST /vocabulary/:id/review` | Record a correct/incorrect review and next review date |
| `GET /grammar`, `GET /grammar/:id` | Grammar roadmap and lesson details |
| `POST /grammar/:id/complete` | Record lesson completion and score |
| `GET /pronunciation`, `GET /pronunciation/:id` | Pronunciation lessons and exercises |
| `POST /pronunciation/:id/audio` | Generate real TTS audio for a lesson target |
| `POST /pronunciation/:id/complete` | Record pronunciation lesson completion |
| `GET /sentence-structure`, `GET /sentence-structure/:id` | Sentence topics and exercises |
| `POST /sentence-structure/:id/answer` | Check and persist an exercise answer |
| `POST /quiz/start` | Select a quiz by skill and CEFR level |
| `POST /quiz/answer` | Persist an answer and return correctness/explanation |
| `POST /quiz/finish` | Aggregate attempts for a quiz |
| `GET /progress` | Unified skill progress and overall percentage |
| `GET /recommendations` | Weakness-driven next steps |

## Vocabulary and Review

Vocabulary details include definitions, Arabic translations, examples, pronunciation text, synonyms, antonyms, word family, related words, and common mistakes. Review writes use a small spaced-review rule: correct reviews schedule the next review three days later; incorrect reviews schedule it the next day and mark the word difficult.

## Pronunciation

The pronunciation lab uses the existing Microsoft Edge TTS integration for listen/repeat activities. The API returns `analysisAvailable: false` because speech scoring is not configured. No fake accuracy, stress, fluency, or clarity scores are presented. A future provider can be added behind the pronunciation route without changing the client contract.

## Sentence Builder and Quiz Engine

Sentence exercises support word ordering, transformations, completion, and correction. The quiz engine supports the stored question types and records user answer, correct answer, result, skill, level, category, and timestamp. This gives recommendations real performance data instead of hardcoded weakness labels.

## Web Screens

The web client adds `/learning`, `/learning/vocabulary`, `/learning/grammar`, `/learning/pronunciation`, `/learning/sentences`, `/learning/quiz`, and `/learning/progress`, plus detail routes for vocabulary, grammar, and pronunciation. They reuse `Layout`, the existing API client, route protection, and theme tokens.

## Environment Variables

No new required environment variables are introduced. Existing `DATABASE_URL`, `JWT_SECRET`, and `TTS_VOICE` are used. Future speech analysis should add provider-specific variables to `backend/src/config.js` and keep them out of source control.

## Future Improvements

- Add versioned migrations instead of the current single additive schema file.
- Add a larger licensed/importable content corpus with provenance metadata.
- Add grammar lesson/exercise normalization when content volume warrants it.
- Add real speech analysis behind a configurable provider.
- Add mobile learning navigation and teacher-facing learning analytics.
# Schema Design — CEFR Practice Partner (Updated System)

Database: **MySQL 8** · Host `localhost` · Port **3306** · Database `cefr_practice_partner`

Connection string (see `backend/.env`):

```text
DATABASE_URL=mysql://cefr:***@localhost:3306/cefr_practice_partner
```

Source of truth: `backend/src/db/schema.sql` (applied with `npm run migrate`),
seeded with `npm run seed:learning`. All statements are `IF NOT EXISTS`, so
migrations are safe to re-run.

---

## 1. Global conventions

| Convention | Detail |
|---|---|
| Primary keys | `CHAR(36)` UUIDs everywhere (`uuid()` in Node, deterministic `uuidv5` in seeds) |
| CEFR levels | `ENUM('A1','A2','B1','B2','C1','C2')` on every curriculum table |
| Timestamps | `created_at` defaults to `CURRENT_TIMESTAMP`; progress tables also carry `updated_at … ON UPDATE CURRENT_TIMESTAMP` |
| User isolation | Every progress/favorite row carries `user_id → profiles(id)` with `ON DELETE CASCADE`, plus a `UNIQUE(user_id, unit_id)` key so **each unit is counted exactly once** |
| JSON columns | Lists (synonyms, examples, options…) stored as `JSON`, parsed by `parseJson()` in `backend/src/routes/learning.js` |
| Money/percents | Scores and percents are computed in SQL/JS, never stored as facts (except cached `score` on grammar completion) |

---

## 2. Identity & classrooms

### `profiles`
`id` PK · `username` UNIQUE · `password_hash` · `role ENUM('teacher','student')` · `display_name` · `created_at`.
Root of the whole graph — deleting a profile cascades all of that user's progress, favorites, sessions and classrooms artifacts.

### `classrooms`
`id` PK · `teacher_id → profiles` · `name` · `join_code` UNIQUE · `created_at`.

### `enrollments`
`id` PK · `classroom_id → classrooms CASCADE` · `student_id → profiles CASCADE` · `UNIQUE(classroom_id, student_id)` · `created_at`.

### `assignments`
`id` PK · `classroom_id → classrooms CASCADE` · `title`, `instructions`, `cefr_level`, `due_at` · `created_at`.

---

## 3. Practice sessions (speaking)

### `practice_sessions`
`id` PK · `student_id → profiles CASCADE` · `assignment_id → assignments SET NULL` (keeps history if the assignment is removed) · `cefr_level` · `session_type` · `status` · `created_at`.

### `exchanges`
`id` PK · `session_id → practice_sessions CASCADE` · ordered student/AI turns with transcript, audio URLs, grammar feedback JSON, scores · `created_at`.

---

## 4. Curriculum reference

### `cefr_levels`
`code` PK (A1–C2) · `title` · `description` · `sort_order` UNIQUE. Titles feed the roadmap UI.

### `vocabulary_categories`
`id` PK · `slug` UNIQUE · `name`.

### `vocabulary`
`id` PK · `cefr_level` · `category_id → vocabulary_categories RESTRICT` (a category in use cannot be deleted) · `word`, `part_of_speech`, `definition`, `arabic_translation`, `example_sentence`, `pronunciation`, `audio_text` · JSON: `synonyms`, `antonyms`, `word_family`, `related_words` · `usefulness` · `UNIQUE(cefr_level, word)`.
Indexes: `(cefr_level, category_id)`, `(word)`.

### `grammar_topics`
`id` PK · `cefr_level` · `slug` UNIQUE · `title`, `category`, `difficulty` · `explanation`, `arabic_explanation` · JSON: `examples`, `common_mistakes`, `prerequisites`, `related_topics`. Index on `cefr_level`.

### `pronunciation_lessons` / `pronunciation_exercises`
Lesson: `id` PK · `cefr_level` · `slug` · `title`, `sound`, `mouth_position`, `tongue_position`, `voiced` · `explanation` · JSON: `example_words`, `minimal_pairs`, `common_mistakes`.
Exercises: `id` PK · `lesson_id → lessons CASCADE` · `prompt`, `target_text`, `phonetic_text`, `exercise_type`, `sort_order`.

### `sentence_structure_topics` / `sentence_exercises`
Topic: `id` PK · `cefr_level` · `slug` UNIQUE · `title`, `explanation`, `arabic_explanation` · JSON `examples`.
Exercises: `id` PK · `topic_id → topics CASCADE` · `exercise_type` (word_order, fill_blank, correction, transformation, completion, multiple_choice) · `prompt`, JSON `options`, `correct_answer`, `explanation`, `sort_order`.

### `quiz_questions`
`id` PK · `skill` (vocabulary, grammar, pronunciation, sentence_structure) · `cefr_level` · `category` · `question_type` · `prompt`, JSON `options`, `correct_answer`, `explanation` · `content_id` NULL (optional link back to source material). Index `(skill, cefr_level)`.

---

## 5. Per-user progress (the learning record)

A unit counts as **completed only on an explicit recorded action** — opening a lesson never completes anything:

| Table | Completion condition |
|---|---|
| `vocabulary_progress` | `status = 'learned'` via Mark-learned or a correct review. Also stores `review_count`, `correct/incorrect_answers`, `last/next_review_at` (spaced repetition) |
| `grammar_progress` | `status = 'completed'` via Mark-complete, with `score` + `completed_at` |
| `pronunciation_progress` | `completed = TRUE` via Mark-complete (`practice_count` increments each time) |
| `sentence_progress` | `completed = TRUE` set automatically once `correct_answers` covers **every** exercise of the topic |
| `quiz_attempts` | One row per answered question (`is_correct`, `score`, `skill`, `category`, `cefr_level`) — evidence for recommendations, not a completion |

All four progress tables share: `id` PK · `user_id → profiles CASCADE` · `UNIQUE(user_id, unit_id)` · `updated_at` auto-refresh (used by the activity feed ordering).

### `user_skill_progress`
Reserved cache table `(user_id, skill, cefr_level)` with counters + `progress_percent`. **Currently unused** — progress is always computed live from the tables above so the UI can never show a stale or invented number. Fill it only if a caching layer is ever needed.

### `learning_recommendations`
Stored recommendations (`skill`, `title`, `reason`, `content_path`, `priority`, `completed`). The live `/recommendations` endpoint currently derives suggestions from `quiz_attempts`; this table is available for persisted/curated recommendations.

---

## 6. Phrases bank (dynamic, added in this update)

Replaces the former hardcoded frontend list. Fully MySQL-backed on port 3306.

### `phrases`
`id` PK · `phrase VARCHAR(255)` · `meaning TEXT` · `category VARCHAR(100)` (default `'Daily'`, free-form so new categories emerge from data) · `cefr_level` (default `'A2'`) · `created_by → profiles ON DELETE SET NULL` (`NULL` = seeded curriculum phrase, never deletable; set = user-created, deletable by its owner) · `created_at`.

### `phrase_favorites`
`id` PK · `user_id → profiles CASCADE` · `phrase_id → phrases CASCADE` · `UNIQUE(user_id, phrase_id)` · `created_at`. Favorites therefore persist across refresh, logout and devices.

---

## 7. How the API reads this schema

| Endpoint | Query pattern |
|---|---|
| `GET /progress` | 4× `COUNT(total)` + conditional `COUNT(completed)` per skill (equal-weight mean = overall), plus 4× `GROUP BY cefr_level` merged by `backend/src/core/progress.js` into per-level totals → derived `currentLevel`, `nextLevel {remaining}`, roadmap statuses. `LEVEL_COMPLETE_PERCENT = 100`: a level is complete only when **all** its units are |
| `GET /activity` | `UNION ALL` of the four progress tables (joined to titles/words) + `quiz_attempts`, ordered by timestamp DESC, `LIMIT 25`. Empty array for new users — activity is never invented |
| `GET /phrases` | `phrases LEFT JOIN phrase_favorites` (favorite flag inline) with optional `category / level / LIKE search / favorites-only` filters, auth-scoped |
| `GET /phrases/categories` | `GROUP BY category` counts for the tab bar |

Every progress/activity/phrase query filters by the **authenticated** `user_id`, so users can never see each other's data.

---

## 8. Seed data (current curriculum volume)

`backend/src/content/seedData.js` → `npm run seed:learning` (idempotent `ON DUPLICATE KEY UPDATE`, deterministic UUIDs):

| Content | Rows | Per-level spread |
|---|---|---|
| Vocabulary | 12 | across A1–C2 |
| Grammar topics | 12 | across A1–C2 |
| Pronunciation lessons (+exercises) | 5 | across A1–C2 |
| Sentence topics (+exercises) | 6 | across A1–C2 |
| Phrases bank | 15 | Social 2, Business 4, Daily 3, Academic 2, Idioms 4 |
| Quiz questions | 4 | sampled per skill/level |

Total eligible learning units for progress math: **35** (12 + 12 + 5 + 6). Quiz attempts are evidence only and excluded from completion percentage.

---

## 9. Entity-relationship summary

```text
profiles ──┬── enrollments ──── classrooms ──── assignments
           │                        │                │
           │                        │                └── practice_sessions ──── exchanges
           │                        │
           ├── vocabulary_progress ──── vocabulary ──── vocabulary_categories
           ├── vocabulary_favorites ───┘
           ├── grammar_progress ──── grammar_topics
           ├── pronunciation_progress ──── pronunciation_lessons ──── pronunciation_exercises
           ├── sentence_progress ──── sentence_structure_topics ──── sentence_exercises
           ├── quiz_attempts ──── quiz_questions
           ├── phrase_favorites ──── phrases (created_by ── profiles, SET NULL)
           ├── user_skill_progress (reserved, unused)
           └── learning_recommendations (reserved)

cefr_levels stands alone as the reference table for level codes/titles.
All ──── edges from user data point toward profiles with ON DELETE CASCADE,
so removing a user removes exactly that user's data and nothing else.
```

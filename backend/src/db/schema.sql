-- =========================================================
-- CEFR Practice Partner - MySQL Database Schema
-- =========================================================

USE cefr_practice_partner;


-- =========================================================
-- PROFILES
-- =========================================================

CREATE TABLE IF NOT EXISTS profiles (
    id CHAR(36) NOT NULL PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role ENUM('teacher', 'student') NOT NULL DEFAULT 'student',
    display_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- =========================================================
-- CLASSROOMS
-- =========================================================

CREATE TABLE IF NOT EXISTS classrooms (
    id CHAR(36) NOT NULL PRIMARY KEY,
    teacher_id CHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    join_code VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_classrooms_teacher
        FOREIGN KEY (teacher_id)
        REFERENCES profiles(id)
        ON DELETE CASCADE
);


-- =========================================================
-- ENROLLMENTS
-- =========================================================

CREATE TABLE IF NOT EXISTS enrollments (
    id CHAR(36) NOT NULL PRIMARY KEY,
    student_id CHAR(36) NOT NULL,
    classroom_id CHAR(36) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_enrollments_student_classroom
        UNIQUE (student_id, classroom_id),

    CONSTRAINT fk_enrollments_student
        FOREIGN KEY (student_id)
        REFERENCES profiles(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_enrollments_classroom
        FOREIGN KEY (classroom_id)
        REFERENCES classrooms(id)
        ON DELETE CASCADE
);


-- =========================================================
-- ASSIGNMENTS
-- =========================================================

CREATE TABLE IF NOT EXISTS assignments (
    id CHAR(36) NOT NULL PRIMARY KEY,
    classroom_id CHAR(36) NOT NULL,

    cefr_level ENUM(
        'A1',
        'A2',
        'B1',
        'B2',
        'C1',
        'C2'
    ) NOT NULL,

    target_topic TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_assignments_classroom
        FOREIGN KEY (classroom_id)
        REFERENCES classrooms(id)
        ON DELETE CASCADE
);


-- =========================================================
-- PRACTICE SESSIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS practice_sessions (
    id CHAR(36) NOT NULL PRIMARY KEY,
    student_id CHAR(36) NOT NULL,
    assignment_id CHAR(36) NULL,

    cefr_level ENUM(
        'A1',
        'A2',
        'B1',
        'B2',
        'C1',
        'C2'
    ) NOT NULL,

    target_hit_count INT NOT NULL DEFAULT 0,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP NULL,

    CONSTRAINT fk_practice_sessions_student
        FOREIGN KEY (student_id)
        REFERENCES profiles(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_practice_sessions_assignment
        FOREIGN KEY (assignment_id)
        REFERENCES assignments(id)
        ON DELETE SET NULL
);


-- =========================================================
-- EXCHANGES
-- =========================================================

CREATE TABLE IF NOT EXISTS exchanges (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,

    session_id CHAR(36) NOT NULL,

    turn_index INT NOT NULL,

    student_text TEXT NOT NULL,

    ai_reply TEXT NOT NULL,

    errors JSON NOT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_exchanges_session
        FOREIGN KEY (session_id)
        REFERENCES practice_sessions(id)
        ON DELETE CASCADE
);


-- =========================================================
-- INDEXES
-- =========================================================

CREATE INDEX idx_enrollments_student
    ON enrollments(student_id);

CREATE INDEX idx_enrollments_classroom
    ON enrollments(classroom_id);

CREATE INDEX idx_assignments_classroom
    ON assignments(classroom_id);

CREATE INDEX idx_sessions_student
    ON practice_sessions(student_id);

CREATE INDEX idx_exchanges_session
    ON exchanges(session_id);


-- =========================================================
-- STRUCTURED ENGLISH LEARNING CONTENT
-- =========================================================

CREATE TABLE IF NOT EXISTS cefr_levels (
    code ENUM('A1', 'A2', 'B1', 'B2', 'C1', 'C2') NOT NULL PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    sort_order TINYINT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS vocabulary_categories (
    id CHAR(36) NOT NULL PRIMARY KEY,
    slug VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vocabulary (
    id CHAR(36) NOT NULL PRIMARY KEY,
    cefr_level ENUM('A1', 'A2', 'B1', 'B2', 'C1', 'C2') NOT NULL,
    category_id CHAR(36) NOT NULL,
    word VARCHAR(255) NOT NULL,
    part_of_speech VARCHAR(80) NOT NULL,
    definition TEXT NOT NULL,
    arabic_translation VARCHAR(255) NOT NULL,
    example_sentence TEXT NOT NULL,
    pronunciation VARCHAR(255) NULL,
    audio_text TEXT NULL,
    synonyms JSON NOT NULL,
    antonyms JSON NOT NULL,
    word_family JSON NOT NULL,
    common_mistakes TEXT NULL,
    related_words JSON NOT NULL,
    usefulness TINYINT NOT NULL DEFAULT 3,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_vocabulary_level_word (cefr_level, word),
    CONSTRAINT fk_vocabulary_category FOREIGN KEY (category_id) REFERENCES vocabulary_categories(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS vocabulary_progress (
    id CHAR(36) NOT NULL PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    vocabulary_id CHAR(36) NOT NULL,
    status ENUM('learning', 'learned', 'difficult') NOT NULL DEFAULT 'learning',
    review_count INT NOT NULL DEFAULT 0,
    correct_answers INT NOT NULL DEFAULT 0,
    incorrect_answers INT NOT NULL DEFAULT 0,
    last_reviewed_at TIMESTAMP NULL,
    next_review_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_vocabulary_progress_user_word (user_id, vocabulary_id),
    CONSTRAINT fk_vocabulary_progress_user FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_vocabulary_progress_word FOREIGN KEY (vocabulary_id) REFERENCES vocabulary(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vocabulary_favorites (
    id CHAR(36) NOT NULL PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    vocabulary_id CHAR(36) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_vocabulary_favorite (user_id, vocabulary_id),
    CONSTRAINT fk_vocabulary_favorite_user FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_vocabulary_favorite_word FOREIGN KEY (vocabulary_id) REFERENCES vocabulary(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS grammar_topics (
    id CHAR(36) NOT NULL PRIMARY KEY,
    cefr_level ENUM('A1', 'A2', 'B1', 'B2', 'C1', 'C2') NOT NULL,
    slug VARCHAR(150) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    difficulty TINYINT NOT NULL DEFAULT 1,
    explanation TEXT NOT NULL,
    arabic_explanation TEXT NOT NULL,
    examples JSON NOT NULL,
    common_mistakes JSON NOT NULL,
    prerequisites JSON NOT NULL,
    related_topics JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS grammar_progress (
    id CHAR(36) NOT NULL PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    grammar_topic_id CHAR(36) NOT NULL,
    status ENUM('started', 'completed', 'needs_review') NOT NULL DEFAULT 'started',
    score DECIMAL(5, 2) NULL,
    completed_at TIMESTAMP NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_grammar_progress (user_id, grammar_topic_id),
    CONSTRAINT fk_grammar_progress_user FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_grammar_progress_topic FOREIGN KEY (grammar_topic_id) REFERENCES grammar_topics(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pronunciation_lessons (
    id CHAR(36) NOT NULL PRIMARY KEY,
    cefr_level ENUM('A1', 'A2', 'B1', 'B2', 'C1', 'C2') NOT NULL,
    slug VARCHAR(150) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    sound VARCHAR(100) NOT NULL,
    mouth_position TEXT NOT NULL,
    tongue_position TEXT NOT NULL,
    voiced BOOLEAN NOT NULL DEFAULT FALSE,
    explanation TEXT NOT NULL,
    example_words JSON NOT NULL,
    minimal_pairs JSON NOT NULL,
    common_mistakes JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pronunciation_exercises (
    id CHAR(36) NOT NULL PRIMARY KEY,
    lesson_id CHAR(36) NOT NULL,
    prompt TEXT NOT NULL,
    target_text TEXT NOT NULL,
    phonetic_text VARCHAR(255) NULL,
    exercise_type ENUM('listen', 'repeat', 'minimal_pair') NOT NULL DEFAULT 'repeat',
    sort_order INT NOT NULL DEFAULT 0,
    CONSTRAINT fk_pronunciation_exercise_lesson FOREIGN KEY (lesson_id) REFERENCES pronunciation_lessons(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pronunciation_progress (
    id CHAR(36) NOT NULL PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    lesson_id CHAR(36) NOT NULL,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    practice_count INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_pronunciation_progress (user_id, lesson_id),
    CONSTRAINT fk_pronunciation_progress_user FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_pronunciation_progress_lesson FOREIGN KEY (lesson_id) REFERENCES pronunciation_lessons(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sentence_structure_topics (
    id CHAR(36) NOT NULL PRIMARY KEY,
    cefr_level ENUM('A1', 'A2', 'B1', 'B2', 'C1', 'C2') NOT NULL,
    slug VARCHAR(150) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    explanation TEXT NOT NULL,
    arabic_explanation TEXT NOT NULL,
    examples JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sentence_exercises (
    id CHAR(36) NOT NULL PRIMARY KEY,
    topic_id CHAR(36) NOT NULL,
    exercise_type ENUM('word_order', 'fill_blank', 'correction', 'transformation', 'completion', 'multiple_choice') NOT NULL,
    prompt TEXT NOT NULL,
    options JSON NOT NULL,
    correct_answer TEXT NOT NULL,
    explanation TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    CONSTRAINT fk_sentence_exercise_topic FOREIGN KEY (topic_id) REFERENCES sentence_structure_topics(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sentence_progress (
    id CHAR(36) NOT NULL PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    topic_id CHAR(36) NOT NULL,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    correct_answers INT NOT NULL DEFAULT 0,
    incorrect_answers INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_sentence_progress (user_id, topic_id),
    CONSTRAINT fk_sentence_progress_user FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_sentence_progress_topic FOREIGN KEY (topic_id) REFERENCES sentence_structure_topics(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quiz_questions (
    id CHAR(36) NOT NULL PRIMARY KEY,
    skill ENUM('vocabulary', 'grammar', 'pronunciation', 'sentence_structure') NOT NULL,
    cefr_level ENUM('A1', 'A2', 'B1', 'B2', 'C1', 'C2') NOT NULL,
    category VARCHAR(150) NOT NULL,
    question_type ENUM('multiple_choice', 'fill_blank', 'true_false', 'matching', 'word_order', 'translation', 'meaning', 'grammar_selection', 'sentence_correction') NOT NULL,
    prompt TEXT NOT NULL,
    options JSON NOT NULL,
    correct_answer TEXT NOT NULL,
    explanation TEXT NOT NULL,
    content_id CHAR(36) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
    id CHAR(36) NOT NULL PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    question_id CHAR(36) NOT NULL,
    user_answer TEXT NOT NULL,
    correct_answer TEXT NOT NULL,
    is_correct BOOLEAN NOT NULL,
    score DECIMAL(5, 2) NOT NULL DEFAULT 0,
    cefr_level ENUM('A1', 'A2', 'B1', 'B2', 'C1', 'C2') NOT NULL,
    skill ENUM('vocabulary', 'grammar', 'pronunciation', 'sentence_structure') NOT NULL,
    category VARCHAR(150) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_quiz_attempt_user FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_quiz_attempt_question FOREIGN KEY (question_id) REFERENCES quiz_questions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_skill_progress (
    id CHAR(36) NOT NULL PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    skill ENUM('vocabulary', 'grammar', 'pronunciation', 'sentence_structure', 'speaking') NOT NULL,
    cefr_level ENUM('A1', 'A2', 'B1', 'B2', 'C1', 'C2') NOT NULL,
    completed_count INT NOT NULL DEFAULT 0,
    correct_count INT NOT NULL DEFAULT 0,
    attempt_count INT NOT NULL DEFAULT 0,
    progress_percent DECIMAL(5, 2) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_user_skill_level (user_id, skill, cefr_level),
    CONSTRAINT fk_user_skill_progress_user FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS learning_recommendations (
    id CHAR(36) NOT NULL PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    skill ENUM('vocabulary', 'grammar', 'pronunciation', 'sentence_structure', 'speaking') NOT NULL,
    title VARCHAR(255) NOT NULL,
    reason TEXT NOT NULL,
    content_path VARCHAR(255) NOT NULL,
    priority TINYINT NOT NULL DEFAULT 3,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_learning_recommendation_user FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_vocabulary_level_category ON vocabulary(cefr_level, category_id);
CREATE INDEX idx_vocabulary_word ON vocabulary(word);
CREATE INDEX idx_grammar_level ON grammar_topics(cefr_level);
CREATE INDEX idx_pronunciation_level ON pronunciation_lessons(cefr_level);
CREATE INDEX idx_sentence_level ON sentence_structure_topics(cefr_level);
CREATE INDEX idx_quiz_skill_level ON quiz_questions(skill, cefr_level);
CREATE INDEX idx_quiz_attempt_user_created ON quiz_attempts(user_id, created_at);
CREATE INDEX idx_recommendations_user_priority ON learning_recommendations(user_id, completed, priority);
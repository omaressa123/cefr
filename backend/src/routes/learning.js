import { Router } from "express";
import { v4 as uuid } from "uuid";
import { pool } from "../db/pool.js";
import { synthesize } from "../core/audio.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
const levels = ["A1", "A2", "B1", "B2", "C1", "C2"];
const skills = ["vocabulary", "grammar", "pronunciation", "sentence_structure", "speaking"];

function parseJson(value, fallback = []) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function parsePage(query) {
  const page = Math.max(Number.parseInt(query.page || "1", 10) || 1, 1);
  const pageSize = Math.min(Math.max(Number.parseInt(query.pageSize || "20", 10) || 20, 1), 100);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function validateLevel(level) {
  return !level || levels.includes(level);
}

function mapVocabulary(row) {
  return {
    ...row,
    synonyms: parseJson(row.synonyms), antonyms: parseJson(row.antonyms), word_family: parseJson(row.word_family), related_words: parseJson(row.related_words),
    category: row.category_name ? { slug: row.category_slug, name: row.category_name } : null,
  };
}

function mapTopic(row) {
  return { ...row, examples: parseJson(row.examples), common_mistakes: parseJson(row.common_mistakes), prerequisites: parseJson(row.prerequisites), related_topics: parseJson(row.related_topics) };
}

router.get("/cefr/levels", async (req, res, next) => {
  try {
    const [rows] = await pool.query(`SELECT code, title, description, sort_order FROM cefr_levels ORDER BY sort_order`);
    res.json(rows);
  } catch (error) { next(error); }
});

router.get("/vocabulary", requireAuth, async (req, res, next) => {
  try {
    const { level, category, favorites, review } = req.query;
    if (!validateLevel(level)) return res.status(400).json({ error: "Invalid CEFR level" });
    const { page, pageSize, offset } = parsePage(req.query);
    const filters = [];
    const params = [req.user.sub];
    if (level) { filters.push("v.cefr_level = ?"); params.push(level); }
    if (category) { filters.push("vc.slug = ?"); params.push(category); }
    const search = (req.query.search || "").trim().replace(/[%_]/g, "\\$&");
    if (search) { filters.push("(v.word LIKE ? OR v.definition LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }
    if (favorites === "true") filters.push("vf.id IS NOT NULL");
    if (review === "true") filters.push("vp.next_review_at IS NOT NULL AND vp.next_review_at <= CURRENT_TIMESTAMP");
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const [rows] = await pool.query(
      `SELECT v.*, vc.slug AS category_slug, vc.name AS category_name,
        vp.status AS progress_status, vp.review_count, vp.correct_answers, vp.incorrect_answers, vp.last_reviewed_at, vp.next_review_at,
        vf.id AS favorite_id
       FROM vocabulary v
       JOIN vocabulary_categories vc ON vc.id = v.category_id
       LEFT JOIN vocabulary_progress vp ON vp.vocabulary_id = v.id AND vp.user_id = ?
       LEFT JOIN vocabulary_favorites vf ON vf.vocabulary_id = v.id AND vf.user_id = ?
       ${where.replaceAll("?", "?")} ORDER BY v.cefr_level, v.word LIMIT ? OFFSET ?`,
      [req.user.sub, req.user.sub, ...params.slice(1), pageSize, offset],
    );
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM vocabulary v JOIN vocabulary_categories vc ON vc.id = v.category_id LEFT JOIN vocabulary_progress vp ON vp.vocabulary_id = v.id AND vp.user_id = ? LEFT JOIN vocabulary_favorites vf ON vf.vocabulary_id = v.id AND vf.user_id = ? ${where}`,
      [req.user.sub, req.user.sub, ...params.slice(1)],
    );
    res.json({ items: rows.map(mapVocabulary), page, pageSize, total: countRows[0].total });
  } catch (error) { next(error); }
});

router.get("/vocabulary/:id", requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT v.*, vc.slug AS category_slug, vc.name AS category_name, vp.status AS progress_status, vp.review_count, vp.correct_answers, vp.incorrect_answers, vp.last_reviewed_at, vp.next_review_at, vf.id AS favorite_id
       FROM vocabulary v JOIN vocabulary_categories vc ON vc.id = v.category_id
       LEFT JOIN vocabulary_progress vp ON vp.vocabulary_id = v.id AND vp.user_id = ?
       LEFT JOIN vocabulary_favorites vf ON vf.vocabulary_id = v.id AND vf.user_id = ? WHERE v.id = ?`,
      [req.user.sub, req.user.sub, req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: "Vocabulary item not found" });
    res.json(mapVocabulary(rows[0]));
  } catch (error) { next(error); }
});

router.post("/vocabulary/:id/learn", requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query(`SELECT id FROM vocabulary WHERE id = ?`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Vocabulary item not found" });
    await pool.query(
      `INSERT INTO vocabulary_progress (id, user_id, vocabulary_id, status, review_count, last_reviewed_at, next_review_at)
       VALUES (?, ?, ?, 'learned', 1, CURRENT_TIMESTAMP, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 3 DAY))
       ON DUPLICATE KEY UPDATE status = 'learned', review_count = review_count + 1, last_reviewed_at = CURRENT_TIMESTAMP, next_review_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 3 DAY)`,
      [uuid(), req.user.sub, req.params.id],
    );
    res.json({ status: "learned" });
  } catch (error) { next(error); }
});

router.post("/vocabulary/:id/favorite", requireAuth, async (req, res, next) => {
  try {
    const favorite = req.body?.favorite !== false;
    const [rows] = await pool.query(`SELECT id FROM vocabulary WHERE id = ?`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Vocabulary item not found" });
    if (favorite) {
      await pool.query(`INSERT IGNORE INTO vocabulary_favorites (id, user_id, vocabulary_id) VALUES (?, ?, ?)`, [uuid(), req.user.sub, req.params.id]);
    } else {
      await pool.query(`DELETE FROM vocabulary_favorites WHERE user_id = ? AND vocabulary_id = ?`, [req.user.sub, req.params.id]);
    }
    res.json({ favorite });
  } catch (error) { next(error); }
});

router.post("/vocabulary/:id/review", requireAuth, async (req, res, next) => {
  try {
    const correct = Boolean(req.body?.correct);
    const [rows] = await pool.query(`SELECT id FROM vocabulary WHERE id = ?`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Vocabulary item not found" });
    await pool.query(
      `INSERT INTO vocabulary_progress (id, user_id, vocabulary_id, status, review_count, correct_answers, incorrect_answers, last_reviewed_at, next_review_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? DAY))
       ON DUPLICATE KEY UPDATE status = VALUES(status), review_count = review_count + 1, correct_answers = correct_answers + VALUES(correct_answers), incorrect_answers = incorrect_answers + VALUES(incorrect_answers), last_reviewed_at = CURRENT_TIMESTAMP, next_review_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? DAY)`,
      [uuid(), req.user.sub, req.params.id, correct ? "learned" : "difficult", correct ? 1 : 0, correct ? 0 : 1, correct ? 3 : 1, correct ? 3 : 1],
    );
    res.json({ correct, nextReviewInDays: correct ? 3 : 1 });
  } catch (error) { next(error); }
});

router.get("/grammar", requireAuth, async (req, res, next) => {
  try {
    if (!validateLevel(req.query.level)) return res.status(400).json({ error: "Invalid CEFR level" });
    const params = [req.user.sub];
    const filter = req.query.level ? "AND gt.cefr_level = ?" : "";
    if (req.query.level) params.push(req.query.level);
    const [rows] = await pool.query(`SELECT gt.*, gp.status AS progress_status, gp.score, gp.completed_at FROM grammar_topics gt LEFT JOIN grammar_progress gp ON gp.grammar_topic_id = gt.id AND gp.user_id = ? WHERE 1 = 1 ${filter} ORDER BY gt.cefr_level, gt.difficulty, gt.title`, params);
    res.json(rows.map(mapTopic));
  } catch (error) { next(error); }
});

router.get("/grammar/:id", requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query(`SELECT gt.*, gp.status AS progress_status, gp.score, gp.completed_at FROM grammar_topics gt LEFT JOIN grammar_progress gp ON gp.grammar_topic_id = gt.id AND gp.user_id = ? WHERE gt.id = ?`, [req.user.sub, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Grammar topic not found" });
    res.json(mapTopic(rows[0]));
  } catch (error) { next(error); }
});

router.post("/grammar/:id/complete", requireAuth, async (req, res, next) => {
  try {
    const score = Math.min(Math.max(Number(req.body?.score ?? 100), 0), 100);
    const [rows] = await pool.query(`SELECT id FROM grammar_topics WHERE id = ?`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Grammar topic not found" });
    await pool.query(`INSERT INTO grammar_progress (id, user_id, grammar_topic_id, status, score, completed_at) VALUES (?, ?, ?, 'completed', ?, CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE status = 'completed', score = VALUES(score), completed_at = CURRENT_TIMESTAMP`, [uuid(), req.user.sub, req.params.id, score]);
    res.json({ completed: true, score });
  } catch (error) { next(error); }
});

router.get("/pronunciation", requireAuth, async (req, res, next) => {
  try {
    if (!validateLevel(req.query.level)) return res.status(400).json({ error: "Invalid CEFR level" });
    const params = [req.user.sub];
    const filter = req.query.level ? "AND pl.cefr_level = ?" : "";
    if (req.query.level) params.push(req.query.level);
    const [rows] = await pool.query(`SELECT pl.*, pp.completed AS progress_completed, pp.practice_count FROM pronunciation_lessons pl LEFT JOIN pronunciation_progress pp ON pp.lesson_id = pl.id AND pp.user_id = ? WHERE 1 = 1 ${filter} ORDER BY pl.cefr_level, pl.title`, params);
    res.json(rows.map((row) => ({ ...row, example_words: parseJson(row.example_words), minimal_pairs: parseJson(row.minimal_pairs), common_mistakes: parseJson(row.common_mistakes) })));
  } catch (error) { next(error); }
});

router.get("/pronunciation/:id", requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query(`SELECT pl.*, pp.completed AS progress_completed, pp.practice_count FROM pronunciation_lessons pl LEFT JOIN pronunciation_progress pp ON pp.lesson_id = pl.id AND pp.user_id = ? WHERE pl.id = ?`, [req.user.sub, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Pronunciation lesson not found" });
    const [exercises] = await pool.query(`SELECT * FROM pronunciation_exercises WHERE lesson_id = ? ORDER BY sort_order`, [req.params.id]);
    res.json({ ...rows[0], example_words: parseJson(rows[0].example_words), minimal_pairs: parseJson(rows[0].minimal_pairs), common_mistakes: parseJson(rows[0].common_mistakes), exercises });
  } catch (error) { next(error); }
});

router.post("/pronunciation/:id/complete", requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query(`SELECT id FROM pronunciation_lessons WHERE id = ?`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Pronunciation lesson not found" });
    await pool.query(`INSERT INTO pronunciation_progress (id, user_id, lesson_id, completed, practice_count) VALUES (?, ?, ?, TRUE, 1) ON DUPLICATE KEY UPDATE completed = TRUE, practice_count = practice_count + 1`, [uuid(), req.user.sub, req.params.id]);
    res.json({ completed: true });
  } catch (error) { next(error); }
});

router.post("/pronunciation/:id/audio", requireAuth, async (req, res, next) => {
  try {
    const text = String(req.body?.text || "").trim();
    if (!text || text.length > 500) return res.status(400).json({ error: "text is required and must be 500 characters or fewer" });
    const [rows] = await pool.query(`SELECT id FROM pronunciation_lessons WHERE id = ?`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Pronunciation lesson not found" });
    const audio = await synthesize(text);
    res.json({ audioBase64: audio.toString("base64"), analysisAvailable: false });
  } catch (error) { next(error); }
});

router.get("/sentence-structure", requireAuth, async (req, res, next) => {
  try {
    if (!validateLevel(req.query.level)) return res.status(400).json({ error: "Invalid CEFR level" });
    const params = [req.user.sub];
    const filter = req.query.level ? "AND st.cefr_level = ?" : "";
    if (req.query.level) params.push(req.query.level);
    const [rows] = await pool.query(`SELECT st.*, sp.completed AS progress_completed, sp.correct_answers, sp.incorrect_answers FROM sentence_structure_topics st LEFT JOIN sentence_progress sp ON sp.topic_id = st.id AND sp.user_id = ? WHERE 1 = 1 ${filter} ORDER BY st.cefr_level, st.title`, params);
    res.json(rows.map((row) => ({ ...row, examples: parseJson(row.examples) })));
  } catch (error) { next(error); }
});

router.get("/sentence-structure/:id", requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query(`SELECT st.*, sp.completed AS progress_completed, sp.correct_answers, sp.incorrect_answers FROM sentence_structure_topics st LEFT JOIN sentence_progress sp ON sp.topic_id = st.id AND sp.user_id = ? WHERE st.id = ?`, [req.user.sub, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Sentence structure topic not found" });
    const [exercises] = await pool.query(`SELECT * FROM sentence_exercises WHERE topic_id = ? ORDER BY sort_order`, [req.params.id]);
    res.json({ ...rows[0], examples: parseJson(rows[0].examples), exercises: exercises.map((exercise) => ({ ...exercise, options: parseJson(exercise.options) })) });
  } catch (error) { next(error); }
});

router.post("/sentence-structure/:id/answer", requireAuth, async (req, res, next) => {
  try {
    const exerciseId = req.body?.exerciseId;
    const answer = String(req.body?.answer || "").trim();
    const [rows] = await pool.query(`SELECT se.*, st.id AS topic_id FROM sentence_exercises se JOIN sentence_structure_topics st ON st.id = se.topic_id WHERE se.id = ? AND st.id = ?`, [exerciseId, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Sentence exercise not found" });
    const correct = answer.toLowerCase() === rows[0].correct_answer.toLowerCase();
    await pool.query(`INSERT INTO sentence_progress (id, user_id, topic_id, correct_answers, incorrect_answers) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE correct_answers = correct_answers + VALUES(correct_answers), incorrect_answers = incorrect_answers + VALUES(incorrect_answers)`, [uuid(), req.user.sub, req.params.id, correct ? 1 : 0, correct ? 0 : 1]);
    if (correct) {
      const [exerciseCount] = await pool.query(`SELECT COUNT(*) AS total FROM sentence_exercises WHERE topic_id = ?`, [req.params.id]);
      const [progressRows] = await pool.query(`SELECT correct_answers FROM sentence_progress WHERE user_id = ? AND topic_id = ?`, [req.user.sub, req.params.id]);
      if (progressRows[0]?.correct_answers >= exerciseCount[0].total) await pool.query(`UPDATE sentence_progress SET completed = TRUE WHERE user_id = ? AND topic_id = ?`, [req.user.sub, req.params.id]);
    }
    res.json({ correct, correctAnswer: rows[0].correct_answer, explanation: rows[0].explanation });
  } catch (error) { next(error); }
});

router.post("/quiz/start", requireAuth, async (req, res, next) => {
  try {
    const skill = req.body?.skill;
    const level = req.body?.cefrLevel;
    if (!skills.includes(skill) || !levels.includes(level)) return res.status(400).json({ error: "skill and a valid cefrLevel are required" });
    const limit = Math.min(Math.max(Number.parseInt(req.body?.limit || "10", 10) || 10, 1), 25);
    const [questions] = await pool.query(`SELECT id, skill, cefr_level, category, question_type, prompt, options, explanation FROM quiz_questions WHERE skill = ? AND cefr_level = ? ORDER BY RAND() LIMIT ?`, [skill, level, limit]);
    res.status(201).json({ skill, cefrLevel: level, questions: questions.map((question) => ({ ...question, options: parseJson(question.options) })) });
  } catch (error) { next(error); }
});

router.post("/quiz/answer", requireAuth, async (req, res, next) => {
  try {
    const { questionId } = req.body;
    const userAnswer = String(req.body?.answer || "").trim();
    const [rows] = await pool.query(`SELECT * FROM quiz_questions WHERE id = ?`, [questionId]);
    if (!rows[0]) return res.status(404).json({ error: "Quiz question not found" });
    const question = rows[0];
    const correct = userAnswer.toLowerCase() === question.correct_answer.toLowerCase();
    await pool.query(`INSERT INTO quiz_attempts (id, user_id, question_id, user_answer, correct_answer, is_correct, score, cefr_level, skill, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [uuid(), req.user.sub, question.id, userAnswer, question.correct_answer, correct, correct ? 100 : 0, question.cefr_level, question.skill, question.category]);
    res.json({ correct, correctAnswer: question.correct_answer, explanation: question.explanation, score: correct ? 100 : 0 });
  } catch (error) { next(error); }
});

router.post("/quiz/finish", requireAuth, async (req, res, next) => {
  try {
    const questionIds = Array.isArray(req.body?.questionIds) ? req.body.questionIds : [];
    if (!questionIds.length) return res.status(400).json({ error: "questionIds are required" });
    const placeholders = questionIds.map(() => "?").join(",");
    const [rows] = await pool.query(`SELECT COUNT(*) AS attempts, COALESCE(SUM(is_correct), 0) AS correct FROM quiz_attempts WHERE user_id = ? AND question_id IN (${placeholders})`, [req.user.sub, ...questionIds]);
    const score = rows[0].attempts ? Math.round((rows[0].correct / rows[0].attempts) * 100) : 0;
    res.json({ attempts: rows[0].attempts, correct: rows[0].correct, score });
  } catch (error) { next(error); }
});

router.get("/progress", requireAuth, async (req, res, next) => {
  try {
    const [vocabularyRows] = await pool.query(`SELECT COUNT(v.id) AS total, COUNT(CASE WHEN vp.status = 'learned' THEN 1 END) AS completed FROM vocabulary v LEFT JOIN vocabulary_progress vp ON vp.vocabulary_id = v.id AND vp.user_id = ?`, [req.user.sub]);
    const [grammarRows] = await pool.query(`SELECT COUNT(gt.id) AS total, COUNT(CASE WHEN gp.status = 'completed' THEN 1 END) AS completed FROM grammar_topics gt LEFT JOIN grammar_progress gp ON gp.grammar_topic_id = gt.id AND gp.user_id = ?`, [req.user.sub]);
    const [pronunciationRows] = await pool.query(`SELECT COUNT(pl.id) AS total, COUNT(CASE WHEN pp.completed = 1 THEN 1 END) AS completed FROM pronunciation_lessons pl LEFT JOIN pronunciation_progress pp ON pp.lesson_id = pl.id AND pp.user_id = ?`, [req.user.sub]);
    const [sentenceRows] = await pool.query(`SELECT COUNT(st.id) AS total, COUNT(CASE WHEN sp.completed = 1 THEN 1 END) AS completed FROM sentence_structure_topics st LEFT JOIN sentence_progress sp ON sp.topic_id = st.id AND sp.user_id = ?`, [req.user.sub]);
    const [quizRows] = await pool.query(`SELECT COUNT(*) AS attempts, COALESCE(SUM(is_correct), 0) AS correct FROM quiz_attempts WHERE user_id = ?`, [req.user.sub]);
    const metric = (row) => ({ total: Number(row.total), completed: Number(row.completed), percent: row.total ? Math.round((row.completed / row.total) * 100) : 0 });
    const progress = { vocabulary: metric(vocabularyRows[0]), grammar: metric(grammarRows[0]), pronunciation: metric(pronunciationRows[0]), sentence_structure: metric(sentenceRows[0]), quiz: { attempts: Number(quizRows[0].attempts), correct: Number(quizRows[0].correct), percent: quizRows[0].attempts ? Math.round((quizRows[0].correct / quizRows[0].attempts) * 100) : 0 } };
    const overall = Math.round((progress.vocabulary.percent + progress.grammar.percent + progress.pronunciation.percent + progress.sentence_structure.percent) / 4);
    res.json({ overall, currentLevel: req.query.level && levels.includes(req.query.level) ? req.query.level : "A1", targetLevel: "C2", progress });
  } catch (error) { next(error); }
});

router.get("/recommendations", requireAuth, async (req, res, next) => {
  try {
    const [weak] = await pool.query(`SELECT skill, category, COUNT(*) AS attempts, SUM(is_correct) AS correct FROM quiz_attempts WHERE user_id = ? GROUP BY skill, category HAVING attempts >= 1 ORDER BY (correct / attempts) ASC, attempts DESC LIMIT 5`, [req.user.sub]);
    const paths = { vocabulary: "/learning/vocabulary", grammar: "/learning/grammar", pronunciation: "/learning/pronunciation", sentence_structure: "/learning/sentences", speaking: "/practice/free" };
    const recommendations = weak.map((item, index) => ({ skill: item.skill, title: `${item.category.replaceAll("_", " ")} practice`, reason: `${item.correct} correct out of ${item.attempts} attempts`, priority: index + 1, contentPath: paths[item.skill] || "/learning" }));
    if (!recommendations.length) recommendations.push({ skill: "vocabulary", title: "Start with A1 vocabulary", reason: "Build a foundation before your first quiz.", priority: 1, contentPath: "/learning/vocabulary" });
    res.json(recommendations);
  } catch (error) { next(error); }
});

export default router;
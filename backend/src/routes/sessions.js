import { Router } from "express";
import multer from "multer";
import { v4 as uuid } from "uuid";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { processTurn, processTurnAudio } from "../core/engine.js";
import { transcribe } from "../core/audio.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (/^audio\/(mpeg|mp4|wav|x-wav|webm|ogg|aac)$/.test(file.mimetype)) callback(null, true);
    else {
      const error = new Error("Unsupported audio format");
      error.status = 400;
      callback(error);
    }
  },
});

// Student: start a practice session (optionally tied to an assignment)
router.post("/", requireAuth, requireRole("student"), async (req, res, next) => {
  try {
    const { assignmentId, cefrLevel } = req.body;
    let level = cefrLevel;

    if (assignmentId) {
      const [rows] = await pool.query(`SELECT cefr_level FROM assignments WHERE id = ?`, [
        assignmentId,
      ]);
      if (!rows[0]) return res.status(404).json({ error: "Assignment not found" });
      level = rows[0].cefr_level;
    }

    if (!level) return res.status(400).json({ error: "cefrLevel is required when there is no assignmentId" });

    const id = uuid();
    await pool.query(
      `INSERT INTO practice_sessions (id, student_id, assignment_id, cefr_level)
       VALUES (?, ?, ?, ?)`,
      [id, req.user.sub, assignmentId || null, level]
    );
    const [rows] = await pool.query(`SELECT * FROM practice_sessions WHERE id = ?`, [id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

async function assertSessionOwner(sessionId, userId) {
  const [rows] = await pool.query(`SELECT * FROM practice_sessions WHERE id = ?`, [sessionId]);
  if (!rows[0] || rows[0].student_id !== userId) return null;
  return rows[0];
}

// Submit one turn as raw audio (multipart/form-data, field name "audio").
// Runs: transcribe -> processTurn (concurrent reply + assessment) -> persist.
router.post(
  "/:id/turns/audio",
  requireAuth,
  requireRole("student"),
  upload.single("audio"),
  async (req, res, next) => {
    try {
      const session = await assertSessionOwner(req.params.id, req.user.sub);
      if (!session) return res.status(404).json({ error: "Session not found" });
      if (!req.file) return res.status(400).json({ error: "audio file is required" });

      const [countRows] = await pool.query(
        `SELECT COUNT(*) AS n FROM exchanges WHERE session_id = ?`,
        [session.id]
      );
      const turnIndex = countRows[0].n;

      const result = await processTurnAudio({
        sessionId: session.id,
        turnIndex,
        audioBuffer: req.file.buffer,
        mimeType: req.file.mimetype,
        cefrLevel: session.cefr_level,
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

// Submit one turn as plain text (useful for the web/mobile text-input mode,
// and for the roadmap's writing/reading skill extensions).
router.post("/:id/turns/text", requireAuth, requireRole("student"), async (req, res, next) => {
  try {
    const session = await assertSessionOwner(req.params.id, req.user.sub);
    if (!session) return res.status(404).json({ error: "Session not found" });

    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "text is required" });

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS n FROM exchanges WHERE session_id = ?`,
      [session.id]
    );

    const result = await processTurn({
      sessionId: session.id,
      turnIndex: countRows[0].n,
      transcript: text,
      cefrLevel: session.cefr_level,
      history: [],
    });

    res.json({ transcript: text, ...result });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/exchanges", requireAuth, async (req, res, next) => {
  try {
    const session = await assertSessionOwner(req.params.id, req.user.sub);
    if (!session && req.user.role !== "teacher") {
      return res.status(404).json({ error: "Session not found" });
    }
    const [rows] = await pool.query(
      `SELECT * FROM exchanges WHERE session_id = ? ORDER BY turn_index ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// End-of-session markdown report for the student.
router.get("/:id/report", requireAuth, async (req, res, next) => {
  try {
    const session = await assertSessionOwner(req.params.id, req.user.sub);
    if (!session) return res.status(404).json({ error: "Session not found" });

    const [rows] = await pool.query(
      `SELECT * FROM exchanges WHERE session_id = ? ORDER BY turn_index ASC`,
      [session.id]
    );

    const allErrors = rows.flatMap((r) => r.errors || []);
    const byCategory = {};
    for (const e of allErrors) byCategory[e.category] = (byCategory[e.category] || 0) + 1;

    const lines = [
      `# Practice session report`,
      ``,
      `**CEFR level:** ${session.cefr_level}`,
      `**Turns completed:** ${rows.length}`,
      `**Total errors flagged:** ${allErrors.length}`,
      ``,
      `## Errors by category`,
      ...Object.entries(byCategory).map(([cat, n]) => `- **${cat}**: ${n}`),
    ];

    res.json({ markdown: lines.join("\n"), errorsByCategory: byCategory, turns: rows.length });
  } catch (err) {
    next(err);
  }
});

export default router;

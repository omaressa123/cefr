import { Router } from "express";
import { v4 as uuid } from "uuid";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { assertClassroomAccess } from "./classrooms.js";

const router = Router();

// Teacher: create an assignment for a classroom
router.post(
  "/classrooms/:classroomId/assignments",
  requireAuth,
  requireRole("teacher"),
  async (req, res, next) => {
    try {
      const ok = await assertClassroomAccess(req.user.sub, "teacher", req.params.classroomId);
      if (!ok) return res.status(403).json({ error: "Not your classroom" });

      const { cefrLevel, targetTopic } = req.body;
      if (!cefrLevel || !targetTopic) {
        return res.status(400).json({ error: "cefrLevel and targetTopic are required" });
      }

      const id = uuid();
      await pool.query(
        `INSERT INTO assignments (id, classroom_id, cefr_level, target_topic)
         VALUES (?, ?, ?, ?)`,
        [id, req.params.classroomId, cefrLevel, targetTopic]
      );
      const [rows] = await pool.query(`SELECT * FROM assignments WHERE id = ?`, [id]);
      res.status(201).json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

router.get("/classrooms/:classroomId/assignments", requireAuth, async (req, res, next) => {
  try {
    const ok = await assertClassroomAccess(req.user.sub, req.user.role, req.params.classroomId);
    if (!ok) return res.status(403).json({ error: "Not a member of this classroom" });

    const [rows] = await pool.query(
      `SELECT * FROM assignments WHERE classroom_id = ? ORDER BY created_at DESC`,
      [req.params.classroomId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/assignments/:id", requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM assignments WHERE id = ?`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Assignment not found" });

    const ok = await assertClassroomAccess(req.user.sub, req.user.role, rows[0].classroom_id);
    if (!ok) return res.status(403).json({ error: "Not a member of this classroom" });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;

import { Router } from "express";
import { randomBytes } from "crypto";
import { v4 as uuid } from "uuid";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

function generateJoinCode() {
  return randomBytes(3).toString("hex").toUpperCase(); // e.g. "A1B2C3"
}

// Teacher: create a classroom
router.post("/", requireAuth, requireRole("teacher"), async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });

    const id = uuid();
    await pool.query(
      `INSERT INTO classrooms (id, teacher_id, name, join_code) VALUES (?, ?, ?, ?)`,
      [id, req.user.sub, name, generateJoinCode()]
    );
    const [rows] = await pool.query(`SELECT * FROM classrooms WHERE id = ?`, [id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// List classrooms the current user teaches or is enrolled in
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const query =
      req.user.role === "teacher"
        ? `SELECT * FROM classrooms WHERE teacher_id = ? ORDER BY created_at DESC`
        : `SELECT c.* FROM classrooms c
             JOIN enrollments e ON e.classroom_id = c.id
            WHERE e.student_id = ?
            ORDER BY c.created_at DESC`;
    const [rows] = await pool.query(query, [req.user.sub]);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Student: join a classroom via join code
router.post("/join", requireAuth, requireRole("student"), async (req, res, next) => {
  try {
    const { joinCode } = req.body;
    const [rows] = await pool.query(`SELECT * FROM classrooms WHERE join_code = ?`, [
      (joinCode || "").toUpperCase(),
    ]);
    const classroom = rows[0];
    if (!classroom) return res.status(404).json({ error: "No classroom with that join code" });

    await pool.query(
      `INSERT IGNORE INTO enrollments (id, student_id, classroom_id) VALUES (?, ?, ?)`,
      [uuid(), req.user.sub, classroom.id]
    );
    res.status(201).json(classroom);
  } catch (err) {
    next(err);
  }
});

// Ownership/enrollment check shared by assignments + report routes
export async function assertClassroomAccess(userId, role, classroomId) {
  if (role === "teacher") {
    const [rows] = await pool.query(
      `SELECT 1 FROM classrooms WHERE id = ? AND teacher_id = ?`,
      [classroomId, userId]
    );
    return rows.length > 0;
  }
  const [rows] = await pool.query(
    `SELECT 1 FROM enrollments WHERE classroom_id = ? AND student_id = ?`,
    [classroomId, userId]
  );
  return rows.length > 0;
}

router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const ok = await assertClassroomAccess(req.user.sub, req.user.role, req.params.id);
    if (!ok) return res.status(403).json({ error: "Not a member of this classroom" });

    const [rows] = await pool.query(`SELECT * FROM classrooms WHERE id = ?`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Classroom not found" });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;

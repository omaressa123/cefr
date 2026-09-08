import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuid } from "uuid";
import { pool } from "../db/pool.js";
import { config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/register", async (req, res, next) => {
  try {
    const { username, password, displayName, role } = req.body;
    if (!username || !password || !displayName) {
      return res.status(400).json({ error: "username, password, and displayName are required" });
    }
    if (password.length < 8) return res.status(400).json({ error: "password must be at least 8 characters" });
    if (role && !["teacher", "student"].includes(role)) {
      return res.status(400).json({ error: "role must be 'teacher' or 'student'" });
    }
    if (role === "teacher" && !config.allowPublicTeacherRegistration) {
      return res.status(403).json({ error: "Teacher registration is disabled on this server" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const id = uuid();
    await pool.query(
      `INSERT INTO profiles (id, username, password_hash, display_name, role)
       VALUES (?, ?, ?, ?, ?)`,
      [id, username, passwordHash, displayName, role || "student"]
    );
    const [rows] = await pool.query(
      `SELECT id, username, display_name, role FROM profiles WHERE id = ?`,
      [id]
    );

    const user = rows[0];
    const token = jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: "30d" });
    res.status(201).json({ token, user });
  } catch (err) {
    if (err.code === "23505" || err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Username already taken" });
    }
    next(err);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const [rows] = await pool.query(`SELECT * FROM profiles WHERE username = ?`, [username]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const token = jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: "30d" });
    res.json({
      token,
      user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, username, display_name, role FROM profiles WHERE id = ?`,
      [req.user.sub]
    );
    if (!rows[0]) return res.status(404).json({ error: "User not found" });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;

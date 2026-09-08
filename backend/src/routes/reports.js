import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { assertClassroomAccess } from "./classrooms.js";
import { buildCohortReport } from "../core/engine.js";

const router = Router();

// Cohort-aggregated teacher report: "60% of your class failed on
// Prepositions today" style macro-trends, sent to the Teacher Dashboard.
router.get(
  "/classrooms/:classroomId/report",
  requireAuth,
  requireRole("teacher"),
  async (req, res, next) => {
    try {
      const ok = await assertClassroomAccess(req.user.sub, "teacher", req.params.classroomId);
      if (!ok) return res.status(403).json({ error: "Not your classroom" });

      const since = req.query.since
        ? new Date(req.query.since)
        : new Date(Date.now() - 24 * 60 * 60 * 1000); // default: last 24h

      const breakdown = await buildCohortReport(req.params.classroomId, since);
      res.json({ since, breakdown });
    } catch (err) {
      next(err);
    }
  }
);

export default router;

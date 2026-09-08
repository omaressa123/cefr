import { Router } from "express";
import authRoutes from "./auth.js";
import classroomRoutes from "./classrooms.js";
import assignmentRoutes from "./assignments.js";
import sessionRoutes from "./sessions.js";
import reportRoutes from "./reports.js";
import learningRoutes from "./learning.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/classrooms", classroomRoutes);
router.use("/", assignmentRoutes); // /classrooms/:id/assignments, /assignments/:id
router.use("/sessions", sessionRoutes);
router.use("/", reportRoutes); // /classrooms/:id/report
router.use("/", learningRoutes);

export default router;

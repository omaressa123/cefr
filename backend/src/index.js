import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import hpp from "hpp";
import { config } from "./config.js";
import apiRouter from "./routes/index.js";

const app = express();

if (!config.databaseUrl) throw new Error("DATABASE_URL is required");
if (config.nodeEnv === "production" && (!config.jwtSecret || config.jwtSecret.length < 32)) {
  throw new Error("JWT_SECRET must be set to at least 32 characters in production");
}

app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "*"],
    }
  }
}));
app.use(cors({ origin: "*" }));
app.use(morgan(config.nodeEnv === "production" ? "combined" : "dev"));
app.use(express.json({ limit: "2mb" }));
app.use(hpp());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: "draft-7", legacyHeaders: false }));

app.get("/health", async (req, res) => {
  try {
    const { pool } = await import("./db/pool.js");
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "unavailable" });
  }
});

// Route: /api/v1/*  (mirrors the original FastAPI mount point)
app.use("/api/v1", apiRouter);

app.use((err, req, res, next) => {
  console.error(`${req.method} ${req.originalUrl}: ${err.message}`);
  res.status(err.status || 500).json({ error: config.nodeEnv === "production" ? "Internal server error" : err.message });
});

app.listen(config.port, () => {
  console.log(`CEFR Practice Partner API listening on :${config.port}`);
});

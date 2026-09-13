import "dotenv/config";

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: process.env.PORT || 4000,
  jwtSecret: process.env.JWT_SECRET || "dev-jwt-secret-min-32-chars-long!",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  allowPublicTeacherRegistration: process.env.ALLOW_PUBLIC_TEACHER_REGISTRATION === "true",
  databaseUrl: process.env.DATABASE_URL || "mysql://cefr:cefr_local_password@localhost:3306/cefr_practice_partner",

  llm: {
    baseUrl: process.env.LLM_BASE_URL || "http://localhost:11434/v1",
    apiKey: process.env.LLM_API_KEY || "",
    fastModel: process.env.LLM_FAST_MODEL || "gpt-oss-20b",
    heavyModel: process.env.LLM_HEAVY_MODEL || "gpt-oss-120b",
    fallback: {
      baseUrl: process.env.LLM_FALLBACK_BASE_URL || "",
      apiKey: process.env.LLM_FALLBACK_API_KEY || "",
      model: process.env.LLM_FALLBACK_MODEL || "gemini-flash-latest",
    },
  },

  stt: {
    baseUrl: process.env.STT_BASE_URL || "",
    apiKey: process.env.STT_API_KEY || "",
    model: process.env.STT_MODEL || "whisper-large-v3-turbo",
  },

  tts: {
    voice: process.env.TTS_VOICE || "en-US-AriaNeural",
  },
};

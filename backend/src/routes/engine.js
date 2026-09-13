import { Router } from "express";
import { config } from "../config.js";

const router = Router();

// Public linkage-status endpoint used by BOTH the web app and the mobile app
// to confirm the AI model pipeline is actually wired up (not stubbed).
// It reports presence of configuration plus live health probes of the
// local verbatim-Whisper STT sidecar and the LLM provider — but never
// leaks secrets or URLs.
// Live probe of the LLM provider (same pattern as the STT probe above).
// LLM_BASE_URL is an OpenAI-compatible base (e.g. http://ollama:11434/v1),
// so GET <base>/models lists the models the server can actually serve.
// Reports healthy:true only on a real 200 response — never leaks URLs.
async function llmStatus() {
  const llm = {
    configured: Boolean(config.llm.baseUrl),
    fastModel: config.llm.fastModel,
    heavyModel: config.llm.heavyModel,
    fallbackConfigured: Boolean(config.llm.fallback.baseUrl),
    healthy: false,
  };
  if (!llm.configured) return llm;
  try {
    const probe = await fetch(`${config.llm.baseUrl.replace(/\/$/, "")}/models`, {
      signal: AbortSignal.timeout(5000),
    });
    if (probe.ok) {
      const data = await probe.json().catch(() => ({}));
      llm.healthy = true;
      if (Array.isArray(data.data)) llm.serverModels = data.data.map((m) => m.id);
    }
  } catch {
    llm.healthy = false;
  }
  return llm;
}

router.get("/engine/status", async (req, res, next) => {
  try {
    const stt = { configured: Boolean(config.stt.baseUrl), model: config.stt.model, healthy: false };
    if (stt.configured) {
      try {
        const probe = await fetch(`${config.stt.baseUrl.replace(/\/$/, "")}/health`, {
          signal: AbortSignal.timeout(5000),
        });
        if (probe.ok) {
          const data = await probe.json().catch(() => ({}));
          stt.healthy = data.loaded !== false;
          if (data.model) stt.serverModel = data.model;
          if (data.device) stt.serverDevice = data.device;
        }
      } catch {
        stt.healthy = false;
      }
    }

    res.json({
      stt,
      llm: await llmStatus(),
      tts: { voice: config.tts.voice },
    });
  } catch (err) {
    next(err);
  }
});

export default router;

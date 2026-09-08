import { config } from "../config.js";
import { ERROR_CATEGORIES } from "./taxonomy.js";

// --- Generic OpenAI-compatible chat completion caller -------------------
// This is deliberately provider-agnostic: point LLM_BASE_URL / LLM_API_KEY
// at Groq, a local Ollama/vLLM OpenAI-compat shim, or anything else that
// speaks the /chat/completions shape. No model logic lives here - this file
// is just the wire.
// Local servers (Ollama, vLLM, lm-studio) typically do not require an API key.
async function callChat({ baseUrl, apiKey, model, messages, temperature, jsonMode }) {
  if (!baseUrl) {
    throw new Error(
      "LLM provider not configured. Set LLM_BASE_URL in backend/.env to point at your own model."
    );
  }

  const headers = { "Content-Type": "application/json" };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LLM call failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function callWithFallback(opts) {
  try {
    return await callChat({
      baseUrl: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature,
      jsonMode: opts.jsonMode,
    });
  } catch (primaryErr) {
    if (!config.llm.fallback.baseUrl) {
      throw primaryErr;
    }
    console.warn("Primary LLM failed, falling back:", primaryErr.message);
    return callChat({
      baseUrl: config.llm.fallback.baseUrl,
      apiKey: config.llm.fallback.apiKey,
      model: config.llm.fallback.model,
      messages: opts.messages,
      temperature: opts.temperature,
      jsonMode: opts.jsonMode,
    });
  }
}

// Fast conversational partner reply. temperature=0.7, matches the original spec.
export async function generateConversationalReply({ transcript, cefrLevel, history }) {
  const messages = [
    {
      role: "system",
      content:
        `You are a warm, patient English conversation partner speaking with a ${cefrLevel} ` +
        `level student. Reply naturally and briefly (2-4 sentences), keep the conversation ` +
        `going with a follow-up question, and use vocabulary appropriate for ${cefrLevel}. ` +
        `Do not correct grammar here - that is handled separately.`,
    },
    ...(history || []),
    { role: "user", content: transcript },
  ];

  return callWithFallback({ model: config.llm.fastModel, messages, temperature: 0.7 });
}

// Heavy structural grammar/vocabulary assessment. temperature=0.15.
// Returns raw JSON text - engine.js validates and applies the verbatim
// quotation guardrail before anything reaches the student.
export async function analyzeGrammar({ transcript, cefrLevel }) {
  const messages = [
    {
      role: "system",
      content:
        `You are a strict CELTA-qualified English assessor. Analyze the student transcript ` +
        `below for a ${cefrLevel} level learner.\n\n` +
        `Rules:\n` +
        `1. Classify every error into EXACTLY ONE of these 11 categories, nothing else: ` +
        `${ERROR_CATEGORIES.join(", ")}.\n` +
        `2. For every error, "quote" MUST be an exact, character-for-character substring of ` +
        `the transcript. If you cannot quote it verbatim, do not include it.\n` +
        `3. Include a short "explanation" and a "suggestion" (corrected form) per error.\n` +
        `4. Respond with ONLY a JSON object of the shape: ` +
        `{"errors": [{"category": string, "quote": string, "explanation": string, "suggestion": string}]}`,
    },
    { role: "user", content: transcript },
  ];

  const raw = await callWithFallback({
    model: config.llm.heavyModel,
    messages,
    temperature: 0.15,
    jsonMode: true,
  });

  try {
    return JSON.parse(raw);
  } catch {
    return { errors: [] };
  }
}

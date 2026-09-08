import { pool } from "../db/pool.js";
import { generateConversationalReply, analyzeGrammar } from "./llmRouter.js";
import { synthesize } from "./audio.js";
import { ERROR_CATEGORIES } from "./taxonomy.js";
import { config } from "../config.js";

// Verbatim Quotation Guardrail: discard any error whose quote cannot be
// found character-for-character in the transcript, and any error outside
// the closed 11-category taxonomy. This is what stops the assessor LLM
// from hallucinating mistakes the student never made.
function applyVerbatimGuardrail(transcript, rawErrors = []) {
  return rawErrors.filter((e) => {
    if (!e || typeof e.quote !== "string" || typeof e.category !== "string") return false;
    if (!ERROR_CATEGORIES.includes(e.category)) return false;
    return transcript.includes(e.quote);
  });
}

// Guided Discovery (B1+) vs Explicit Correction (A1-A2): for lower levels
// the corrected form is shown directly; for B1+ we attach a concept-check
// question and hide the direct suggestion so the student thinks it through.
// (The web/mobile clients render `suggestion` inside a collapsed disclosure
// for guidedDiscovery === true.)
function applyPedagogicalMode(errors, cefrLevel) {
  const guidedDiscovery = !["A1", "A2"].includes(cefrLevel);
  return errors.map((e) => ({
    ...e,
    guidedDiscovery,
    conceptCheckQuestion: guidedDiscovery
      ? `Look at "${e.quote}" again - what needs to change here?`
      : null,
  }));
}

// ---------------------------------------------------------------------------
// ACP BRIDGE — call the Python ACP engine for turn processing
// Falls back to the local cloud-API path if ACP is unreachable.
// ---------------------------------------------------------------------------

async function processTurnViaACP({ sessionId, turnIndex, transcript, cefrLevel, history }) {
  const url = `${config.acpBaseUrl}/api/v1/bridge/turn-text`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: transcript,
      cefr_level: cefrLevel,
      topic: "",
      feedback_style: "auto",
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`ACP bridge error ${response.status}: ${err.detail || "unknown"}`);
  }
  const data = await response.json();

  // Persist the exchange to the local DB so the rest of the app still works
  await pool.query(
    `INSERT INTO exchanges (session_id, turn_index, student_text, ai_reply, errors)
     VALUES (?, ?, ?, ?, ?)`,
    [sessionId, turnIndex, transcript, data.replyText, JSON.stringify(data.errors || [])]
  );

  return {
    replyText: data.replyText,
    audioBase64: data.audioBase64 || null,
    errors: data.errors || [],
  };
}

async function processTurnViaACP_Audio({ sessionId, turnIndex, audioBuffer, mimeType, cefrLevel }) {
  const url = `${config.acpBaseUrl}/api/v1/bridge/turn-audio`;
  const formData = new FormData();
  const blob = new Blob([audioBuffer], { type: mimeType });
  formData.append("audio", blob, "turn.webm");
  formData.append("cefr_level", cefrLevel);

  const response = await fetch(url, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`ACP bridge error ${response.status}: ${err.detail || "unknown"}`);
  }
  const data = await response.json();

  await pool.query(
    `INSERT INTO exchanges (session_id, turn_index, student_text, ai_reply, errors)
     VALUES (?, ?, ?, ?, ?)`,
    [sessionId, turnIndex, data.transcript, data.replyText, JSON.stringify(data.errors || [])]
  );

  return {
    transcript: data.transcript,
    replyText: data.replyText,
    audioBase64: data.audioBase64 || null,
    errors: data.errors || [],
  };
}

// ---------------------------------------------------------------------------
// LOCAL CLOUD PATH — original implementation using llmRouter + audio
// ---------------------------------------------------------------------------

async function processTurnLocal({ sessionId, turnIndex, transcript, cefrLevel, history }) {
  const [replySettled, assessmentSettled] = await Promise.allSettled([
    generateConversationalReply({ transcript, cefrLevel, history }),
    analyzeGrammar({ transcript, cefrLevel }),
  ]);

  if (replySettled.status !== "fulfilled") {
    throw replySettled.reason;
  }
  const replyText = replySettled.value;

  const audioBuffer = await synthesize(replyText);

  let errors = [];
  if (assessmentSettled.status === "fulfilled") {
    const guarded = applyVerbatimGuardrail(transcript, assessmentSettled.value.errors);
    errors = applyPedagogicalMode(guarded, cefrLevel);
  } else {
    console.warn("Grammar assessment failed for this turn:", assessmentSettled.reason?.message);
  }

  await pool.query(
    `INSERT INTO exchanges (session_id, turn_index, student_text, ai_reply, errors)
     VALUES (?, ?, ?, ?, ?)`,
    [sessionId, turnIndex, transcript, replyText, JSON.stringify(errors)]
  );

  return {
    replyText,
    audioBase64: audioBuffer ? audioBuffer.toString("base64") : null,
    errors,
  };
}

// ---------------------------------------------------------------------------
// PUBLIC API — auto-routes to ACP or local based on config
// ---------------------------------------------------------------------------

export async function processTurn({ sessionId, turnIndex, transcript, cefrLevel, history }) {
  if (config.acpBaseUrl) {
    try {
      return await processTurnViaACP({ sessionId, turnIndex, transcript, cefrLevel, history });
    } catch (err) {
      console.warn(`ACP bridge unavailable (${err.message}), falling back to local cloud path`);
    }
  }
  return processTurnLocal({ sessionId, turnIndex, transcript, cefrLevel, history });
}

export async function processTurnAudio({ sessionId, turnIndex, audioBuffer, mimeType, cefrLevel }) {
  if (config.acpBaseUrl) {
    try {
      return await processTurnViaACP_Audio({ sessionId, turnIndex, audioBuffer, mimeType, cefrLevel });
    } catch (err) {
      console.warn(`ACP bridge unavailable (${err.message}), falling back to local path`);
    }
  }
  // Local fallback: the sessions.js route already called transcribe() before us,
  // so this path won't be reached for audio in normal use — it's a safety net.
  throw new Error("ACP engine is unavailable and no local STT fallback is configured. Please start the ACP server.");
}

// Cohort-aggregated teacher report
export async function buildCohortReport(classroomId, since) {
  const [rows] = await pool.query(
    `SELECT e.errors
       FROM exchanges e
       JOIN practice_sessions ps ON ps.id = e.session_id
       JOIN assignments a ON a.id = ps.assignment_id
      WHERE a.classroom_id = ?
        AND e.created_at >= ?`,
    [classroomId, since]
  );

  const totalTurns = rows.length || 1;
  const counts = Object.fromEntries(ERROR_CATEGORIES.map((c) => [c, 0]));

  for (const row of rows) {
    const errs = Array.isArray(row.errors) ? row.errors : [];
    const seen = new Set(errs.map((e) => e.category));
    for (const category of seen) {
      if (counts[category] !== undefined) counts[category] += 1;
    }
  }

  return ERROR_CATEGORIES.map((category) => ({
    category,
    turnsAffectedPct: Math.round((counts[category] / totalTurns) * 100),
  })).sort((a, b) => b.turnsAffectedPct - a.turnsAffectedPct);
}

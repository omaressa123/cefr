import { pool } from "../db/pool.js";
import { generateConversationalReply, analyzeGrammar } from "./llmRouter.js";
import { synthesize, transcribe } from "./audio.js";
import { ERROR_CATEGORIES } from "./taxonomy.js";

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

// Turn orchestrator: generates conversational reply and grammar assessment
// concurrently, synthesizes TTS audio, applies verbatim guardrails, and persists.
export async function processTurn({ sessionId, turnIndex, transcript, cefrLevel, history }) {
  const [replySettled, assessmentSettled] = await Promise.allSettled([
    generateConversationalReply({ transcript, cefrLevel, history }),
    analyzeGrammar({ transcript, cefrLevel }),
  ]);

  if (replySettled.status !== "fulfilled") {
    throw replySettled.reason;
  }
  const replyText = replySettled.value;

  // TTS is an enhancement, not the assessed loop: if the voice provider is
  // unreachable the turn must still succeed (both clients null-check
  // audioBase64 before playing).
  let audioBuffer = null;
  try {
    audioBuffer = await synthesize(replyText);
  } catch (err) {
    console.warn("TTS synthesis failed for this turn (reply text still returned):", err?.message);
  }

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

// Transcribes audio with the configured STT provider (e.g. local verbatim-Whisper
// or cloud Whisper), then runs turn processing.
export async function processTurnAudio({ sessionId, turnIndex, audioBuffer, mimeType, cefrLevel }) {
  const transcript = await transcribe(audioBuffer, mimeType);
  const result = await processTurn({ sessionId, turnIndex, transcript, cefrLevel, history: [] });
  return { transcript, ...result };
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

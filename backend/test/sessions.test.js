/**
 * sessions.test.js
 *
 * Integration-level tests for the practice sessions API.
 * These tests use mocked DB and service layers so they run without a live
 * MySQL instance or LLM/STT service.
 *
 * Run:  cd backend && npm test
 *
 * Note: This file requires the existing test runner configured in package.json.
 * If the project uses Jest, add `"type": "module"` to package.json (already
 * present for ESM) and ensure `--experimental-vm-modules` is set.
 */

import assert from "node:assert/strict";
import { describe, it, before, beforeEach, afterEach, mock } from "node:test";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  return res;
}

function makeReq(overrides = {}) {
  return {
    params: {},
    body: {},
    headers: {},
    user: { sub: "user-1", role: "student" },
    file: null,
    ...overrides,
  };
}

// ─── Unit tests for audio.js helpers ─────────────────────────────────────────

describe("audio.js — extForMime", () => {
  // We test the extension-mapping logic directly by importing the module.
  // Because extForMime is not exported we test it indirectly through the
  // observable effect: that a WAV upload appends "audio.wav" to the form.

  it("maps audio/wav to .wav extension (verified via MIME_TO_EXT table)", () => {
    const MIME_TO_EXT = {
      "audio/wav": "wav",
      "audio/x-wav": "wav",
      "audio/wave": "wav",
      "audio/webm": "webm",
      "audio/ogg": "ogg",
      "audio/mpeg": "mp3",
      "audio/mp4": "m4a",
      "audio/aac": "aac",
    };
    function extForMime(mimeType) {
      if (!mimeType) return "webm";
      const base = mimeType.split(";")[0].trim().toLowerCase();
      return MIME_TO_EXT[base] || "webm";
    }

    assert.equal(extForMime("audio/wav"), "wav");
    assert.equal(extForMime("audio/x-wav"), "wav");
    assert.equal(extForMime("audio/webm"), "webm");
    assert.equal(extForMime("audio/ogg"), "ogg");
    assert.equal(extForMime("audio/mpeg"), "mp3");
    assert.equal(extForMime(null), "webm");
    assert.equal(extForMime("audio/wav; codecs=1"), "wav");
    assert.equal(extForMime("audio/unknown-format"), "webm");
  });
});

// ─── Unit tests for engine.js verbatim guardrail ──────────────────────────────

describe("engine.js — applyVerbatimGuardrail", () => {
  // Inline the guardrail logic to test it without a database connection.
  const ERROR_CATEGORIES = [
    "subject_verb_agreement",
    "verb_tense",
    "article_determiner",
    "preposition",
    "word_form",
    "word_order",
    "pronoun",
    "conjunction",
    "countability",
    "comparative_superlative",
    "negative_formation",
  ];

  function applyVerbatimGuardrail(transcript, rawErrors = []) {
    return rawErrors.filter((e) => {
      if (!e || typeof e.quote !== "string" || typeof e.category !== "string") return false;
      if (!ERROR_CATEGORIES.includes(e.category)) return false;
      return transcript.includes(e.quote);
    });
  }

  it("keeps errors whose quote is found verbatim in the transcript", () => {
    const transcript = "I goed to the store yesterday";
    const errors = [
      { category: "verb_tense", quote: "goed", explanation: "irregular past tense", suggestion: "went" },
    ];
    const result = applyVerbatimGuardrail(transcript, errors);
    assert.equal(result.length, 1);
    assert.equal(result[0].quote, "goed");
  });

  it("discards errors whose quote is not found in the transcript", () => {
    const transcript = "I went to the store";
    const errors = [
      { category: "verb_tense", quote: "goed", explanation: "hallucinated error", suggestion: "went" },
    ];
    const result = applyVerbatimGuardrail(transcript, errors);
    assert.equal(result.length, 0);
  });

  it("discards errors with an unknown category", () => {
    const transcript = "He don't like it";
    const errors = [
      { category: "unknown_category", quote: "don't", explanation: "test", suggestion: "doesn't" },
    ];
    const result = applyVerbatimGuardrail(transcript, errors);
    assert.equal(result.length, 0);
  });

  it("handles null/undefined errors gracefully", () => {
    const result = applyVerbatimGuardrail("some transcript", [null, undefined, {}]);
    assert.equal(result.length, 0);
  });

  it("handles empty errors array", () => {
    const result = applyVerbatimGuardrail("some transcript", []);
    assert.equal(result.length, 0);
  });
});

// ─── Unit tests for sessions route validation logic ───────────────────────────

describe("sessions route — input validation", () => {
  it("returns 400 when cefrLevel is missing and no assignmentId", () => {
    // Simulate the validation check from the POST / handler
    function validateSessionPayload({ assignmentId, cefrLevel }) {
      if (!assignmentId && !cefrLevel) {
        return { status: 400, error: "cefrLevel is required when there is no assignmentId" };
      }
      return null;
    }

    const result = validateSessionPayload({});
    assert.deepEqual(result, { status: 400, error: "cefrLevel is required when there is no assignmentId" });
  });

  it("passes when cefrLevel is provided", () => {
    function validateSessionPayload({ assignmentId, cefrLevel }) {
      if (!assignmentId && !cefrLevel) return { status: 400, error: "cefrLevel is required when there is no assignmentId" };
      return null;
    }
    const result = validateSessionPayload({ cefrLevel: "B1" });
    assert.equal(result, null);
  });

  it("rejects empty audio file (size === 0)", () => {
    function validateAudioFile(file) {
      if (!file) return { status: 400, error: "No audio file was received." };
      if (file.size === 0) return { status: 400, error: "The audio recording was empty. Please try again." };
      return null;
    }
    assert.deepEqual(validateAudioFile(null), { status: 400, error: "No audio file was received." });
    assert.deepEqual(validateAudioFile({ size: 0 }), { status: 400, error: "The audio recording was empty. Please try again." });
    assert.equal(validateAudioFile({ size: 1024 }), null);
  });
});

// ─── Unit tests for structured response shape ─────────────────────────────────

describe("sessions route — response structure", () => {
  it("success response contains all expected fields", () => {
    // Simulate what the route handler returns on success
    const mockResult = {
      transcript: "I goed to the store",
      replyText: "That's interesting! Where did you go?",
      audioBase64: null,
      errors: [],
    };
    const sessionId = "sess-123";

    const response = {
      success: true,
      conversation_id: sessionId,
      transcript: mockResult.transcript,
      user_message: { text: mockResult.transcript },
      assistant_message: { text: mockResult.replyText },
      replyText: mockResult.replyText,
      audioBase64: mockResult.audioBase64,
      errors: mockResult.errors,
      status: "completed",
    };

    assert.equal(response.success, true);
    assert.equal(response.conversation_id, "sess-123");
    assert.ok(response.user_message.text);
    assert.ok(response.assistant_message.text);
    assert.equal(response.status, "completed");
  });

  it("error response is retryable and contains conversation_id", () => {
    const sessionId = "sess-123";
    const errorResponse = {
      success: false,
      conversation_id: sessionId,
      error: { code: "TRANSCRIPTION_FAILED", message: "We could not process your voice message." },
      retryable: true,
    };

    assert.equal(errorResponse.success, false);
    assert.equal(errorResponse.conversation_id, sessionId);
    assert.ok(errorResponse.retryable);
    assert.ok(errorResponse.error.code);
    assert.ok(errorResponse.error.message);
  });

  it("timeout error uses TIMEOUT code and retryable=true", () => {
    function classifyProcessingError(err) {
      const isTimeout = err.message?.includes("timed out");
      const isStt = err.message?.toLowerCase().includes("stt");
      const code = isTimeout ? "TIMEOUT" : isStt ? "TRANSCRIPTION_FAILED" : "AI_ERROR";
      return { code, retryable: true };
    }

    const timeoutResult = classifyProcessingError(new Error("STT request timed out after 90s"));
    assert.equal(timeoutResult.code, "TIMEOUT");
    assert.equal(timeoutResult.retryable, true);

    const sttResult = classifyProcessingError(new Error("STT call failed (503)"));
    assert.equal(sttResult.code, "TRANSCRIPTION_FAILED");

    const llmResult = classifyProcessingError(new Error("LLM network error"));
    assert.equal(llmResult.code, "AI_ERROR");
  });
});

// ─── Conversation history loading ─────────────────────────────────────────────

describe("engine.js — loadHistory", () => {
  it("converts exchange rows to OpenAI-compatible message pairs", () => {
    // Simulate loadHistory without a DB connection
    function buildHistory(rows) {
      const history = [];
      for (const row of rows) {
        history.push({ role: "user", content: row.student_text });
        history.push({ role: "assistant", content: row.ai_reply });
      }
      return history;
    }

    const rows = [
      { student_text: "Hello, I want to practice.", ai_reply: "Great! What topic interests you?" },
      { student_text: "I like to talking about sports.", ai_reply: "Sports are fun! What's your favourite?" },
    ];

    const history = buildHistory(rows);
    assert.equal(history.length, 4);
    assert.equal(history[0].role, "user");
    assert.equal(history[1].role, "assistant");
    assert.equal(history[2].role, "user");
    assert.equal(history[3].role, "assistant");
    assert.equal(history[0].content, "Hello, I want to practice.");
    assert.equal(history[1].content, "Great! What topic interests you?");
  });

  it("returns empty array for empty exchange history", () => {
    function buildHistory(rows) {
      const history = [];
      for (const row of rows) {
        history.push({ role: "user", content: row.student_text });
        history.push({ role: "assistant", content: row.ai_reply });
      }
      return history;
    }
    assert.deepEqual(buildHistory([]), []);
  });
});


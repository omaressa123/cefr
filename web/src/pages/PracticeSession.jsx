import React, { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import { api } from "../api/client.js";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

// Recording stage labels shown to the user
const STAGE = {
  IDLE: "idle",
  RECORDING: "recording",
  UPLOADING: "uploading",
  TRANSCRIBING: "transcribing",
  GENERATING: "generating",
  DONE: "done",
  ERROR: "error",
};

const STAGE_LABELS = {
  [STAGE.UPLOADING]: "Uploading audio…",
  [STAGE.TRANSCRIBING]: "Transcribing your speech…",
  [STAGE.GENERATING]: "AI is thinking…",
};

export default function PracticeSession() {
  const { assignmentId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [session, setSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [level, setLevel] = useState("B1");
  const [turns, setTurns] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [stage, setStage] = useState(STAGE.IDLE);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [error, setError] = useState(null);
  const [retryBlob, setRetryBlob] = useState(null); // preserve audio for retry
  const [report, setReport] = useState(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioRef = useRef(null);
  const streamRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const turnsEndRef = useRef(null);

  // ─── Session bootstrap ──────────────────────────────────────────────────────
  // Bug 7 fix: persist session ID in ?session= query param so page refresh
  // restores the existing session instead of creating a new one.

  const loadExistingSession = useCallback(async (sid) => {
    try {
      const exchanges = await api.getExchanges(sid);
      // Reconstruct turns array from stored exchanges
      const restored = (exchanges || []).map((ex) => ({
        student: ex.student_text,
        reply: ex.ai_reply,
        errors: Array.isArray(ex.errors) ? ex.errors : [],
        audioBase64: null,
      }));
      setTurns(restored);
      // We don't have the full session object from getExchanges, so store a
      // minimal one. The session ID is what matters for subsequent turns.
      setSession({ id: sid, cefr_level: null }); // level shown only as label
    } catch (err) {
      // Session not found or expired — start fresh
      console.warn("Could not restore session:", err.message);
      setSearchParams({});
      await createNewSession();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const createNewSession = useCallback(async () => {
    setError(null);
    try {
      const payload = assignmentId ? { assignmentId } : { cefrLevel: level };
      const s = await api.startSession(payload);
      setSession(s);
      setTurns([]);
      setReport(null);
      // Persist session ID in URL so refresh restores it
      setSearchParams({ session: s.id });
    } catch (err) {
      setError("Could not start a practice session. " + err.message);
    }
  }, [assignmentId, level, setSearchParams]);

  useEffect(() => {
    const existingSessionId = searchParams.get("session");
    setSessionLoading(true);
    (async () => {
      if (existingSessionId) {
        await loadExistingSession(existingSessionId);
      } else {
        await createNewSession();
      }
      setSessionLoading(false);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom when turns change
  useEffect(() => {
    turnsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  // ─── Turn helpers ───────────────────────────────────────────────────────────

  function appendTurn(result, studentText) {
    setTurns((t) => [
      ...t,
      {
        student: studentText,
        reply: result.replyText ?? result.assistant_message?.text ?? "",
        errors: result.errors ?? [],
        audioBase64: result.audioBase64 ?? null,
      },
    ]);
    const b64 = result.audioBase64;
    if (b64 && audioRef.current) {
      audioRef.current.src = `data:audio/mpeg;base64,${b64}`;
      audioRef.current.play().catch(() => {});
    }
  }

  // ─── Text submission ────────────────────────────────────────────────────────

  async function submitText(e) {
    e.preventDefault();
    if (!text.trim() || !session) return;
    setSending(true);
    setError(null);
    try {
      const result = await api.submitTextTurn(session.id, text);
      appendTurn(result, text);
      setText("");
    } catch (err) {
      // Bug 7 fix: never navigate away on error — show in-place message
      setError("Could not send your message. Your conversation is safe. " + err.message);
    } finally {
      setSending(false);
    }
  }

  // ─── Audio submission (shared by initial send and retry) ───────────────────

  async function sendAudioBlob(blob) {
    if (!session) { setError("No active session."); return; }
    if (!blob || blob.size === 0) { setError("No audio was captured. Please try recording again."); return; }

    setRetryBlob(blob); // preserve in case of failure so user can retry
    setStage(STAGE.UPLOADING);
    setError(null);

    const formData = new FormData();
    formData.append("audio", blob, "turn.webm");

    try {
      setStage(STAGE.TRANSCRIBING);
      const result = await api.submitAudioTurn(session.id, formData);
      const transcript = result.transcript ?? result.user_message?.text ?? "";
      appendTurn(result, transcript);
      setRetryBlob(null); // success — discard saved blob
      setStage(STAGE.DONE);
    } catch (err) {
      // Bug 7 fix: on failure keep turns visible, show retry option, don't navigate
      setError(
        err.message?.includes("timed out")
          ? "The request took too long. Your conversation is safe — you can retry."
          : "We couldn't process your voice message. Your conversation is safe. You can retry."
      );
      setStage(STAGE.ERROR);
      // retryBlob stays set so the "Retry" button can resend the same audio
    }
  }

  // ─── Recording ──────────────────────────────────────────────────────────────

  async function toggleRecording() {
    if (!session) { setError("No active session."); return; }

    if (stage === STAGE.RECORDING) {
      // Stop recording
      mediaRecorderRef.current?.stop();
      clearInterval(recordingTimerRef.current);
      setStage(STAGE.IDLE);
      return;
    }

    // Clear previous error when starting a new recording
    setError(null);
    setRetryBlob(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setRecordingSeconds(0);
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await sendAudioBlob(blob);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecordingSeconds(0);
      setStage(STAGE.RECORDING);

      // Recording duration timer
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } catch {
      setError("Microphone access was denied or is unavailable.");
    }
  }

  async function handleRetry() {
    if (retryBlob) {
      await sendAudioBlob(retryBlob);
    }
  }

  const isProcessing = [STAGE.UPLOADING, STAGE.TRANSCRIBING, STAGE.GENERATING].includes(stage);

  // ─── Render: session loading ────────────────────────────────────────────────

  if (sessionLoading) {
    return (
      <Layout>
        <div className="panel" style={{ maxWidth: 420 }}>
          <p>Starting your practice session…</p>
        </div>
      </Layout>
    );
  }

  // ─── Render: session start failed ──────────────────────────────────────────

  if (!session) {
    return (
      <Layout>
        <h1>{assignmentId ? "Start assignment" : "Free practice"}</h1>
        {error && <div className="error-banner">{error}</div>}
        <div className="panel" style={{ maxWidth: 420 }}>
          {!assignmentId && (
            <div style={{ marginBottom: "1rem" }}>
              <div className="label">CEFR level</div>
              <select value={level} onChange={(e) => setLevel(e.target.value)}>
                {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          )}
          <button onClick={createNewSession}>Begin session</button>
        </div>
      </Layout>
    );
  }

  // ─── Render: active session ─────────────────────────────────────────────────

  return (
    <Layout>
      <div className="label">Practicing at</div>
      <h1>{session.cefr_level || level}</h1>

      {/* Error banner with retry button — never navigates away */}
      {error && (
        <div className="error-banner" style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap" }}>
          <span>{error}</span>
          {retryBlob && (
            <button
              type="button"
              className="secondary"
              onClick={handleRetry}
              disabled={isProcessing}
              style={{ flexShrink: 0 }}
            >
              Retry
            </button>
          )}
        </div>
      )}

      <audio ref={audioRef} style={{ display: "none" }} />

      {/* Conversation turns */}
      <div style={{ marginBottom: "2rem" }}>
        {turns.length === 0 && (
          <div className="panel" style={{ color: "var(--text-muted)" }}>
            Start speaking or type something to begin the conversation.
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className="turn">
            <div className="student">{t.student}</div>
            <div className="partner">{t.reply}</div>
            {t.errors?.length > 0 && (
              <div style={{ marginTop: "0.6rem" }}>
                {t.errors.map((e, j) => (
                  <div key={j} className="error-card">
                    <div className="category">{e.category.replace(/_/g, " ")}</div>
                    <div>"{e.quote}" &mdash; {e.explanation}</div>
                    {e.guidedDiscovery ? (
                      <details className="discovery">
                        <summary>{e.conceptCheckQuestion}</summary>
                        <div style={{ marginTop: "0.4rem" }}>Suggested fix: {e.suggestion}</div>
                      </details>
                    ) : (
                      <div style={{ marginTop: "0.3rem", color: "var(--text-muted)" }}>
                        Suggested fix: {e.suggestion}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={turnsEndRef} />
      </div>

      {/* Processing status indicator */}
      {isProcessing && (
        <div className="panel" style={{ marginBottom: "0.8rem", color: "var(--text-muted)" }}>
          {STAGE_LABELS[stage] || "Processing…"}
        </div>
      )}

      {/* Recording status */}
      {stage === STAGE.RECORDING && (
        <div className="panel" style={{ marginBottom: "0.8rem", display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <span style={{ color: "var(--color-error)", fontWeight: 700 }}>● REC</span>
          <span style={{ color: "var(--text-muted)" }}>
            {Math.floor(recordingSeconds / 60).toString().padStart(2, "0")}:{(recordingSeconds % 60).toString().padStart(2, "0")}
          </span>
          <span style={{ color: "var(--text-muted)", fontSize: "0.85em" }}>Tap Stop when done</span>
        </div>
      )}

      {/* Input row */}
      <form onSubmit={submitText} className="panel" style={{ display: "flex", gap: "0.6rem" }}>
        <input
          placeholder="Type what you'd say…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={sending || isProcessing || stage === STAGE.RECORDING}
        />
        <button type="submit" disabled={sending || isProcessing || stage === STAGE.RECORDING}>
          Send
        </button>
        <button
          type="button"
          className={`secondary ${stage === STAGE.RECORDING ? "recording-active" : ""}`}
          onClick={toggleRecording}
          disabled={sending || isProcessing}
          style={{ minWidth: "80px" }}
        >
          {stage === STAGE.RECORDING ? "⏹ Stop" : "🎙 Speak"}
        </button>
      </form>

      {/* Session report */}
      <div style={{ marginTop: "1rem" }}>
        <button
          type="button"
          className="secondary"
          onClick={async () => {
            setError(null);
            try {
              setReport(await api.getSessionReport(session.id));
            } catch (err) {
              setError(err.message);
            }
          }}
        >
          View session report
        </button>
        {report && (
          <div className="panel" style={{ marginTop: "0.8rem" }}>
            <div className="label">Session report</div>
            <strong>Turns: {report.turns}</strong>
            {Object.entries(report.errorsByCategory ?? {}).map(([cat, n]) => (
              <div key={cat} style={{ color: "var(--text-muted)" }}>
                {cat.replace(/_/g, " ")}: {n}
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

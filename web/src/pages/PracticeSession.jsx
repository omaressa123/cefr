import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import { api } from "../api/client.js";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

export default function PracticeSession() {
  const { assignmentId, mode } = useParams(); // mode === "free" when no assignment
  const [session, setSession] = useState(null);
  const [level, setLevel] = useState("B1");
  const [turns, setTurns] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState(null);
  const [report, setReport] = useState(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioRef = useRef(null);

  async function startSession() {
    setError(null);
    try {
      const payload = assignmentId ? { assignmentId } : { cefrLevel: level };
      const s = await api.startSession(payload);
      setSession(s);
      setTurns([]);
      setReport(null);
    } catch (err) {
      setError(err.message);
    }
  }

  function appendTurn(result, studentText) {
    setTurns((t) => [...t, { student: studentText, reply: result.replyText, errors: result.errors, audioBase64: result.audioBase64 }]);
    if (result.audioBase64 && audioRef.current) {
      audioRef.current.src = `data:audio/mpeg;base64,${result.audioBase64}`;
      audioRef.current.play().catch(() => {});
    }
  }

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
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function toggleRecording() {
    if (!session) return;
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const formData = new FormData();
        formData.append("audio", blob, "turn.webm");
        setSending(true);
        try {
          const result = await api.submitAudioTurn(session.id, formData);
          appendTurn(result, result.transcript);
        } catch (err) {
          setError(err.message);
        } finally {
          setSending(false);
        }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch {
      setError("Microphone access was denied or is unavailable.");
    }
  }

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
          <button onClick={startSession}>Begin session</button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="label">Practicing at</div>
      <h1>{session.cefr_level}</h1>
      {error && <div className="error-banner">{error}</div>}

      <audio ref={audioRef} style={{ display: "none" }} />

      <div style={{ marginBottom: "2rem" }}>
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
      </div>

      <form onSubmit={submitText} className="panel" style={{ display: "flex", gap: "0.6rem" }}>
        <input
          placeholder="Type what you'd say..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={sending}
        />
        <button type="submit" disabled={sending}>Send</button>
        <button type="button" className="secondary" onClick={toggleRecording} disabled={sending}>
          {recording ? "Stop" : "Speak"}
        </button>
      </form>

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

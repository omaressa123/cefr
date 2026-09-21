import React, { useState, useEffect, useCallback, useRef } from "react";
import { View, ScrollView, StyleSheet, Platform } from "react-native";
import { api, ApiError } from "../api/client.js";
import { colors } from "../theme/colors.js";
import { theme } from "../theme/index.js";
import Button from "../components/ui/Button.jsx";
import Card from "../components/ui/Card.jsx";
import Badge from "../components/ui/Badge.jsx";
import Text from "../components/ui/Text.jsx";
import { useWavCapture } from "../stt/captureWav.js";
import { isOfflineSttSupported, transcribeOffline } from "../stt/offlineStt.js";
import {
  enqueueOfflineTurn,
  flushPendingTurns,
  listPendingTurns,
} from "../stt/offlineQueue.js";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

// Stage labels for granular user feedback
const STAGE = {
  IDLE: "idle",
  STARTING: "starting",     // creating the session
  RECORDING: "recording",
  UPLOADING: "uploading",
  TRANSCRIBING: "transcribing",
  GENERATING: "generating",
  ERROR: "error",
};

const STAGE_LABELS = {
  [STAGE.STARTING]: "Starting session…",
  [STAGE.UPLOADING]: "Uploading audio…",
  [STAGE.TRANSCRIBING]: "Transcribing your speech…",
  [STAGE.GENERATING]: "AI is thinking…",
};

export default function PracticeSessionScreen({ route, navigation }) {
  const { assignmentId, cefrLevel: paramLevel } = route?.params || {};

  // Bug 2 fix: session is created on mount via api.startSession()
  const [session, setSession] = useState(null);
  const [level, setLevel] = useState(paramLevel || "B1");
  const [turns, setTurns] = useState([]);
  const [stage, setStage] = useState(STAGE.STARTING);
  const [error, setError] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);

  // Preserve the recorded audio URI so the user can retry on failure
  const retryUriRef = useRef(null);
  const scrollRef = useRef(null);

  const { startCapture, stopCapture } = useWavCapture();

  // ─── Create session on mount ───────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStage(STAGE.STARTING);
      setError(null);
      try {
        const payload = assignmentId ? { assignmentId } : { cefrLevel: level };
        const s = await api.startSession(payload);
        if (!cancelled) {
          setSession(s);
          setStage(STAGE.IDLE);
        }
      } catch (err) {
        if (!cancelled) {
          setError("Could not start the session. Please check your connection and try again.");
          setStage(STAGE.ERROR);
        }
      }

      // Load pending offline count
      try {
        const pending = await listPendingTurns();
        if (!cancelled) setPendingCount(pending.length);
      } catch {
        // Non-critical
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Append a completed turn to the conversation ───────────────────────────
  const appendTurn = useCallback((transcript, replyText, errors = []) => {
    setTurns((prev) => [...prev, { text: transcript, response: replyText, errors, timestamp: Date.now() }]);
    // Scroll to bottom
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  // ─── Submit a WAV/WebM file URI to the backend ─────────────────────────────
  // Bug 1 fix: use session.id (not assignmentId) for the API call.
  const submitAudio = useCallback(async (wavUri, mimeType = "audio/wav") => {
    if (!session) {
      setError("No active session. Please restart the app.");
      return;
    }

    retryUriRef.current = wavUri; // save for retry
    setError(null);
    setStage(STAGE.UPLOADING);

    // Try offline transcription first so the user sees something immediately
    let localTranscript = "";
    if (isOfflineSttSupported()) {
      try {
        setStage(STAGE.TRANSCRIBING);
        localTranscript = await transcribeOffline(wavUri);
        if (__DEV__) console.log("[PracticeSession] offline transcript:", localTranscript);
      } catch (sttErr) {
        if (__DEV__) console.warn("[PracticeSession] offline STT failed, proceeding with server STT:", sttErr.message);
        // Continue — the server will re-transcribe from the audio file
      }
    }

    setStage(STAGE.GENERATING);

    const formData = new FormData();
    // Bug 1 fix: correct field name and MIME type; use session.id not assignmentId
    formData.append("audio", { uri: wavUri, name: `turn.${mimeType === "audio/wav" ? "wav" : "webm"}`, type: mimeType });

    try {
      // Bug 1 fix: session.id instead of assignmentId
      const result = await api.submitAudioTurn(session.id, formData);
      const transcript = result.transcript ?? result.user_message?.text ?? localTranscript ?? "";
      const replyText = result.replyText ?? result.assistant_message?.text ?? "";
      appendTurn(transcript, replyText, result.errors ?? []);
      retryUriRef.current = null; // success — clear retry reference
      setStage(STAGE.IDLE);
    } catch (err) {
      if (__DEV__) console.error("[PracticeSession] submitAudio error:", err);

      if (err instanceof ApiError && (err.isNetworkError || err.isTimeout)) {
        // Queue for offline resubmission
        try {
          await enqueueOfflineTurn({ sessionId: session.id, wavUri, transcript: localTranscript });
          setPendingCount((c) => c + 1);
          setError("No network — your turn has been queued and will be sent when you're back online.");
        } catch (queueErr) {
          setError("Network error. Could not queue your turn. Please try again.");
        }
      } else {
        setError(
          err.message?.includes("timed out")
            ? "The request took too long. Your conversation is safe — tap Retry."
            : "We couldn't process your voice message. Your conversation is safe — tap Retry."
        );
      }
      setStage(STAGE.ERROR);
    }
  }, [session, appendTurn]);

  // ─── Recording controls ────────────────────────────────────────────────────

  async function handleStartRecording() {
    if (!session) { setError("Session is still starting. Please wait."); return; }
    setError(null);
    retryUriRef.current = null;
    try {
      await startCapture();
      setStage(STAGE.RECORDING);
    } catch (err) {
      setError(err.message || "Could not access microphone.");
    }
  }

  async function handleStopRecording() {
    if (stage !== STAGE.RECORDING) return;
    try {
      const { uri } = await stopCapture();
      if (!uri) {
        setError("No audio was captured. Please try recording again.");
        setStage(STAGE.IDLE);
        return;
      }
      await submitAudio(uri, "audio/wav");
    } catch (err) {
      setError("Recording failed: " + err.message);
      setStage(STAGE.IDLE);
    }
  }

  // ─── Retry ────────────────────────────────────────────────────────────────

  async function handleRetry() {
    if (retryUriRef.current) {
      await submitAudio(retryUriRef.current, "audio/wav");
    }
  }

  // ─── Resubmit queued offline turns ────────────────────────────────────────

  async function handleFlushQueue() {
    setError(null);
    try {
      const result = await flushPendingTurns(api, (entry, assessment) => {
        const replyText = assessment.replyText ?? assessment.assistant_message?.text ?? "";
        appendTurn(entry.transcript, replyText, assessment.errors ?? []);
      });
      const remaining = (await listPendingTurns()).length;
      setPendingCount(remaining);
      if (result.failed.length > 0) {
        setError(`${result.failed.length} turn(s) still pending — still offline?`);
      }
    } catch (err) {
      setError("Failed to resubmit queued turns: " + err.message);
    }
  }

  const isProcessing = [STAGE.STARTING, STAGE.UPLOADING, STAGE.TRANSCRIBING, STAGE.GENERATING].includes(stage);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <ScrollView ref={scrollRef} style={styles.container} contentContainerStyle={styles.content}>
      <Text variant="xxl" weight="bold" color="text" style={styles.title}>Practice Session</Text>
      <Badge variant="primary">{session?.cefr_level || level}</Badge>

      {/* Error message with optional retry */}
      {error ? (
        <View style={styles.errorContainer}>
          <Text color="error" style={styles.errorText}>{error}</Text>
          {retryUriRef.current && !isProcessing && (
            <Button
              title="Retry"
              variant="secondary"
              onPress={handleRetry}
              style={styles.retryButton}
            />
          )}
        </View>
      ) : null}

      {/* Processing status */}
      {isProcessing && STAGE_LABELS[stage] ? (
        <Card style={styles.card}>
          <Text color="muted">{STAGE_LABELS[stage]}</Text>
        </Card>
      ) : null}

      {/* Conversation history */}
      {turns.length > 0 ? (
        <View style={styles.turnsContainer}>
          {turns.map((t, i) => (
            <Card key={i} title={`Turn ${i + 1}`} subtitle={t.text} style={styles.card}>
              <Text color="muted">AI: {t.response}</Text>
            </Card>
          ))}
        </View>
      ) : (
        !isProcessing && stage !== STAGE.RECORDING && (
          <Card style={styles.card}>
            <Text color="muted">Tap Start Recording to begin the conversation.</Text>
          </Card>
        )
      )}

      {/* Recording controls */}
      <View style={styles.recordingSection}>
        {stage === STAGE.RECORDING ? (
          <>
            <Card style={[styles.card, styles.recordingIndicator]}>
              <Text color="error" weight="bold">● Recording…</Text>
              <Text color="muted">Tap Stop when you're done speaking.</Text>
            </Card>
            <Button
              title="⏹  Stop Recording"
              onPress={handleStopRecording}
              variant="danger"
              style={styles.recordButton}
            />
          </>
        ) : (
          <Button
            title="🎙  Start Recording"
            onPress={handleStartRecording}
            variant="primary"
            disabled={isProcessing || !session}
            style={styles.recordButton}
          />
        )}
      </View>

      {/* Offline queue */}
      {pendingCount > 0 && (
        <View style={styles.queueSection}>
          <Button
            title={`Submit ${pendingCount} queued turn${pendingCount !== 1 ? "s" : ""}`}
            variant="secondary"
            onPress={handleFlushQueue}
            disabled={isProcessing}
            style={styles.button}
          />
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxxl },
  title: { marginBottom: theme.spacing.sm },
  card: { marginBottom: theme.spacing.md },
  errorContainer: {
    backgroundColor: "rgba(220, 38, 38, 0.1)",
    borderRadius: 8,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  errorText: { color: colors.error },
  retryButton: { marginTop: theme.spacing.sm, alignSelf: "flex-start" },
  recordingSection: { marginVertical: theme.spacing.md },
  recordingIndicator: {
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: "rgba(220, 38, 38, 0.05)",
  },
  recordButton: { marginTop: theme.spacing.sm },
  turnsContainer: { marginTop: theme.spacing.md },
  queueSection: { marginTop: theme.spacing.lg },
  button: { marginBottom: theme.spacing.md },
});

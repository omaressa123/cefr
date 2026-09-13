import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { Audio } from "expo-av";
import { api } from "../api/client.js";
import { colors } from "../theme/colors.js";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

export default function PracticeSessionScreen({ route }) {
  const { assignmentId } = route.params || {};
  const [session, setSession] = useState(null);
  const [level, setLevel] = useState("B1");
  const [turns, setTurns] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(null);
  const [error, setError] = useState(null);
  const [report, setReport] = useState(null);
  const [revealed, setRevealed] = useState({});

  async function startSession() {
    setError(null);
    try {
      const payload = assignmentId ? { assignmentId } : { cefrLevel: level };
      setSession(await api.startSession(payload));
    } catch (err) {
      setError(err.message);
    }
  }

  async function playReplyAudio(base64) {
    try {
      const sound = new Audio.Sound();
      await sound.loadAsync({ uri: `data:audio/mpeg;base64,${base64}` });
      await sound.playAsync();
    } catch {
      // Non-fatal - the transcript/reply text is still shown either way.
    }
  }

  function appendTurn(result, studentText) {
    setTurns((t) => [...t, { student: studentText, reply: result.replyText, errors: result.errors }]);
    if (result.audioBase64) playReplyAudio(result.audioBase64);
  }

  async function submitText() {
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
    if (recording) {
      setSending(true);
      try {
        await recording.stopAndUnloadAsync();
        const uri = recording.getURI();
        const formData = new FormData();
        formData.append("audio", { uri, name: "turn.m4a", type: "audio/m4a" });
        const result = await api.submitAudioTurn(session.id, formData);
        appendTurn(result, result.transcript);
      } catch (err) {
        setError(err.message);
      } finally {
        setRecording(null);
        setSending(false);
      }
      return;
    }
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        setError("Microphone permission was denied.");
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setRecording(rec);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!session) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{assignmentId ? "Start assignment" : "Free practice"}</Text>
        {error && <Text style={styles.error}>{error}</Text>}
        {!assignmentId && (
          <View style={{ marginBottom: 16 }}>
            <Text style={styles.label}>CEFR level</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {LEVELS.map((l) => (
                <TouchableOpacity key={l} onPress={() => setLevel(l)} style={[styles.chip, level === l && styles.chipActive]}>
                  <Text style={{ color: level === l ? colors.bg : colors.text }}>{l}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
        <TouchableOpacity style={styles.button} onPress={startSession}>
          <Text style={styles.buttonText}>Begin session</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.pill}>Practicing at {session.cefr_level}</Text>
      {error && <Text style={styles.error}>{error}</Text>}

      <ScrollView style={{ flex: 1 }}>
        {turns.map((t, i) => (
          <View key={i} style={{ marginBottom: 18 }}>
            <Text style={{ color: colors.text, marginBottom: 4 }}>{t.student}</Text>
            <Text style={{ color: colors.textMuted, borderLeftWidth: 2, borderLeftColor: colors.accentSoft, paddingLeft: 10 }}>
              {t.reply}
            </Text>
            {t.errors?.map((e, j) => {
              const key = `${i}:${j}`;
              const guided = e.guidedDiscovery && !revealed[key];
              return (
                <View key={j} style={styles.errorCard}>
                  <Text style={{ color: colors.highlight, fontSize: 12, marginBottom: 4 }}>
                    {e.category.replace(/_/g, " ")}
                  </Text>
                  <Text style={{ color: colors.text }}>"{e.quote}" — {e.explanation}</Text>
                  {e.guidedDiscovery ? (
                    guided ? (
                      <TouchableOpacity onPress={() => setRevealed((r) => ({ ...r, [key]: true }))}>
                        <Text style={{ color: colors.accentStrong, marginTop: 4 }}>
                          {e.conceptCheckQuestion || "What needs to change here?"} (tap to reveal fix)
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <Text style={{ color: colors.textMuted, marginTop: 4 }}>Suggested fix: {e.suggestion}</Text>
                    )
                  ) : (
                    <Text style={{ color: colors.textMuted, marginTop: 4 }}>Suggested fix: {e.suggestion}</Text>
                  )}
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>

      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="Type what you'd say..."
          placeholderTextColor={colors.textFaint}
          value={text}
          onChangeText={setText}
          editable={!sending}
        />
        <TouchableOpacity style={styles.smallButton} onPress={submitText} disabled={sending}>
          <Text style={styles.buttonText}>Send</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.smallButton, recording && { backgroundColor: colors.error }]} onPress={toggleRecording} disabled={sending}>
          <Text style={styles.buttonText}>{recording ? "Stop" : "Speak"}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.smallButton, { marginTop: 8, alignItems: "center", paddingVertical: 10 }]}
        onPress={async () => {
          try {
            setReport(await api.getSessionReport(session.id));
          } catch (err) {
            setError(err.message);
          }
        }}
      >
        <Text style={styles.buttonText}>View session report</Text>
      </TouchableOpacity>
      {report && (
        <View style={[styles.errorCard, { borderLeftColor: colors.accent, marginTop: 8 }]}>
          <Text style={{ color: colors.text, fontWeight: "700" }}>Turns: {report.turns}</Text>
          {Object.entries(report.errorsByCategory ?? {}).map(([cat, n]) => (
            <Text key={cat} style={{ color: colors.textMuted }}>
              {cat.replace(/_/g, " ")}: {n}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 20, paddingTop: 60 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text, marginBottom: 16 },
  label: { color: colors.textFaint, fontSize: 12, marginBottom: 6 },
  pill: { color: colors.accentStrong, fontSize: 13, marginBottom: 12 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  button: { backgroundColor: colors.accent, borderRadius: 6, padding: 14, alignItems: "center" },
  smallButton: { backgroundColor: colors.accent, borderRadius: 6, paddingHorizontal: 14, justifyContent: "center" },
  buttonText: { color: colors.bg, fontWeight: "700" },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    padding: 10,
    color: colors.text,
  },
  inputRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  errorCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderLeftWidth: 3,
    borderLeftColor: colors.error,
    borderRadius: 6,
    padding: 10,
    marginTop: 8,
  },
  error: {
    color: colors.error,
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 6,
    padding: 10,
    marginBottom: 12,
  },
});

import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Audio } from "expo-av";
import { api } from "../api/client.js";
import { colors } from "../theme/colors.js";

export default function PronunciationLessonScreen({ route }) {
  const { id } = route.params;
  const [item, setItem] = useState(null);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setItem(await api.getPronunciation(id));
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function play(text) {
    try {
      const result = await api.pronunciationAudio(id, text);
      const sound = new Audio.Sound();
      await sound.loadAsync({ uri: `data:audio/mpeg;base64,${result.audioBase64}` });
      await sound.playAsync();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!item) {
    return <View style={styles.container}><Text style={{ color: colors.textMuted }}>{error || "Loading pronunciation lesson..."}</Text></View>;
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.eyebrow}>{item.cefr_level} / {item.sound}</Text>
      <Text style={styles.title}>{item.title}</Text>
      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.panel}>
        <Text style={styles.h2}>How to make the sound</Text>
        <Text style={styles.body}>{item.explanation}</Text>
        <Text style={styles.label}>Mouth position</Text>
        <Text style={styles.body}>{item.mouth_position}</Text>
        <Text style={styles.label}>Tongue position</Text>
        <Text style={styles.body}>{item.tongue_position}</Text>
        <Text style={styles.body}>{item.voiced ? "Voiced sound" : "Unvoiced sound"}</Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.h2}>Practice</Text>
        {(item.exercises ?? []).map((exercise) => (
          <View key={exercise.id} style={styles.exerciseRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.exerciseTarget}>{exercise.target_text}</Text>
              <Text style={styles.exercisePhonetic}>{exercise.phonetic_text}</Text>
            </View>
            <TouchableOpacity style={styles.smallButton} onPress={() => play(exercise.target_text)}>
              <Text style={styles.buttonText}>Listen</Text>
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity
          style={styles.button}
          onPress={async () => { try { await api.completePronunciation(id); setCompleted(true); } catch (err) { setError(err.message); } }}
        >
          <Text style={styles.buttonText}>{completed ? "Completed" : "Mark complete"}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 20, paddingTop: 60 },
  eyebrow: { color: colors.textFaint, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  title: { fontSize: 24, fontWeight: "800", color: colors.text, marginVertical: 8 },
  panel: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: 8, padding: 16, marginBottom: 12 },
  h2: { color: colors.text, fontSize: 17, fontWeight: "700", marginBottom: 8 },
  body: { color: colors.text, fontSize: 14, marginBottom: 6 },
  label: { color: colors.textFaint, fontSize: 12, marginTop: 8, marginBottom: 2 },
  exerciseRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: 6, padding: 10, marginBottom: 8 },
  exerciseTarget: { color: colors.text, fontWeight: "700" },
  exercisePhonetic: { color: colors.textMuted, fontSize: 12 },
  smallButton: { backgroundColor: colors.accent, borderRadius: 6, paddingHorizontal: 14, paddingVertical: 10 },
  button: { backgroundColor: colors.accent, borderRadius: 6, padding: 12, alignItems: "center", marginTop: 8 },
  buttonText: { color: colors.bg, fontWeight: "700" },
  error: { color: colors.error, borderWidth: 1, borderColor: colors.error, borderRadius: 6, padding: 10, marginBottom: 12 },
});

import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { api } from "../api/client.js";
import { colors } from "../theme/colors.js";

export default function GrammarLessonScreen({ route }) {
  const { id } = route.params;
  const [item, setItem] = useState(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setItem(await api.getGrammar(id));
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!item) {
    return <View style={styles.container}><Text style={{ color: colors.textMuted }}>{error || "Loading lesson..."}</Text></View>;
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.eyebrow}>{item.cefr_level} / {item.category}</Text>
      <Text style={styles.title}>{item.title}</Text>
      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.panel}>
        <Text style={styles.h2}>What is it?</Text>
        <Text style={styles.body}>{item.explanation}</Text>
        {!!item.arabic_explanation && <Text style={styles.arabic}>{item.arabic_explanation}</Text>}
      </View>

      <View style={styles.panel}>
        <Text style={styles.h2}>Examples</Text>
        {(item.examples ?? []).map((example) => (
          <Text key={example} style={styles.example}>"{example}"</Text>
        ))}
      </View>

      <View style={styles.panel}>
        <Text style={styles.h2}>Common mistakes</Text>
        {(item.common_mistakes ?? []).map((mistake) => (
          <Text key={mistake} style={styles.body}>{mistake}</Text>
        ))}
      </View>

      <View style={styles.panel}>
        <Text style={styles.label}>Lesson status</Text>
        <Text style={styles.status}>{item.progress_status === "completed" || done ? "Completed" : "Not started"}</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={async () => { try { await api.completeGrammar(id, 100); setDone(true); } catch (err) { setError(err.message); } }}
        >
          <Text style={styles.buttonText}>{done ? "Completed" : "Mark complete"}</Text>
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
  arabic: { color: colors.highlight, fontSize: 14, marginTop: 6 },
  example: { color: colors.textMuted, fontStyle: "italic", marginBottom: 6 },
  label: { color: colors.textFaint, fontSize: 12, marginBottom: 4 },
  status: { color: colors.text, fontWeight: "700", fontSize: 16, marginBottom: 10 },
  button: { backgroundColor: colors.accent, borderRadius: 6, padding: 12, alignItems: "center" },
  buttonText: { color: colors.bg, fontWeight: "700" },
  error: { color: colors.error, borderWidth: 1, borderColor: colors.error, borderRadius: 6, padding: 10, marginBottom: 12 },
});

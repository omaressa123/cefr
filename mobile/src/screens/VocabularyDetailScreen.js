import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { api } from "../api/client.js";
import { colors } from "../theme/colors.js";

export default function VocabularyDetailScreen({ route }) {
  const { id } = route.params;
  const [item, setItem] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setItem(await api.getVocabulary(id));
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function action(fn, text) {
    try {
      await fn();
      setMessage(text);
      setItem((prev) => prev && ({
        ...prev,
        progress_status: text === "Marked as learned" ? "learned" : prev.progress_status,
        favorite_id: text === "Removed from favorites" ? null : prev.favorite_id || true,
      }));
    } catch (err) {
      setError(err.message);
    }
  }

  if (error && !item) {
    return <View style={styles.container}><Text style={styles.error}>{error}</Text></View>;
  }
  if (!item) {
    return <View style={styles.container}><Text style={{ color: colors.textMuted }}>Loading vocabulary...</Text></View>;
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.eyebrow}>{item.cefr_level} / {item.category?.name}</Text>
      <Text style={styles.title}>{item.word}</Text>
      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.panel}>
        <Text style={styles.pronunciation}>{item.pronunciation || "Pronunciation not available"}</Text>
        <Text style={styles.body}>{item.definition}</Text>
        {!!item.arabic_translation && <Text style={styles.translation}>{item.arabic_translation}</Text>}
        {!!item.example_sentence && <Text style={styles.example}>"{item.example_sentence}"</Text>}
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.button} onPress={() => action(() => api.learnVocabulary(id), "Marked as learned")}>
            <Text style={styles.buttonText}>Mark learned</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => action(() => api.favoriteVocabulary(id, !item.favorite_id), item.favorite_id ? "Removed from favorites" : "Added to favorites")}>
            <Text style={styles.secondaryText}>{item.favorite_id ? "Unfavorite" : "Favorite"}</Text>
          </TouchableOpacity>
        </View>
        {message && <Text style={styles.success}>{message}</Text>}
      </View>

      <View style={styles.panel}>
        <Text style={styles.label}>Word family</Text>
        <Text style={styles.body}>{item.word_family?.join(", ") || "-"}</Text>
        <Text style={styles.label}>Synonyms</Text>
        <Text style={styles.body}>{item.synonyms?.join(", ") || "-"}</Text>
        <Text style={styles.label}>Common mistake</Text>
        <Text style={styles.body}>{item.common_mistakes || "No note yet."}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 20, paddingTop: 60 },
  eyebrow: { color: colors.textFaint, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  title: { fontSize: 28, fontWeight: "800", color: colors.text, marginVertical: 8 },
  panel: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: 8, padding: 16, marginBottom: 12 },
  pronunciation: { color: colors.accentStrong, fontSize: 15, marginBottom: 8 },
  body: { color: colors.text, fontSize: 14, marginBottom: 8 },
  translation: { color: colors.highlight, fontSize: 15, marginBottom: 8 },
  example: { color: colors.textMuted, fontStyle: "italic", marginBottom: 12 },
  label: { color: colors.textFaint, fontSize: 12, marginTop: 8, marginBottom: 2 },
  buttonRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  button: { backgroundColor: colors.accent, borderRadius: 6, padding: 12, alignItems: "center", flex: 1 },
  buttonText: { color: colors.bg, fontWeight: "700" },
  secondaryButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 6, padding: 12, alignItems: "center", flex: 1 },
  secondaryText: { color: colors.text, fontWeight: "600" },
  success: { color: colors.success, marginTop: 10 },
  error: { color: colors.error, borderWidth: 1, borderColor: colors.error, borderRadius: 6, padding: 10, marginBottom: 12 },
});

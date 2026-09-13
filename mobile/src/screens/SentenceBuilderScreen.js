import React, { useCallback, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { api } from "../api/client.js";
import { colors } from "../theme/colors.js";

export default function SentenceBuilderScreen() {
  const [topics, setTopics] = useState([]);
  const [topic, setTopic] = useState(null);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setTopics(await api.listSentenceTopics());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function open(id) {
    try {
      setError(null);
      setTopic(await api.getSentenceTopic(id));
      setResult(null);
      setAnswer("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function submit(exercise) {
    try {
      setError(null);
      setResult(await api.answerSentenceExercise(topic.id, exercise.id, answer));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.eyebrow}>Sentence builder</Text>
      <Text style={styles.title}>Make the structure yours.</Text>
      {error && <Text style={styles.error}>{error}</Text>}

      {!topic ? (
        topics.map((item) => (
          <TouchableOpacity key={item.id} style={styles.card} onPress={() => open(item.id)}>
            <Text style={styles.pill}>{item.cefr_level}</Text>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardDesc} numberOfLines={2}>{item.explanation}</Text>
            <Text style={styles.rowMeta}>Start →</Text>
          </TouchableOpacity>
        ))
      ) : (
        <>
          <TouchableOpacity onPress={() => setTopic(null)}>
            <Text style={styles.link}>← All structures</Text>
          </TouchableOpacity>
          <Text style={styles.eyebrow}>{topic.cefr_level}</Text>
          <Text style={styles.h2}>{topic.title}</Text>
          <Text style={styles.body}>{topic.explanation}</Text>
          {(topic.exercises ?? []).map((exercise) => (
            <View key={exercise.id} style={styles.panel}>
              <Text style={styles.label}>{(exercise.exercise_type || "").replaceAll("_", " ")}</Text>
              <Text style={styles.h3}>{exercise.prompt}</Text>
              {(exercise.options ?? []).map((option) => (
                <TouchableOpacity key={option} style={styles.optionButton} onPress={() => setAnswer(option)}>
                  <Text style={styles.optionText}>{option}</Text>
                </TouchableOpacity>
              ))}
              <TextInput
                style={styles.input}
                value={answer}
                onChangeText={setAnswer}
                placeholder="Your answer"
                placeholderTextColor={colors.textFaint}
              />
              <TouchableOpacity style={styles.button} onPress={() => submit(exercise)}>
                <Text style={styles.buttonText}>Check answer</Text>
              </TouchableOpacity>
              {result && (
                <Text style={result.correct ? styles.success : styles.error}>
                  {result.correct ? "Correct." : `Try again. Correct answer: ${result.correctAnswer}`} {result.explanation}
                </Text>
              )}
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 20, paddingTop: 60 },
  eyebrow: { color: colors.textFaint, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  title: { fontSize: 24, fontWeight: "800", color: colors.text, marginVertical: 8 },
  link: { color: colors.accentStrong, marginBottom: 10 },
  h2: { color: colors.text, fontSize: 20, fontWeight: "700", marginBottom: 6 },
  h3: { color: colors.text, fontSize: 16, fontWeight: "600", marginBottom: 8 },
  body: { color: colors.text, fontSize: 14, marginBottom: 10 },
  label: { color: colors.textFaint, fontSize: 12, marginBottom: 4 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft, borderLeftWidth: 3, borderLeftColor: colors.accent, borderRadius: 6, padding: 14, marginBottom: 10 },
  pill: { color: colors.accentStrong, fontSize: 12 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "700", marginVertical: 2 },
  cardDesc: { color: colors.textMuted, fontSize: 13 },
  rowMeta: { color: colors.textFaint, fontSize: 12, marginTop: 6 },
  panel: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: 8, padding: 14, marginBottom: 12 },
  optionButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 6, padding: 10, marginBottom: 6 },
  optionText: { color: colors.text },
  input: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 6, padding: 10, color: colors.text, marginVertical: 8 },
  button: { backgroundColor: colors.accent, borderRadius: 6, padding: 12, alignItems: "center" },
  buttonText: { color: colors.bg, fontWeight: "700" },
  success: { color: colors.success, marginTop: 8 },
  error: { color: colors.error, borderWidth: 1, borderColor: colors.error, borderRadius: 6, padding: 10, marginBottom: 12 },
});

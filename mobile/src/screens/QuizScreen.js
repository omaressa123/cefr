import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { api } from "../api/client.js";
import { colors } from "../theme/colors.js";

const SKILLS = ["vocabulary", "grammar", "pronunciation", "sentence_structure", "speaking"];
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

export default function QuizScreen() {
  const [skill, setSkill] = useState("vocabulary");
  const [level, setLevel] = useState("A1");
  const [quiz, setQuiz] = useState(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState(null);
  const [score, setScore] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    try {
      setLoading(true);
      setError("");
      setQuiz(null);
      setScore(null);
      setResult(null);
      setAnswer("");
      setIndex(0);
      const response = await api.startQuiz(skill, level);
      const questions = response?.questions ?? response?.data?.questions ?? response?.quiz?.questions ?? [];
      if (!Array.isArray(questions) || questions.length === 0) {
        throw new Error("No quiz questions were returned for this level and skill.");
      }
      setQuiz({ ...response, questions });
    } catch (err) {
      setError(err.message || "Failed to start quiz.");
      setQuiz(null);
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    const question = quiz?.questions?.[index];
    if (!question) {
      setError("The current quiz question could not be found.");
      return;
    }
    if (!answer.trim()) {
      setError("Please provide an answer.");
      return;
    }
    try {
      setLoading(true);
      setError("");
      setResult(await api.answerQuiz(question.id, answer));
    } catch (err) {
      setError(err.message || "Failed to submit answer.");
    } finally {
      setLoading(false);
    }
  }

  async function next() {
    if (!quiz?.questions?.length) {
      setError("Quiz questions are unavailable.");
      return;
    }
    if (index + 1 >= quiz.questions.length) {
      try {
        setLoading(true);
        setError("");
        const questionIds = quiz.questions.map((q) => q?.id).filter(Boolean);
        if (!questionIds.length) throw new Error("No valid quiz question IDs found.");
        setScore(await api.finishQuiz(questionIds));
      } catch (err) {
        setError(err.message || "Failed to finish quiz.");
      } finally {
        setLoading(false);
      }
      return;
    }
    setIndex((i) => i + 1);
    setAnswer("");
    setResult(null);
    setError("");
  }

  function reset() {
    setQuiz(null);
    setScore(null);
    setIndex(0);
    setAnswer("");
    setResult(null);
    setError("");
  }

  const currentQuestion = quiz?.questions?.[index];

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.eyebrow}>Practice quiz</Text>
      <Text style={styles.title}>Test, learn, repeat.</Text>
      {!!error && <Text style={styles.error}>{error}</Text>}

      {!quiz ? (
        <View style={styles.panel}>
          <Text style={styles.label}>Skill</Text>
          <View style={styles.chipRow}>
            {SKILLS.map((s) => (
              <TouchableOpacity key={s} onPress={() => setSkill(s)} style={[styles.chip, skill === s && styles.chipActive]}>
                <Text style={{ color: skill === s ? colors.bg : colors.text, fontSize: 12 }}>{s.replace("_", " ")}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.label}>Level</Text>
          <View style={styles.chipRow}>
            {LEVELS.map((l) => (
              <TouchableOpacity key={l} onPress={() => setLevel(l)} style={[styles.chip, level === l && styles.chipActive]}>
                <Text style={{ color: level === l ? colors.bg : colors.text }}>{l}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.button} onPress={start} disabled={loading}>
            <Text style={styles.buttonText}>{loading ? "Starting..." : "Start quiz"}</Text>
          </TouchableOpacity>
        </View>
      ) : score ? (
        <View style={styles.panel}>
          <Text style={styles.label}>Quiz complete</Text>
          <Text style={styles.scoreMark}>{score.score ?? 0}%</Text>
          <Text style={styles.body}>{score.correct ?? 0} correct out of {score.attempts ?? quiz.questions.length} answers.</Text>
          <TouchableOpacity style={styles.button} onPress={reset}>
            <Text style={styles.buttonText}>New quiz</Text>
          </TouchableOpacity>
        </View>
      ) : !currentQuestion ? (
        <View style={styles.panel}>
          <Text style={styles.error}>The current question is unavailable.</Text>
          <TouchableOpacity style={styles.button} onPress={reset}>
            <Text style={styles.buttonText}>Restart quiz</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.panel}>
          <Text style={styles.label}>Question {index + 1} of {quiz.questions.length}</Text>
          <Text style={styles.h2}>{currentQuestion.prompt ?? currentQuestion.question ?? currentQuestion.text ?? "Question unavailable"}</Text>
          {Array.isArray(currentQuestion.options) && currentQuestion.options.map((option) => (
            <TouchableOpacity key={option} style={styles.optionButton} onPress={() => setAnswer(option)} disabled={loading || !!result}>
              <Text style={styles.optionText}>{option}</Text>
            </TouchableOpacity>
          ))}
          <TextInput
            style={styles.input}
            value={answer}
            onChangeText={setAnswer}
            placeholder="Your answer"
            placeholderTextColor={colors.textFaint}
            editable={!loading && !result}
          />
          {!result ? (
            <TouchableOpacity style={styles.button} onPress={submit} disabled={loading || !answer.trim()}>
              <Text style={styles.buttonText}>{loading ? "Checking..." : "Check answer"}</Text>
            </TouchableOpacity>
          ) : (
            <>
              <Text style={result.correct ? styles.success : styles.error}>
                {result.correct ? "Correct." : `Correct answer: ${result.correctAnswer ?? "Not available"}`} {result.explanation ?? ""}
              </Text>
              <TouchableOpacity style={styles.button} onPress={next} disabled={loading}>
                <Text style={styles.buttonText}>{loading ? "Processing..." : index + 1 === quiz.questions.length ? "Finish" : "Next"}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 20, paddingTop: 60 },
  eyebrow: { color: colors.textFaint, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  title: { fontSize: 24, fontWeight: "800", color: colors.text, marginVertical: 8 },
  panel: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: 8, padding: 16, marginBottom: 12 },
  label: { color: colors.textFaint, fontSize: 12, marginTop: 8, marginBottom: 6 },
  h2: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: 10 },
  body: { color: colors.text, fontSize: 14, marginBottom: 10 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  optionButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 6, padding: 10, marginBottom: 6 },
  optionText: { color: colors.text },
  input: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 6, padding: 10, color: colors.text, marginVertical: 8 },
  button: { backgroundColor: colors.accent, borderRadius: 6, padding: 12, alignItems: "center", marginTop: 8 },
  buttonText: { color: colors.bg, fontWeight: "700" },
  scoreMark: { fontSize: 40, fontWeight: "800", color: colors.accentStrong, marginVertical: 8 },
  success: { color: colors.success, marginTop: 8 },
  error: { color: colors.error, borderWidth: 1, borderColor: colors.error, borderRadius: 6, padding: 10, marginBottom: 12 },
});

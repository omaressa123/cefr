import React, { useState } from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { api } from "../api/client.js";
import { colors } from "../theme/colors.js";
import { theme } from "../theme/index.js";
import Button from "../components/ui/Button.jsx";
import Card from "../components/ui/Card.jsx";
import Badge from "../components/ui/Badge.jsx";
import Text from "../components/ui/Text.jsx";

export default function QuizScreen() {
  const [quiz, setQuiz] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);

  return (
    <ScrollView style={styles.container}>
      <Text variant="xxl" weight="bold" color="text" style={styles.title}>Quiz</Text>
      {finished ? (
        <Card title="Quiz Complete" subtitle={`Score: ${score}`} variant="accent">
          <Button title="Try Again" onPress={() => { setFinished(false); setScore(0); }} />
        </Card>
      ) : (
        <Card title="Question" subtitle={quiz?.questions?.[currentQuestion]?.question || "Loading..."} style={styles.card}>
          <Badge variant="primary">{currentQuestion + 1}</Badge>
        </Card>
      )}
      <Button title={finished ? "Back to Dashboard" : "Next Question"} onPress={() => {}} style={styles.button} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: theme.spacing.lg },
  title: { marginBottom: theme.spacing.lg },
  card: { marginBottom: theme.spacing.md },
  button: { marginTop: theme.spacing.md },
});

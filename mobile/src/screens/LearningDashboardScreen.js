import React, { useCallback, useState } from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { api } from "../api/client.js";
import { colors } from "../theme/colors.js";
import { theme } from "../theme/index.js";
import Button from "../components/ui/Button.jsx";
import Card from "../components/ui/Card.jsx";
import Badge from "../components/ui/Badge.jsx";
import Text from "../components/ui/Text.jsx";

const levelNames = { A1: "Beginner", A2: "Elementary", B1: "Intermediate", B2: "Upper-intermediate", C1: "Advanced", C2: "Proficient" };

const cards = [
  ["Vocabulary", "Vocabulary", "Browse words, save favorites, and review weak spots."],
  ["Grammar roadmap", "Grammar", "Move from sentence foundations to advanced structures."],
  ["Pronunciation lab", "PronunciationLab", "Listen, repeat, and work through difficult sounds."],
  ["Sentence builder", "Sentences", "Build accurate sentences one structure at a time."],
  ["Quiz", "Quiz", "Check your understanding across the four skills."],
  ["Progress", "Progress", "See your skill progress and recommended next steps."],
];

export default function LearningDashboardScreen({ navigation }) {
  const [progress, setProgress] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [p, r] = await Promise.all([api.getProgress(), api.getRecommendations()]);
      setProgress(Array.isArray(p) ? p[0] : p);
      setRecommendations(r);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const currentLevel = progress?.currentLevel || "A1";

  return (
    <ScrollView style={styles.container}>
      <Text variant="xl" weight="bold" color="text" style={styles.eyebrow}>CEFR learning system</Text>
      <Text variant="xxl" weight="bold" color="text" style={styles.title}>Build your English, level by level.</Text>
      {error && <Text color="error">{error}</Text>}

      <View style={styles.hero}>
        <Text color="muted" size="sm">Current level</Text>
        <View style={styles.levelRow}>
          <Text variant="xxl" weight="bold" color="accent" style={styles.levelMark}>{currentLevel}</Text>
          <Badge variant="highlight">{levelNames[currentLevel]}</Badge>
        </View>
        <Text color="muted" size="sm" style={{ marginTop: theme.spacing.sm }}>Overall progress</Text>
        <Text variant="xxl" weight="bold" color="text">{progress?.overall ?? 0}%</Text>
      </View>

      {cards.map(([title, route, description]) => (
        <Card key={route} title={title} subtitle={description} style={styles.card} onPress={() => navigation.navigate(route)}>
          <Badge variant="primary">{route}</Badge>
        </Card>
      ))}

      <View style={styles.section}>
        <Text variant="semibold" color="muted" style={styles.sectionTitle}>Recommended for you</Text>
        <Button title="View progress" variant="ghost" size="sm" onPress={() => navigation.navigate("Progress")} />
      </View>
      {recommendations.map((item) => (
        <Card key={`${item.skill}-${item.title}`} title={item.title} subtitle={item.reason} style={styles.recCard} onPress={() => navigation.navigate(item.route || "Learn")}>
          <Badge variant="muted">{item.skill}</Badge>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: theme.spacing.lg },
  eyebrow: { marginBottom: theme.spacing.xs, marginTop: theme.spacing.md },
  title: { marginBottom: theme.spacing.xl },
  hero: { backgroundColor: colors.surfaceRaised, borderRadius: theme.borderRadius.lg, padding: theme.spacing.lg, marginBottom: theme.spacing.xl, borderWidth: 1, borderColor: colors.border },
  levelRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  levelMark: { fontSize: theme.fontSize.xxl },
  card: { marginBottom: theme.spacing.sm },
  section: { marginTop: theme.spacing.xl, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { fontSize: theme.fontSize.md },
  recCard: { marginBottom: theme.spacing.sm },
});

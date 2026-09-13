import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { api } from "../api/client.js";
import { colors } from "../theme/colors.js";

const levelNames = { A1: "Beginner", A2: "Elementary", B1: "Intermediate", B2: "Upper-intermediate", C1: "Advanced", C2: "Proficient" };

// Backend recommendation contentPath (web route) -> mobile navigator route.
const CONTENT_ROUTES = {
  "/learning/vocabulary": "Vocabulary",
  "/learning/grammar": "Grammar",
  "/learning/pronunciation": "PronunciationLab",
  "/learning/sentences": "Sentences",
  "/practice/free": "Practice",
  "/learning": "Learn",
};

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
      // Web normalises getProgress to an array; unwrap the same way here.
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
      <Text style={styles.eyebrow}>CEFR learning system</Text>
      <Text style={styles.title}>Build your English, level by level.</Text>
      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.hero}>
        <Text style={styles.label}>Current level</Text>
        <Text style={styles.levelMark}>{currentLevel}</Text>
        <Text style={styles.pill}>{levelNames[currentLevel]}</Text>
        <Text style={[styles.label, { marginTop: 12 }]}>Overall progress</Text>
        <Text style={styles.overall}>{progress?.overall ?? 0}%</Text>
      </View>

      {cards.map(([title, route, description]) => (
        <TouchableOpacity key={route} style={styles.card} onPress={() => navigation.navigate(route)}>
          <Text style={styles.label}>Open module</Text>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardDesc}>{description}</Text>
        </TouchableOpacity>
      ))}

      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>Recommended for you</Text>
        <TouchableOpacity onPress={() => navigation.navigate("Progress")}>
          <Text style={styles.link}>View progress</Text>
        </TouchableOpacity>
      </View>
      {recommendations.map((item) => (
        <TouchableOpacity
          key={`${item.skill}-${item.title}`}
          style={styles.recRow}
          onPress={() => navigation.navigate(CONTENT_ROUTES[item.contentPath] ?? "Learn")}
        >
          <Text style={styles.recNumber}>{item.priority}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.recTitle}>{item.title}</Text>
            <Text style={styles.recReason}>{item.reason}</Text>
          </View>
          <Text style={styles.link}>→</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 20, paddingTop: 60 },
  eyebrow: { color: colors.textFaint, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  title: { fontSize: 26, fontWeight: "800", color: colors.text, marginVertical: 8 },
  label: { color: colors.textFaint, fontSize: 12 },
  hero: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: 8, padding: 16, marginVertical: 12 },
  levelMark: { fontSize: 34, fontWeight: "800", color: colors.accentStrong },
  pill: { color: colors.accentStrong, fontSize: 13, marginTop: 2 },
  overall: { fontSize: 22, fontWeight: "700", color: colors.text },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft, borderLeftWidth: 3, borderLeftColor: colors.accent, borderRadius: 6, padding: 14, marginBottom: 10 },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: "700", marginVertical: 2 },
  cardDesc: { color: colors.textMuted, fontSize: 13 },
  sectionTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  sectionHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 18, marginBottom: 8 },
  link: { color: colors.accentStrong, fontSize: 14, fontWeight: "600" },
  recRow: { flexDirection: "row", gap: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: 6, padding: 12, marginBottom: 8, alignItems: "center" },
  recNumber: { fontSize: 18, fontWeight: "800", color: colors.highlight, width: 24 },
  recTitle: { color: colors.text, fontWeight: "600" },
  recReason: { color: colors.textMuted, fontSize: 12 },
  error: { color: colors.error, borderWidth: 1, borderColor: colors.error, borderRadius: 6, padding: 10, marginBottom: 12 },
});

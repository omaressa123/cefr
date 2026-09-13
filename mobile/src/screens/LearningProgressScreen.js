import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { api } from "../api/client.js";
import { colors } from "../theme/colors.js";

export default function LearningProgressScreen() {
  const [data, setData] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [p, r] = await Promise.all([api.getProgress(), api.getRecommendations()]);
      // Web normalises getProgress to an array; unwrap the same way here.
      setData(Array.isArray(p) ? p[0] : p);
      setRecommendations(r);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  if (!data) {
    return <View style={styles.container}><Text style={{ color: colors.textMuted }}>{error || "Loading progress..."}</Text></View>;
  }

  const rows = Object.entries(data.progress ?? {}).filter(([key]) => key !== "quiz");

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.eyebrow}>Your progress</Text>
      <Text style={styles.title}>Keep the whole picture in view.</Text>
      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.summary}>
        <Text style={styles.scoreMark}>{data.overall}%</Text>
        <View>
          <Text style={styles.label}>Current level</Text>
          <Text style={styles.h2}>{data.currentLevel}</Text>
          <Text style={styles.body}>Target: {data.targetLevel}</Text>
        </View>
      </View>

      {rows.map(([key, item]) => (
        <View key={key} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{key.replaceAll("_", " ")}</Text>
            <Text style={styles.rowSub}>{item.completed} of {item.total} complete</Text>
          </View>
          <Text style={styles.rowPct}>{item.percent}%</Text>
        </View>
      ))}

      <Text style={styles.sectionTitle}>Next steps</Text>
      {recommendations.map((item) => (
        <View key={item.title} style={styles.recRow}>
          <Text style={styles.recNumber}>{item.priority}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.recTitle}>{item.title}</Text>
            <Text style={styles.recReason}>{item.reason}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 20, paddingTop: 60 },
  eyebrow: { color: colors.textFaint, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  title: { fontSize: 24, fontWeight: "800", color: colors.text, marginVertical: 8 },
  label: { color: colors.textFaint, fontSize: 12 },
  summary: { flexDirection: "row", gap: 20, alignItems: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: 8, padding: 16, marginBottom: 12 },
  scoreMark: { fontSize: 40, fontWeight: "800", color: colors.accentStrong },
  h2: { color: colors.text, fontSize: 20, fontWeight: "700" },
  body: { color: colors.textMuted, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: 6, padding: 12, marginBottom: 8 },
  rowTitle: { color: colors.text, fontWeight: "700", textTransform: "capitalize" },
  rowSub: { color: colors.textMuted, fontSize: 12 },
  rowPct: { color: colors.text, fontWeight: "700", fontSize: 16 },
  sectionTitle: { fontSize: 17, fontWeight: "700", color: colors.text, marginTop: 18, marginBottom: 8 },
  recRow: { flexDirection: "row", gap: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: 6, padding: 12, marginBottom: 8, alignItems: "center" },
  recNumber: { fontSize: 18, fontWeight: "800", color: colors.highlight, width: 24 },
  recTitle: { color: colors.text, fontWeight: "600" },
  recReason: { color: colors.textMuted, fontSize: 12 },
  error: { color: colors.error, borderWidth: 1, borderColor: colors.error, borderRadius: 6, padding: 10, marginBottom: 12 },
});

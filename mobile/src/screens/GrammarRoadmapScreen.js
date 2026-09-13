import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, FlatList, StyleSheet } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { api } from "../api/client.js";
import { colors } from "../theme/colors.js";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

export default function GrammarRoadmapScreen({ navigation }) {
  const [level, setLevel] = useState("");
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setItems(await api.listGrammar(level || undefined));
    } catch (err) {
      setError(err.message);
    }
  }, [level]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>Grammar roadmap</Text>
      <Text style={styles.title}>From foundations to nuance.</Text>
      {error && <Text style={styles.error}>{error}</Text>}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        <TouchableOpacity onPress={() => setLevel("")} style={[styles.chip, !level && styles.chipActive]}>
          <Text style={{ color: !level ? colors.bg : colors.text }}>All</Text>
        </TouchableOpacity>
        {LEVELS.map((l) => (
          <TouchableOpacity key={l} onPress={() => setLevel(l)} style={[styles.chip, level === l && styles.chipActive]}>
            <Text style={{ color: level === l ? colors.bg : colors.text }}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => navigation.navigate("GrammarLesson", { id: item.id })}>
            <Text style={styles.pill}>{item.cefr_level}</Text>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardDesc} numberOfLines={2}>{item.explanation}</Text>
            <Text style={styles.rowMeta}>{item.progress_status === "completed" ? "Complete" : "Open lesson"}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={{ color: colors.textMuted }}>No grammar topics found.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 20, paddingTop: 60 },
  eyebrow: { color: colors.textFaint, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  title: { fontSize: 24, fontWeight: "800", color: colors.text, marginVertical: 8 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft, borderLeftWidth: 3, borderLeftColor: colors.accent, borderRadius: 6, padding: 14, marginBottom: 10 },
  pill: { color: colors.accentStrong, fontSize: 12 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "700", marginVertical: 2 },
  cardDesc: { color: colors.textMuted, fontSize: 13 },
  rowMeta: { color: colors.textFaint, fontSize: 12, marginTop: 6 },
  error: { color: colors.error, borderWidth: 1, borderColor: colors.error, borderRadius: 6, padding: 10, marginBottom: 12 },
});

import React, { useCallback, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { api } from "../api/client.js";
import { colors } from "../theme/colors.js";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

export default function VocabularyScreen({ navigation }) {
  const [level, setLevel] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const params = {};
      if (level) params.level = level;
      if (search.trim()) params.search = search.trim();
      const data = await api.listVocabulary(params);
      setItems(data.items ?? []);
    } catch (err) {
      setError(err.message);
    }
  }, [level, search]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>Vocabulary</Text>
      <Text style={styles.title}>Words that stick.</Text>
      {error && <Text style={styles.error}>{error}</Text>}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        <TouchableOpacity onPress={() => setLevel("")} style={[styles.chip, !level && styles.chipActive]}>
          <Text style={{ color: !level ? colors.bg : colors.text }}>All</Text>
        </TouchableOpacity>
        {LEVELS.map((l) => (
          <TouchableOpacity key={l} onPress={() => setLevel(l)} style={[styles.chip, level === l && styles.chipActive]}>
            <Text style={{ color: level === l ? colors.bg : colors.text }}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.row}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="Search words or definitions..."
          placeholderTextColor={colors.textFaint}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={load}
        />
        <TouchableOpacity style={styles.smallButton} onPress={load}>
          <Text style={styles.buttonText}>Search</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        style={{ marginTop: 12 }}
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => navigation.navigate("VocabularyDetail", { id: item.id })}>
            <Text style={styles.pill}>{item.cefr_level} / {item.category?.name ?? item.category_slug}</Text>
            <Text style={styles.cardTitle}>{item.word}</Text>
            <Text style={styles.cardDesc} numberOfLines={2}>{item.definition}</Text>
            <Text style={styles.status}>{item.progress_status === "learned" ? "Learned" : "Learn"}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={{ color: colors.textMuted }}>No words found.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 20, paddingTop: 60 },
  eyebrow: { color: colors.textFaint, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  title: { fontSize: 24, fontWeight: "800", color: colors.text, marginVertical: 8 },
  row: { flexDirection: "row", gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 6, padding: 10, color: colors.text },
  smallButton: { backgroundColor: colors.accent, borderRadius: 6, paddingHorizontal: 16, justifyContent: "center" },
  buttonText: { color: colors.bg, fontWeight: "700" },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft, borderLeftWidth: 3, borderLeftColor: colors.accent, borderRadius: 6, padding: 14, marginBottom: 10 },
  pill: { color: colors.accentStrong, fontSize: 12 },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: "700", marginVertical: 2 },
  cardDesc: { color: colors.textMuted, fontSize: 13 },
  status: { color: colors.accentStrong, fontSize: 12, marginTop: 4, fontWeight: "600" },
  error: { color: colors.error, borderWidth: 1, borderColor: colors.error, borderRadius: 6, padding: 10, marginBottom: 12 },
});

import React, { useCallback, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { api, getStoredUser } from "../api/client.js";
import { colors } from "../theme/colors.js";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

export default function ClassroomScreen({ route, navigation }) {
  const { id } = route.params;
  const [user, setUser] = useState(null);
  const [classroom, setClassroom] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [report, setReport] = useState(null);
  const [level, setLevel] = useState("B1");
  const [topic, setTopic] = useState("");
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    const u = await getStoredUser();
    setUser(u);
    try {
      const [c, a] = await Promise.all([api.getClassroom(id), api.listAssignments(id)]);
      setClassroom(c);
      setAssignments(a);
      if (u?.role === "teacher") setReport(await api.getCohortReport(id));
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  async function createAssignment() {
    try {
      await api.createAssignment(id, { cefrLevel: level, targetTopic: topic });
      setTopic("");
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!classroom) {
    return (
      <View style={styles.container}>
        <Text style={{ color: colors.textMuted }}>{error || "Loading..."}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{classroom.name}</Text>
      {user?.role === "teacher" && <Text style={styles.pill}>Join code: {classroom.join_code}</Text>}
      {error && <Text style={styles.error}>{error}</Text>}

      {user?.role === "teacher" && (
        <View style={styles.newAssignment}>
          <Text style={styles.label}>CEFR level</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {LEVELS.map((l) => (
              <TouchableOpacity
                key={l}
                onPress={() => setLevel(l)}
                style={[styles.chip, level === l && styles.chipActive]}
              >
                <Text style={{ color: level === l ? colors.bg : colors.text }}>{l}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder="Target topic"
            placeholderTextColor={colors.textFaint}
            value={topic}
            onChangeText={setTopic}
          />
          <TouchableOpacity style={styles.button} onPress={createAssignment}>
            <Text style={styles.buttonText}>Create assignment</Text>
          </TouchableOpacity>
        </View>
      )}

      <Text style={styles.sectionTitle}>Assignments</Text>
      <FlatList
        data={assignments}
        keyExtractor={(a) => a.id}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.pill}>{item.cefr_level}</Text>
            <Text style={styles.cardTitle}>{item.target_topic}</Text>
            {user?.role === "student" && (
              <TouchableOpacity
                style={[styles.button, { marginTop: 8 }]}
                onPress={() => navigation.navigate("Practice", { assignmentId: item.id })}
              >
                <Text style={styles.buttonText}>Start</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        ListEmptyComponent={<Text style={{ color: colors.textMuted }}>No assignments yet.</Text>}
      />

      {user?.role === "teacher" && report && (
        <>
          <Text style={styles.sectionTitle}>Class trends (24h)</Text>
          <View style={[styles.card, { borderLeftColor: colors.highlight }]}>
            {report.breakdown.filter((b) => b.turnsAffectedPct > 0).length === 0 ? (
              <Text style={{ color: colors.textMuted }}>No practice turns recorded yet.</Text>
            ) : (
              report.breakdown
                .filter((b) => b.turnsAffectedPct > 0)
                .map((b) => (
                  <Text key={b.category} style={{ color: colors.text, marginBottom: 4 }}>
                    {b.turnsAffectedPct}% of turns had a {b.category.replace(/_/g, " ")} error
                  </Text>
                ))
            )}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 20, paddingTop: 60 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text, marginBottom: 4 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: colors.text, marginTop: 18, marginBottom: 8 },
  label: { color: colors.textFaint, fontSize: 12, marginBottom: 6 },
  pill: { color: colors.accentStrong, fontSize: 12, marginBottom: 8 },
  newAssignment: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: 6,
    padding: 14,
    marginTop: 8,
  },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    padding: 10,
    color: colors.text,
    marginBottom: 10,
  },
  button: { backgroundColor: colors.accent, borderRadius: 6, padding: 12, alignItems: "center" },
  buttonText: { color: colors.bg, fontWeight: "700" },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    borderRadius: 6,
    padding: 14,
    marginBottom: 10,
  },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
  error: {
    color: colors.error,
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 6,
    padding: 10,
    marginBottom: 12,
  },
});

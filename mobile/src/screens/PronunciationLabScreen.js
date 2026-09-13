import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, FlatList, StyleSheet } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { api } from "../api/client.js";
import { colors } from "../theme/colors.js";

export default function PronunciationLabScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setItems(await api.listPronunciation());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>Pronunciation lab</Text>
      <Text style={styles.title}>Listen closely. Speak clearly.</Text>
      <Text style={styles.note}>Practice and repeat with real audio. No artificial score is shown.</Text>
      {error && <Text style={styles.error}>{error}</Text>}

      <FlatList
        style={{ marginTop: 12 }}
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => navigation.navigate("PronunciationLesson", { id: item.id })}>
            <Text style={styles.pill}>{item.cefr_level}</Text>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardDesc} numberOfLines={2}>{item.explanation}</Text>
            <Text style={styles.rowMeta}>{item.sound}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={{ color: colors.textMuted }}>No pronunciation lessons found.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 20, paddingTop: 60 },
  eyebrow: { color: colors.textFaint, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  title: { fontSize: 24, fontWeight: "800", color: colors.text, marginVertical: 8 },
  note: { color: colors.textMuted, fontSize: 13, marginBottom: 4 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft, borderLeftWidth: 3, borderLeftColor: colors.accent, borderRadius: 6, padding: 14, marginBottom: 10 },
  pill: { color: colors.accentStrong, fontSize: 12 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "700", marginVertical: 2 },
  cardDesc: { color: colors.textMuted, fontSize: 13 },
  rowMeta: { color: colors.textFaint, fontSize: 12, marginTop: 6 },
  error: { color: colors.error, borderWidth: 1, borderColor: colors.error, borderRadius: 6, padding: 10, marginBottom: 12 },
});

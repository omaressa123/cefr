import React, { useState } from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from "react-native";
import { colors } from "../theme/colors.js";
import { theme } from "../theme/index.js";
import Card from "../components/ui/Card.jsx";
import Badge from "../components/ui/Badge.jsx";
import Button from "../components/ui/Button.jsx";

const PRACTICE_MODULES = [
  { title: "Vocabulary Drill", subtitle: "Review and learn new words", icon: "📖", level: "A2-B2" },
  { title: "Grammar Practice", subtitle: "Master sentence structures", icon: "📝", level: "A1-C1" },
  { title: "Pronunciation Lab", subtitle: "Practice sounds and stress", icon: "🎤", level: "A1-C2" },
  { title: "Sentence Builder", subtitle: "Construct accurate sentences", icon: "🔤", level: "A2-B2" },
  { title: "Conversation Practice", subtitle: "Real dialogue simulation", icon: "💬", level: "B1-C2" },
  { title: "Quick Quiz", subtitle: "Test your knowledge", icon: "⚡", level: "A1-C2" },
];

export default function PracticeScreen() {
  const [activeFilter, setActiveFilter] = useState("All");

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Practice</Text>
      <Text style={styles.subtitle}>Choose a skill to sharpen</Text>

      <FlatList
        data={PRACTICE_MODULES}
        keyExtractor={(item) => item.title}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Card title={item.title} subtitle={item.subtitle} style={styles.card} variant="default">
            <View style={styles.cardFooter}>
              <Text style={styles.cardIcon}>{item.icon}</Text>
              <Badge variant="primary">{item.level}</Badge>
            </View>
          </Card>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: theme.spacing.lg },
  title: { color: colors.text, fontSize: theme.fontSize.xxl, fontWeight: theme.fontWeight.bold, marginBottom: theme.spacing.xs },
  subtitle: { color: colors.textMuted, fontSize: theme.fontSize.md, marginBottom: theme.spacing.lg },
  list: { paddingBottom: theme.spacing.xxxl },
  card: { marginBottom: theme.spacing.md },
  cardFooter: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  cardIcon: { fontSize: theme.fontSize.xl },
});

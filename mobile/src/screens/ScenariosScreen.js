import React from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { colors } from "../theme/colors.js";
import { theme } from "../theme/index.js";
import Button from "../components/ui/Button.jsx";
import Card from "../components/ui/Card.jsx";
import Badge from "../components/ui/Badge.jsx";
import Text from "../components/ui/Text.jsx";

const scenarios = [
  { title: "Introduction", desc: "Welcome to LingoLove", icon: "👋" },
  { title: "Ordering Coffee", desc: "Practice café conversations", icon: "☕" },
  { title: "Asking Directions", desc: "Navigate the city", icon: "🗺️" },
  { title: "Job Interview", desc: "Prepare for your interview", icon: "💼" },
];

export default function ScenariosScreen() {
  return (
    <ScrollView style={styles.container}>
      <Text variant="xxl" weight="bold" color="text" style={styles.title}>Scenarios</Text>
      <Text color="muted" style={styles.subtitle}>Practice real-world conversations</Text>
      {scenarios.map((s) => (
        <Card key={s.title} title={`${s.icon} ${s.title}`} subtitle={s.desc} style={styles.card}>
          <Badge variant="highlight">{s.title}</Badge>
        </Card>
      ))}
      <Button title="Start Scenario" onPress={() => {}} style={styles.button} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: theme.spacing.lg },
  title: { marginBottom: theme.spacing.xs },
  subtitle: { marginBottom: theme.spacing.lg },
  card: { marginBottom: theme.spacing.sm },
  button: { marginTop: theme.spacing.md },
});

import React from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { colors } from "../theme/colors.js";
import { theme } from "../theme/index.js";
import Button from "../components/ui/Button.jsx";
import Card from "../components/ui/Card.jsx";
import Badge from "../components/ui/Badge.jsx";
import Text from "../components/ui/Text.jsx";

export default function Screen() {
  return (
    <ScrollView style={styles.container}>
      <Text variant="xxl" weight="bold" color="text" style={styles.title}>Screen</Text>
      <Card title="Module" subtitle="Loading content" style={styles.card}>
        <Badge variant="primary">In Progress</Badge>
      </Card>
      <Button title="Continue" onPress={() => {}} style={styles.button} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: theme.spacing.lg },
  title: { marginBottom: theme.spacing.lg },
  card: { marginBottom: theme.spacing.md },
  button: { marginTop: theme.spacing.md },
});

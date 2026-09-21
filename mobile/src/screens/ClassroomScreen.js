import React, { useState } from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { api } from "../api/client.js";
import { colors } from "../theme/colors.js";
import { theme } from "../theme/index.js";
import Button from "../components/ui/Button.jsx";
import Card from "../components/ui/Card.jsx";
import Badge from "../components/ui/Badge.jsx";
import Text from "../components/ui/Text.jsx";

export default function ClassroomScreen({ route, navigation }) {
  const { id } = route.params || {};
  const [classroom, setClassroom] = useState(null);
  const [assignments, setAssignments] = useState([]);

  return (
    <ScrollView style={styles.container}>
      <Text variant="xxl" weight="bold" color="text" style={styles.title}>Classroom</Text>
      <Card title="Classroom" subtitle={classroom?.name} style={styles.card}>
        <Badge variant="primary">{classroom?.role || "Student"}</Badge>
      </Card>
      <Text variant="lg" weight="semibold" color="text" style={styles.sectionTitle}>Assignments</Text>
      {assignments.map((a) => (
        <Card key={a.id} title={a.title} subtitle={a.description} style={styles.card} onPress={() => navigation.navigate("Practice", { assignmentId: a.id })}>
          <Badge variant="muted">{a.status}</Badge>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: theme.spacing.lg },
  title: { marginBottom: theme.spacing.lg },
  card: { marginBottom: theme.spacing.sm },
  sectionTitle: { marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm },
});

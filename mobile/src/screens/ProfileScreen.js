import React from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { colors } from "../theme/colors.js";
import { theme } from "../theme/index.js";
import Button from "../components/ui/Button.jsx";
import Card from "../components/ui/Card.jsx";
import Badge from "../components/ui/Badge.jsx";
import Text from "../components/ui/Text.jsx";
import { useAuth } from "../hooks/useAuth.js";

export default function ProfileScreen({ navigation }) {
  const { user, logout } = useAuth();

  return (
    <ScrollView style={styles.container}>
      <Text variant="xxl" weight="bold" color="text" style={styles.title}>Profile</Text>
      <Card title="Account" subtitle={user?.displayName || "User"} style={styles.card}>
        <Badge variant="primary">{user?.role || "Student"}</Badge>
      </Card>
      <Card title="Settings" subtitle="Manage your preferences" style={styles.card}>
        <Text color="muted">Level, notifications, and more</Text>
      </Card>
      <Button title="Sign Out" variant="danger" onPress={logout} style={styles.button} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: theme.spacing.lg },
  title: { marginBottom: theme.spacing.lg },
  card: { marginBottom: theme.spacing.md },
  button: { marginTop: theme.spacing.md },
});

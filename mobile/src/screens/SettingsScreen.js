import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Switch, TouchableOpacity } from "react-native";
import { colors } from "../theme/colors.js";
import { theme } from "../theme/index.js";
import Button from "../components/ui/Button.jsx";
import Card from "../components/ui/Card.jsx";

export default function SettingsScreen() {
  const [notifications, setNotifications] = useState(true);
  const [darkMode, setDarkMode] = useState(true);
  const [offlineMode, setOfflineMode] = useState(false);
  const [voiceFeedback, setVoiceFeedback] = useState(true);

  const sections = [
    {
      title: "General",
      items: [
        { label: "Dark Mode", value: darkMode, onChange: setDarkMode },
        { label: "Notifications", value: notifications, onChange: setNotifications },
        { label: "Voice Feedback", value: voiceFeedback, onChange: setVoiceFeedback },
      ],
    },
    {
      title: "Learning",
      items: [
        { label: "Offline Mode", value: offlineMode, onChange: setOfflineMode },
        { label: "Auto-Save Progress", value: true, onChange: () => {} },
        { label: "Daily Reminder", value: false, onChange: () => {} },
      ],
    },
    {
      title: "Privacy",
      items: [
        { label: "Profile Visibility", value: true, onChange: () => {} },
        { label: "Data Collection", value: false, onChange: () => {} },
      ],
    },
  ];

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>Customize your learning experience</Text>

        {sections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.items.map((item) => (
              <Card key={item.label} title={item.label} style={styles.card}>
                <Switch
                  value={item.value}
                  onValueChange={item.onChange}
                  trackColor={{ false: colors.border, true: colors.accent }}
                  thumbColor={colors.surface}
                />
              </Card>
            ))}
          </View>
        ))}

        <View style={{ marginTop: theme.spacing.xl }}>
          <Button title="Clear Cache" variant="secondary" onPress={() => {}} style={styles.button} />
          <Button title="Log Out" variant="outline" onPress={() => {}} style={[styles.button, { marginTop: theme.spacing.md }]} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: theme.spacing.lg },
  title: { color: colors.text, fontSize: theme.fontSize.xxl, fontWeight: theme.fontWeight.bold, marginBottom: theme.spacing.xs },
  subtitle: { color: colors.textMuted, fontSize: theme.fontSize.md, marginBottom: theme.spacing.lg },
  section: { marginBottom: theme.spacing.xl },
  sectionTitle: { color: colors.textMuted, fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.medium, marginBottom: theme.spacing.md },
  card: { marginBottom: theme.spacing.sm, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  button: { marginBottom: theme.spacing.sm },
});

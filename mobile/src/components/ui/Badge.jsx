import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { theme } from "../../theme/index.js";
import { colors } from "../../theme/colors.js";

const colorMap = {
  primary: { bg: colors.accentSoft, text: colors.accent },
  success: { bg: "#1A2E1F", text: colors.success },
  error: { bg: "#2E1A1F", text: colors.error },
  highlight: { bg: "#2E281A", text: colors.highlight },
  muted: { bg: colors.surfaceRaised, text: colors.textMuted },
};

export default function Badge({ children, variant = "primary", style }) {
  const c = colorMap[variant] || colorMap.primary;
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }, style]}>
      <Text style={[styles.text, { color: c.text }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
    alignSelf: "flex-start",
  },
  text: { fontSize: theme.fontSize.xs, fontWeight: theme.fontWeight.medium },
});

import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { theme } from "../../theme/index.js";
import { colors } from "../../theme/colors.js";

export default function Card({ title, subtitle, onPress, style, variant = "default", icon }) {
  const variants = {
    default: { bg: colors.surface, border: colors.border },
    elevated: { bg: colors.surfaceRaised, border: colors.border },
    accent: { bg: colors.accentSoft, border: colors.accent },
  };
  const v = variants[variant] || variants.default;

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: v.bg, borderColor: v.border }, style]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {icon && <Text style={styles.icon}>{icon}</Text>}
      {(title || subtitle) && (
        <View style={styles.content}>
          {title && <Text style={styles.title}>{title}</Text>}
          {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    ...theme.shadow.sm,
  },
  icon: { fontSize: theme.fontSize.xxl, marginRight: theme.spacing.sm },
  content: { flex: 1 },
  title: { color: colors.text, fontSize: theme.fontSize.md, fontWeight: theme.fontWeight.semibold },
  subtitle: { color: colors.textMuted, fontSize: theme.fontSize.sm, marginTop: 2 },
});

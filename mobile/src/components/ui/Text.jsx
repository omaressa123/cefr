import React from "react";
import { Text, StyleSheet } from "react-native";
import { theme } from "../../theme/index.js";
import { colors } from "../../theme/colors.js";

export default function Text({ children, style, variant = "body", size = "md", color = "text" }) {
  const colorMap = {
    text: colors.text,
    muted: colors.textMuted,
    faint: colors.textFaint,
    accent: colors.accent,
    highlight: colors.highlight,
    success: colors.success,
    error: colors.error,
  };

  const sizeMap = {
    xs: theme.fontSize.xs,
    sm: theme.fontSize.sm,
    md: theme.fontSize.md,
    lg: theme.fontSize.lg,
    xl: theme.fontSize.xl,
    xxl: theme.fontSize.xxl,
    xxxl: theme.fontSize.xxxl,
  };

  const weightMap = {
    body: theme.fontWeight.regular,
    medium: theme.fontWeight.medium,
    semibold: theme.fontWeight.semibold,
    bold: theme.fontWeight.bold,
  };

  return (
    <Text style={[styles.text, { color: colorMap[color] || colors.text, fontSize: sizeMap[size] || sizeMap.md, fontWeight: weightMap[variant] || weightMap.body }]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({ text: {} });

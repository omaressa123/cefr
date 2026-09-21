import React from "react";
import { TouchableOpacity, Text, StyleSheet } from "react-native";
import { theme } from "../../theme/index.js";
import { colors } from "../../theme/colors.js";

export default function Button({
  title,
  onPress,
  variant = "primary",
  size = "md",
  disabled = false,
  style,
}) {
  const variants = {
    primary: { bg: colors.accent, text: "#FFFFFF" },
    secondary: { bg: colors.surfaceRaised, text: colors.text },
    outline: { bg: "transparent", text: colors.accent, border: colors.accent },
    danger: { bg: colors.error, text: "#FFFFFF" },
    ghost: { bg: "transparent", text: colors.textMuted },
  };
  const sizes = {
    sm: { paddingV: 6, paddingH: 12, fontSize: theme.fontSize.sm },
    md: { paddingV: 10, paddingH: 20, fontSize: theme.fontSize.md },
    lg: { paddingV: 14, paddingH: 28, fontSize: theme.fontSize.lg },
  };
  const v = variants[variant] || variants.primary;
  const s = sizes[size] || sizes.md;

  return (
    <TouchableOpacity
      style={[
        styles.button,
        {
          backgroundColor: v.bg,
          paddingVertical: s.paddingV,
          paddingHorizontal: s.paddingH,
          borderRadius: theme.borderRadius.md,
          borderWidth: v.border ? 1 : 0,
          borderColor: v.border,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
    >
      <Text style={[styles.text, { color: v.text, fontSize: s.fontSize, fontWeight: theme.fontWeight.medium }]}>
        {title}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: "center", justifyContent: "center" },
  text: { fontWeight: "600" },
});

import React from "react";
import { View, TextInput, Text, StyleSheet } from "react-native";
import { theme } from "../../theme/index.js";
import { colors } from "../../theme/colors.js";

export default function Input({ label, value, onChangeText, placeholder, secureTextEntry, error, style }) {
  return (
    <View style={[styles.container, style]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        style={[styles.input, error && styles.inputError]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        secureTextEntry={secureTextEntry}
      />
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: theme.spacing.md },
  label: { color: colors.textMuted, fontSize: theme.fontSize.sm, marginBottom: theme.spacing.xs },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    color: colors.text,
    fontSize: theme.fontSize.md,
  },
  inputError: { borderColor: colors.error },
  errorText: { color: colors.error, fontSize: theme.fontSize.sm, marginTop: 2 },
});

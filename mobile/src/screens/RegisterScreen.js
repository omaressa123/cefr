import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { api, setToken, setStoredUser } from "../api/client.js";
import { colors } from "../theme/colors.js";

export default function RegisterScreen({ navigation }) {
  const [form, setForm] = useState({ username: "", password: "", displayName: "", role: "student" });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleRegister() {
    setError(null);
    setLoading(true);
    try {
      const { token, user } = await api.register(form);
      await setToken(token);
      await setStoredUser(user);
      navigation.reset({ index: 0, routes: [{ name: "Dashboard" }] });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create an account</Text>
      {error && <Text style={styles.error}>{error}</Text>}

      <Text style={styles.label}>Display name</Text>
      <TextInput style={styles.input} value={form.displayName} onChangeText={(v) => update("displayName", v)} />

      <Text style={styles.label}>Username</Text>
      <TextInput style={styles.input} value={form.username} onChangeText={(v) => update("username", v)} autoCapitalize="none" />

      <Text style={styles.label}>Password</Text>
      <TextInput style={styles.input} value={form.password} onChangeText={(v) => update("password", v)} secureTextEntry />

      <Text style={styles.label}>Role</Text>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 6 }}>
        {["student", "teacher"].map((r) => (
          <TouchableOpacity
            key={r}
            onPress={() => update("role", r)}
            style={[styles.roleChip, form.role === r && styles.roleChipActive]}
          >
            <Text style={{ color: form.role === r ? colors.bg : colors.text, fontWeight: "600" }}>{r}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.button} onPress={handleRegister} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? "Creating account..." : "Create account"}</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.navigate("Login")}>
        <Text style={styles.link}>Already have an account? Log in</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: "center" },
  title: { fontSize: 28, fontWeight: "700", color: colors.text, marginBottom: 20 },
  label: { color: colors.textFaint, fontSize: 12, marginBottom: 6, marginTop: 14 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    padding: 12,
    color: colors.text,
  },
  roleChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  roleChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 6,
    padding: 14,
    alignItems: "center",
    marginTop: 24,
  },
  buttonText: { color: colors.bg, fontWeight: "700" },
  link: { color: colors.accentStrong, marginTop: 18, textAlign: "center" },
  error: {
    color: colors.error,
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 6,
    padding: 10,
    marginBottom: 12,
  },
});

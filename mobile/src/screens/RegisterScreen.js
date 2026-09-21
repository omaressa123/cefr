import React, { useState } from "react";
import { View, StyleSheet } from "react-native";
import { api, setToken, setStoredUser } from "../api/client.js";
import { colors } from "../theme/colors.js";
import { theme } from "../theme/index.js";
import Input from "../components/ui/Input.jsx";
import Button from "../components/ui/Button.jsx";
import Text from "../components/ui/Text.jsx";

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
      navigation.reset({ index: 0, routes: [{ name: "Main" }] });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text variant="xl" weight="bold" color="text" style={styles.title}>Create an account</Text>
      {error && <Text color="error" style={styles.error}>{error}</Text>}

      <Input label="Display name" value={form.displayName} onChangeText={(v) => update("displayName", v)} style={styles.input} />
      <Input label="Username" value={form.username} onChangeText={(v) => update("username", v)} autoCapitalize="none" style={styles.input} />
      <Input label="Password" value={form.password} onChangeText={(v) => update("password", v)} secureTextEntry style={styles.input} />

      <View style={styles.roleRow}>
        {["student", "teacher"].map((r) => (
          <Button key={r} title={r} variant={form.role === r ? "primary" : "secondary"} size="sm" onPress={() => update("role", r)} style={styles.roleChip} />
        ))}
      </View>

      <Button title={loading ? "Creating account..." : "Create account"} onPress={handleRegister} disabled={loading} style={styles.button} />
      <Button title="Already have an account? Log in" variant="ghost" onPress={() => navigation.navigate("Login")} style={styles.link} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: theme.spacing.xxl, justifyContent: "center" },
  title: { marginBottom: theme.spacing.xl },
  input: { marginBottom: theme.spacing.md },
  roleRow: { flexDirection: "row", gap: theme.spacing.sm, marginBottom: theme.spacing.lg },
  roleChip: { flex: 1 },
  button: { marginTop: theme.spacing.md },
  link: { marginTop: theme.spacing.md },
  error: { marginBottom: theme.spacing.md },
});

import React, { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { api, setToken, setStoredUser } from "../api/client.js";
import { colors } from "../theme/colors.js";
import { theme } from "../theme/index.js";
import Input from "../components/ui/Input.jsx";
import Button from "../components/ui/Button.jsx";

export default function LoginScreen({ navigation }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setError(null);
    setLoading(false);
    try {
      const { token, user } = await api.login({ username, password });
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
      <Text style={styles.title}>Welcome back</Text>
      <Text style={styles.subtitle}>Log in to keep practicing.</Text>
      {error && <Text style={styles.error}>{error}</Text>}

      <Input label="Username" value={username} onChangeText={setUsername} placeholder="Enter username" autoCapitalize="none" style={styles.input} />
      <Input label="Password" value={password} onChangeText={setPassword} placeholder="Enter password" secureTextEntry style={styles.input} />

      <Button title={loading ? "Logging in..." : "Log in"} onPress={handleLogin} disabled={loading} style={styles.button} />

      <TouchableOpacity onPress={() => navigation.navigate("Register")}>
        <Text style={styles.link}>New here? Create an account</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: theme.spacing.xxl, justifyContent: "center" },
  title: { fontSize: theme.fontSize.xxl, fontWeight: theme.fontWeight.bold, color: colors.text, marginBottom: theme.spacing.xs },
  subtitle: { color: colors.textMuted, fontSize: theme.fontSize.md, marginBottom: theme.spacing.xxl },
  input: { marginBottom: theme.spacing.md },
  button: { marginTop: theme.spacing.md },
  link: { color: colors.accentStrong, marginTop: theme.spacing.lg, textAlign: "center", fontSize: theme.fontSize.md },
  error: { color: colors.error, backgroundColor: "#2E1A1F", borderRadius: theme.borderRadius.sm, padding: theme.spacing.md, marginBottom: theme.spacing.md },
});

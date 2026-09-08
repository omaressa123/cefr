import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { api, setToken, setStoredUser } from "../api/client.js";
import { colors } from "../theme/colors.js";

export default function LoginScreen({ navigation }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setError(null);
    setLoading(true);
    try {
      const { token, user } = await api.login({ username, password });
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
      <Text style={styles.title}>Welcome back</Text>
      <Text style={styles.subtitle}>Log in to keep practicing.</Text>
      {error && <Text style={styles.error}>{error}</Text>}

      <Text style={styles.label}>Username</Text>
      <TextInput style={styles.input} value={username} onChangeText={setUsername} autoCapitalize="none" />

      <Text style={styles.label}>Password</Text>
      <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry />

      <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? "Logging in..." : "Log in"}</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.navigate("Register")}>
        <Text style={styles.link}>New here? Create an account</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: "center" },
  title: { fontSize: 28, fontWeight: "700", color: colors.text, marginBottom: 4 },
  subtitle: { color: colors.textMuted, marginBottom: 24 },
  label: { color: colors.textFaint, fontSize: 12, marginBottom: 6, marginTop: 14 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    padding: 12,
    color: colors.text,
  },
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

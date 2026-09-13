import React, { useCallback, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { api, getStoredUser, setToken, setStoredUser } from "../api/client.js";
import { colors } from "../theme/colors.js";

export default function DashboardScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [classrooms, setClassrooms] = useState([]);
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    const u = await getStoredUser();
    setUser(u);
    try {
      setClassrooms(await api.listClassrooms());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  async function createClassroom() {
    try {
      await api.createClassroom(name);
      setName("");
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function joinClassroom() {
    try {
      await api.joinClassroom(joinCode);
      setJoinCode("");
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function logout() {
    await setToken(null);
    await setStoredUser(null);
    navigation.reset({ index: 0, routes: [{ name: "Login" }] });
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{user?.role === "teacher" ? "Your classrooms" : "Your classes"}</Text>
        <TouchableOpacity onPress={logout}><Text style={styles.link}>Log out</Text></TouchableOpacity>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}

      {user?.role === "teacher" ? (
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Classroom name"
            placeholderTextColor={colors.textFaint}
            value={name}
            onChangeText={setName}
          />
          <TouchableOpacity style={styles.smallButton} onPress={createClassroom}>
            <Text style={styles.buttonText}>Create</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Join code"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="characters"
            value={joinCode}
            onChangeText={(v) => setJoinCode(v.toUpperCase())}
          />
          <TouchableOpacity style={styles.smallButton} onPress={joinClassroom}>
            <Text style={styles.buttonText}>Join</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        style={{ marginTop: 18 }}
        data={classrooms}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => navigation.navigate("Classroom", { id: item.id })}>
            <Text style={styles.cardTitle}>{item.name}</Text>
            {user?.role === "teacher" && <Text style={styles.pill}>code: {item.join_code}</Text>}
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={{ color: colors.textMuted }}>Nothing here yet.</Text>}
      />

      {user?.role === "student" && (
        <>
          <TouchableOpacity
            style={styles.button}
            onPress={() => navigation.navigate("Practice", { mode: "free" })}
          >
            <Text style={styles.buttonText}>Start free practice</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={() => navigation.navigate("Learn")}
          >
            <Text style={styles.secondaryButtonText}>Open learning hub</Text>
          </TouchableOpacity>
        </>
      )}
      {user?.role === "teacher" && (
        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={() => navigation.navigate("Learn")}
        >
          <Text style={styles.secondaryButtonText}>Open learning hub</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 20, paddingTop: 60 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title: { fontSize: 24, fontWeight: "700", color: colors.text },
  link: { color: colors.accentStrong },
  row: { flexDirection: "row", gap: 8 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    padding: 10,
    color: colors.text,
  },
  smallButton: { backgroundColor: colors.accent, borderRadius: 6, paddingHorizontal: 16, justifyContent: "center" },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    borderRadius: 6,
    padding: 14,
    marginBottom: 10,
  },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  pill: { color: colors.accentStrong, fontSize: 12, marginTop: 4 },
  button: { backgroundColor: colors.accent, borderRadius: 6, padding: 14, alignItems: "center", marginTop: 16 },
  buttonText: { color: colors.bg, fontWeight: "700" },
  secondaryButton: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.border },
  secondaryButtonText: { color: colors.text, fontWeight: "700" },
  error: {
    color: colors.error,
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 6,
    padding: 10,
    marginBottom: 12,
  },
});

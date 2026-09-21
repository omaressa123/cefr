import React, { useCallback, useState } from "react";
import { View, FlatList, StyleSheet } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { api, getStoredUser, setToken, setStoredUser } from "../api/client.js";
import { colors } from "../theme/colors.js";
import { theme } from "../theme/index.js";
import Input from "../components/ui/Input.jsx";
import Button from "../components/ui/Button.jsx";
import Card from "../components/ui/Card.jsx";
import Badge from "../components/ui/Badge.jsx";
import Text from "../components/ui/Text.jsx";

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

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  async function createClassroom() {
    try { await api.createClassroom(name); setName(""); refresh(); }
    catch (err) { setError(err.message); }
  }

  async function joinClassroom() {
    try { await api.joinClassroom(joinCode); setJoinCode(""); refresh(); }
    catch (err) { setError(err.message); }
  }

  async function logout() {
    await setToken(null);
    await setStoredUser(null);
    navigation.reset({ index: 0, routes: [{ name: "Login" }] });
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text variant="xl" weight="bold" color="text">{user?.role === "teacher" ? "Your classrooms" : "Your classes"}</Text>
        <Button title="Log out" variant="ghost" size="sm" onPress={logout} />
      </View>
      {error && <Badge variant="error" style={{ marginBottom: theme.spacing.md }}>{error}</Badge>}

      {user?.role === "teacher" ? (
        <View style={styles.row}>
          <Input placeholder="Classroom name" value={name} onChangeText={setName} style={{ flex: 1 }} />
          <Button title="Create" size="sm" onPress={createClassroom} />
        </View>
      ) : (
        <View style={styles.row}>
          <Input placeholder="Join code" value={joinCode} onChangeText={(v) => setJoinCode(v.toUpperCase())} autoCapitalize="characters" style={{ flex: 1 }} />
          <Button title="Join" size="sm" onPress={joinClassroom} />
        </View>
      )}

      <FlatList
        style={{ marginTop: theme.spacing.md }}
        data={classrooms}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => (
          <Card title={item.name} subtitle={user?.role === "teacher" ? `Code: ${item.join_code}` : undefined} style={styles.card} onPress={() => navigation.navigate("Classroom", { id: item.id })}>
            {user?.role === "teacher" && <Badge variant="highlight">Teacher</Badge>}
          </Card>
        )}
        ListEmptyComponent={<Text color="muted">Nothing here yet.</Text>}
      />

      {user?.role === "student" && (
        <>
          <Button title="Start free practice" onPress={() => navigation.navigate("Practice", { mode: "free" })} style={styles.button} />
          <Button title="Open learning hub" variant="secondary" onPress={() => navigation.navigate("Learn")} style={[styles.button, { marginTop: theme.spacing.sm }]} />
        </>
      )}
      {user?.role === "teacher" && (
        <Button title="Open learning hub" variant="secondary" onPress={() => navigation.navigate("Learn")} style={[styles.button, { marginTop: theme.spacing.sm }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: theme.spacing.lg, paddingTop: theme.spacing.xl },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing.lg },
  row: { flexDirection: "row", gap: theme.spacing.sm, marginBottom: theme.spacing.md },
  card: { marginBottom: theme.spacing.sm },
  button: { marginTop: theme.spacing.md },
});

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { getToken } from "../api/client.js";
import { colors } from "../theme/colors.js";
import LoginScreen from "../screens/LoginScreen.js";

export default function RequireAuth({ children }) {
  const [token] = React.useState(null);
  const [hasToken, setHasToken] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      const t = await getToken();
      setHasToken(!!t);
    })();
  }, []);

  if (!hasToken) return <LoginScreen />;
  return children;
}

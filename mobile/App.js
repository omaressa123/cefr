import React from "react";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import BottomTabs from "./src/navigation/BottomTabs.jsx";
import LoginScreen from "./src/screens/LoginScreen.js";
import RegisterScreen from "./src/screens/RegisterScreen.js";
import SettingsScreen from "./src/screens/SettingsScreen.js";
import ScenariosScreen from "./src/screens/ScenariosScreen.js";
import { colors } from "./src/theme/colors.js";

const Stack = createNativeStackNavigator();

const navTheme = {
  dark: true,
  colors: {
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    border: colors.borderSoft,
    primary: colors.accent,
  },
};

export default function App() {
  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style="light" />
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Register" component={RegisterScreen} />
        <Stack.Screen name="Main" component={BottomTabs} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Scenarios" component={ScenariosScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

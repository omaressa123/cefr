import React from "react";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import LoginScreen from "./src/screens/LoginScreen.js";
import RegisterScreen from "./src/screens/RegisterScreen.js";
import DashboardScreen from "./src/screens/DashboardScreen.js";
import ClassroomScreen from "./src/screens/ClassroomScreen.js";
import PracticeSessionScreen from "./src/screens/PracticeSessionScreen.js";
import { colors } from "./src/theme/colors.js";

const Stack = createNativeStackNavigator();

const navTheme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
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
        <Stack.Screen name="Dashboard" component={DashboardScreen} />
        <Stack.Screen name="Classroom" component={ClassroomScreen} />
        <Stack.Screen name="Practice" component={PracticeSessionScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

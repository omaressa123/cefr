import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { colors } from "../theme/colors.js";
import { theme } from "../theme/index.js";
import { getStoredUser } from "../api/client.js";
import DashboardScreen from "../screens/DashboardScreen.js";
import LearningDashboardScreen from "../screens/LearningDashboardScreen.js";
import ScenariosScreen from "../screens/ScenariosScreen.js";
import PracticeScreen from "../screens/PracticeScreen.js";
import PhraseBankScreen from "../screens/PhraseBankScreen.js";
import ProfileScreen from "../screens/ProfileScreen.js";

const Tab = createBottomTabNavigator();

function HomeIcon({ focused }) {
  return (
    <View style={[styles.iconContainer, focused && styles.iconActive]}>
      <Text style={[styles.iconText, focused && styles.iconTextActive]}>🏠</Text>
    </View>
  );
}

function LearnIcon({ focused }) {
  return (
    <View style={[styles.iconContainer, focused && styles.iconActive]}>
      <Text style={[styles.iconText, focused && styles.iconTextActive]}>📚</Text>
    </View>
  );
}

function PracticeIcon({ focused }) {
  return (
    <View style={[styles.iconContainer, focused && styles.iconActive]}>
      <Text style={[styles.iconText, focused && styles.iconTextActive]}>⚡</Text>
    </View>
  );
}

function PhrasesIcon({ focused }) {
  return (
    <View style={[styles.iconContainer, focused && styles.iconActive]}>
      <Text style={[styles.iconText, focused && styles.iconTextActive]}">💬</Text>
    </View>
  );
}

function ProfileIcon({ focused }) {
  return (
    <View style={[styles.iconContainer, focused && styles.iconActive]}>
      <Text style={[styles.iconText, focused && styles.iconTextActive]}>👤</Text>
    </View>
  );
}

function ScenariosIcon({ focused }) {
  return (
    <View style={[styles.iconContainer, focused && styles.iconActive]}>
      <Text style={[styles.iconText, focused && styles.iconTextActive]}>🎭</Text>
    </View>
  );
}

export default function BottomTabs({ initialRouteName }) {
  const [user, setUser] = React.useState(null);

  React.useEffect(() => {
    (async () => {
      const u = await getStoredUser();
      setUser(u);
    })();
  }, []);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused }) => {
          const icons = { Dashboard: HomeIcon, Learn: LearnIcon, Practice: PracticeIcon, Scenarios: ScenariosIcon, Phrases: PhrasesIcon, Profile: ProfileIcon };
          const IconComp = icons[route.name] || HomeIcon;
          return <IconComp focused={focused} />;
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Learn" component={LearningDashboardScreen} />
      <Tab.Screen name="Scenarios" component={ScenariosScreen} />
      <Tab.Screen name="Practice" component={PracticeScreen} />
      <Tab.Screen name="Phrases" component={PhraseBankScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingBottom: 8,
    paddingTop: 8,
    height: 64,
  },
  iconContainer: {
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
  },
  iconActive: {
    transform: [{ scale: 1.1 }],
  },
  iconText: { fontSize: 20, color: colors.textFaint },
  iconTextActive: { color: colors.accent },
  tabLabel: { fontSize: 10, fontWeight: "500" },
});

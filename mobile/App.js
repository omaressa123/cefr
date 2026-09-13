import React from "react";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import LoginScreen from "./src/screens/LoginScreen.js";
import RegisterScreen from "./src/screens/RegisterScreen.js";
import DashboardScreen from "./src/screens/DashboardScreen.js";
import ClassroomScreen from "./src/screens/ClassroomScreen.js";
import PracticeSessionScreen from "./src/screens/PracticeSessionScreen.js";
import LearningDashboardScreen from "./src/screens/LearningDashboardScreen.js";
import VocabularyScreen from "./src/screens/VocabularyScreen.js";
import VocabularyDetailScreen from "./src/screens/VocabularyDetailScreen.js";
import GrammarRoadmapScreen from "./src/screens/GrammarRoadmapScreen.js";
import GrammarLessonScreen from "./src/screens/GrammarLessonScreen.js";
import PronunciationLabScreen from "./src/screens/PronunciationLabScreen.js";
import PronunciationLessonScreen from "./src/screens/PronunciationLessonScreen.js";
import SentenceBuilderScreen from "./src/screens/SentenceBuilderScreen.js";
import QuizScreen from "./src/screens/QuizScreen.js";
import LearningProgressScreen from "./src/screens/LearningProgressScreen.js";
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
        <Stack.Screen name="Learn" component={LearningDashboardScreen} />
        <Stack.Screen name="Vocabulary" component={VocabularyScreen} />
        <Stack.Screen name="VocabularyDetail" component={VocabularyDetailScreen} />
        <Stack.Screen name="Grammar" component={GrammarRoadmapScreen} />
        <Stack.Screen name="GrammarLesson" component={GrammarLessonScreen} />
        <Stack.Screen name="PronunciationLab" component={PronunciationLabScreen} />
        <Stack.Screen name="PronunciationLesson" component={PronunciationLessonScreen} />
        <Stack.Screen name="Sentences" component={SentenceBuilderScreen} />
        <Stack.Screen name="Quiz" component={QuizScreen} />
        <Stack.Screen name="Progress" component={LearningProgressScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

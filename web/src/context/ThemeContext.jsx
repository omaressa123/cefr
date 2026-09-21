import React, { createContext, useContext, useEffect, useState } from "react";

export const THEMES = [
  {
    id: "midnight",
    name: "Midnight Purple",
    badge: "Signature",
    color: "#7C5CFC",
    accent: "#4F8CFF",
    bg: "#0B1020",
    description: "Deep space navy with royal purple and celestial blue accents",
  },
  {
    id: "emerald",
    name: "Emerald Forest",
    badge: "Fresh",
    color: "#10B981",
    accent: "#34D399",
    bg: "#06140E",
    description: "Cyber emerald and fresh mint on deep dark obsidian",
  },
  {
    id: "cyberpunk",
    name: "Neon Synthwave",
    badge: "Cyber",
    color: "#EC4899",
    accent: "#06B6D4",
    bg: "#0B0817",
    description: "Vibrant neon pink and electric cyan with high contrast",
  },
  {
    id: "ocean",
    name: "Arctic Ocean",
    badge: "Cool",
    color: "#0284C7",
    accent: "#38BDF8",
    bg: "#07131E",
    description: "Deep oceanic navy with bright glacial cyan accents",
  },
  {
    id: "sunset",
    name: "Sunset Amber",
    badge: "Warm",
    color: "#F97316",
    accent: "#FBBF24",
    bg: "#170E0B",
    description: "Warm glowing amber, terracotta and golden sun rays",
  },
  {
    id: "light",
    name: "Clean Light",
    badge: "Modern",
    color: "#6366F1",
    accent: "#3B82F6",
    bg: "#F1F5F9",
    description: "Crisp white cards, sharp typography and soft borders",
  },
];

const ThemeContext = createContext({
  theme: "midnight",
  setTheme: () => {},
  cycleTheme: () => {},
  currentThemeObj: THEMES[0],
});

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    return localStorage.getItem("cefr_theme") || "midnight";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("cefr_theme", theme);
  }, [theme]);

  function setTheme(newTheme) {
    if (THEMES.some((t) => t.id === newTheme)) {
      setThemeState(newTheme);
    }
  }

  function cycleTheme() {
    const currentIndex = THEMES.findIndex((t) => t.id === theme);
    const nextIndex = (currentIndex + 1) % THEMES.length;
    setThemeState(THEMES[nextIndex].id);
  }

  const currentThemeObj = THEMES.find((t) => t.id === theme) || THEMES[0];

  return (
    <ThemeContext.Provider value={{ theme, setTheme, cycleTheme, currentThemeObj, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}


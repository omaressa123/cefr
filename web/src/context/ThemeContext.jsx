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
  {
    id: "crimson",
    name: "Crimson Ember",
    badge: "Bold",
    color: "#E11D48",
    accent: "#FB7185",
    bg: "#16090C",
    description: "Deep wine black with fiery crimson and soft rose glow",
  },
  {
    id: "gold",
    name: "Royal Gold",
    badge: "Luxury",
    color: "#EAB308",
    accent: "#F59E0B",
    bg: "#12100A",
    description: "Midnight noir with rich golden amber and champagne highlights",
  },
  {
    id: "blossom",
    name: "Blossom Light",
    badge: "Soft",
    color: "#DB2777",
    accent: "#8B5CF6",
    bg: "#FFF5F7",
    description: "Airy blush white with vivid pink and gentle violet touches",
  },
  {
    id: "slate",
    name: "Cloud Slate",
    badge: "Calm",
    color: "#475569",
    accent: "#0EA5E9",
    bg: "#E8EEF4",
    description: "Cool slate gray with sky blue accents on soft cloud gray",
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


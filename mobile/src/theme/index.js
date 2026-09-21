import { colors } from "./colors.js";

export const theme = {
  ...colors,
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
    xxxl: 32,
  },
  borderRadius: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    full: 9999,
  },
  fontSize: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 20,
    xxl: 24,
    xxxl: 32,
  },
  fontWeight: {
    regular: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
  },
  shadow: {
    sm: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 2,
      elevation: 1,
    },
    md: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.12,
      shadowRadius: 4,
      elevation: 2,
    },
    lg: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.16,
      shadowRadius: 8,
      elevation: 4,
    },
  },
};

export function token(colorName) {
  const parts = colorName.split(".");
  let obj = theme;
  for (const p of parts) obj = obj[p];
  return obj;
}

export default theme;

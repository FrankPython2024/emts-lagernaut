import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/portals/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/modules/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#0064d2",
          dark: "#45bdff",
        },
        success: "#00a400",
        danger: "#fa3e3e",
        warning: "#f7b928",
        purple: "#8e44ad",
        card: {
          light: "#ffffff",
          dark: "#242526",
        },
        bg: {
          light: "#f0f2f5",
          dark: "#18191a",
        },
        border: {
          light: "#ced4da",
          dark: "#3e4042",
        },
        "text-dim": {
          light: "#65676b",
          dark: "#b0b3b8",
        },
      },
      fontFamily: {
        ubuntu: ["Ubuntu", "sans-serif"],
      },
      borderRadius: {
        card: "12px",
      },
      boxShadow: {
        card: "0 4px 12px rgba(0,0,0,0.08)",
        modal: "0 20px 40px rgba(0,0,0,0.3)",
      },
    },
  },
  plugins: [],
};

export default config;

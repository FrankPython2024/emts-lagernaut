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
        // AfB Brand Colors
        "afb-navy": {
          DEFAULT: "#202F61",
          dark:    "#1A2550",
          light:   "#2D3D7A",
          dim:     "#3D5285",
        },
        "afb-blue": {
          DEFAULT: "#008BD2",
          dark:    "#0072AC",
          light:   "#1FA5E8",
        },
        "afb-green": {
          DEFAULT: "#04B475",
          dark:    "#038F5C",
          light:   "#1AC98D",
        },
        // Legacy-Tokens (gemapped auf AfB)
        primary: {
          DEFAULT: "#202F61",
          dark:    "#1FA5E8",  // dark-mode primary
        },
        success: "#04B475",
        danger:  "#fa3e3e",
        warning: "#f7b928",
        purple:  "#7c3aed",
        card: {
          light: "#ffffff",
          dark:  "#1F2329",
        },
        bg: {
          light: "#f5f6f8",
          dark:  "#15181E",
        },
        border: {
          light: "#d0d5e0",
          dark:  "#3A3F47",
        },
        "text-dim": {
          light: "#65676b",
          dark:  "#b0b3b8",
        },
      },
      fontFamily: {
        ubuntu: ["Ubuntu", "sans-serif"],
      },
      borderRadius: {
        card: "12px",
      },
      boxShadow: {
        card:  "0 4px 12px rgba(32,47,97,0.08)",
        modal: "0 20px 40px rgba(32,47,97,0.25)",
        "afb": "0 4px 16px rgba(32,47,97,0.12)",
      },
    },
  },
  plugins: [],
};

export default config;

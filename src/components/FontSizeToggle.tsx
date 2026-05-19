"use client";
import { useEffect, useState } from "react";

type FontSize = "small" | "medium" | "large";

const SIZES: { key: FontSize; label: string; px: string }[] = [
  { key: "small",  label: "Klein",  px: "0.75rem" },
  { key: "medium", label: "Normal", px: "1rem"    },
  { key: "large",  label: "Groß",   px: "1.2rem"  },
];

const LS_KEY = "tk_fontsize";

function apply(s: FontSize) {
  document.documentElement.classList.remove("font-small", "font-medium", "font-large");
  document.documentElement.classList.add(`font-${s}`);
  localStorage.setItem(LS_KEY, s);
}

export function FontSizeToggle({ className }: { className?: string }) {
  const [current, setCurrent] = useState<FontSize>("medium");

  useEffect(() => {
    const stored = localStorage.getItem(LS_KEY) as FontSize | null;
    const initial: FontSize = stored && ["small", "medium", "large"].includes(stored)
      ? stored
      : "medium";
    setCurrent(initial);
    apply(initial);
  }, []);

  function setSize(s: FontSize) {
    setCurrent(s);
    apply(s);
  }

  return (
    <div className={`flex gap-0.5 ${className ?? ""}`} role="group" aria-label="Schriftgröße wählen">
      {SIZES.map(({ key, label, px }) => {
        const active = current === key;
        return (
          <button
            key={key}
            onClick={() => setSize(key)}
            aria-label={`Schriftgröße: ${label}`}
            aria-pressed={active}
            className={`flex items-center justify-center w-9 h-9 rounded-lg font-black transition-colors ${
              active
                ? "bg-cyan-50 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 ring-1 ring-cyan-500/20"
                : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
            }`}
            style={{ fontSize: px, minHeight: 36, minWidth: 36 }}
          >
            A
          </button>
        );
      })}
    </div>
  );
}

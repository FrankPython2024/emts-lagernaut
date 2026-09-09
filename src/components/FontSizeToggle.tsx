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
            // ⚠️ 44×44 px sind das WCAG-Mindestmaß (2.5.5) und hier besonders
            // wichtig: Wer die Schrift vergrößern muss, trifft kleine Ziele am
            // schlechtesten — ausgerechnet dieser Knopf war mit 36 px das
            // kleinste Bedienelement der ganzen Anwendung.
            className={`flex items-center justify-center w-12 h-12 rounded-lg font-black transition-colors ${
              active
                ? "bg-cyan-50 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 ring-2 ring-cyan-600"
                : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
            }`}
            style={{ fontSize: px, minHeight: 48, minWidth: 48 }}
          >
            A
          </button>
        );
      })}
    </div>
  );
}

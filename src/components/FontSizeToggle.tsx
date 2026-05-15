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
  document.body.classList.remove("font-small", "font-medium", "font-large");
  document.body.classList.add(`font-${s}`);
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
                ? "bg-white/20 text-white"
                : "text-white/50 hover:text-white hover:bg-white/10"
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

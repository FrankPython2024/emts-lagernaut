"use client";
import { useState } from "react";
import { DEFAULT_LAYOUT, DEFAULT_VISIBILITY, type LayoutsMap } from "./defaultLayout";

const LS_LAYOUT     = "lagernaut.dashboard.layout";
const LS_VISIBILITY = "lagernaut.dashboard.visibility";

function loadLayouts(): LayoutsMap {
  if (typeof window === "undefined") return DEFAULT_LAYOUT;
  try {
    const saved = localStorage.getItem(LS_LAYOUT);
    return saved ? (JSON.parse(saved) as LayoutsMap) : DEFAULT_LAYOUT;
  } catch { return DEFAULT_LAYOUT; }
}

function loadVisibility(): Record<string, boolean> {
  if (typeof window === "undefined") return DEFAULT_VISIBILITY;
  try {
    const saved = localStorage.getItem(LS_VISIBILITY);
    if (!saved) return DEFAULT_VISIBILITY;
    return { ...DEFAULT_VISIBILITY, ...JSON.parse(saved) };
  } catch { return DEFAULT_VISIBILITY; }
}

export function useDashboardConfig() {
  const [layouts,    setLayouts]    = useState<LayoutsMap>(() => loadLayouts());
  const [visibility, setVisibility] = useState<Record<string, boolean>>(() => loadVisibility());

  function updateLayout(newLayouts: LayoutsMap) {
    setLayouts(newLayouts);
    try { localStorage.setItem(LS_LAYOUT, JSON.stringify(newLayouts)); } catch {}
  }

  function toggleWidget(id: string) {
    const updated = { ...visibility, [id]: !visibility[id] };
    setVisibility(updated);
    try { localStorage.setItem(LS_VISIBILITY, JSON.stringify(updated)); } catch {}
  }

  function resetToDefault() {
    setLayouts(DEFAULT_LAYOUT);
    setVisibility(DEFAULT_VISIBILITY);
    try {
      localStorage.removeItem(LS_LAYOUT);
      localStorage.removeItem(LS_VISIBILITY);
    } catch {}
  }

  return { layouts, visibility, updateLayout, toggleWidget, resetToDefault };
}

"use client";
import { useState, useRef } from "react";
import { DEFAULT_LAYOUT, DEFAULT_VISIBILITY, type LayoutsMap } from "./defaultLayout";

const LS_LAYOUT     = "lagernaut.dashboard.layout";
const LS_VISIBILITY = "lagernaut.dashboard.visibility";

function loadLayouts(): LayoutsMap {
  if (typeof window === "undefined") return DEFAULT_LAYOUT;
  try {
    const saved = localStorage.getItem(LS_LAYOUT);
    if (!saved) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(saved) as LayoutsMap;
    // Migration: altes Layout mit 'stats' statt neuen 'kpiAnfragen' usw. → Default
    const lgItems = parsed.lg ?? [];
    const hasOldStats = lgItems.some(l => l.i === "stats");
    const hasNewKpis  = lgItems.some(l => l.i === "kpiAnfragen");
    if (hasOldStats && !hasNewKpis) return DEFAULT_LAYOUT;
    return parsed;
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
  const [resetKey,   setResetKey]   = useState(0);

  // Ursache B Fix: verhindert dass onLayoutChange während Reset den alten Stand zurückschreibt.
  // Responsive feuert onLayoutChange beim Remount — ohne dieses Flag würde localStorage
  // sofort wieder mit dem alten Layout überschrieben werden.
  const isResettingRef = useRef(false);

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
    // Sperre onLayoutChange für 300ms — verhindert dass Responsive beim Remount
    // den alten localStorage-Stand sofort wieder reinschreibt (Ursache B).
    isResettingRef.current = true;
    setTimeout(() => { isResettingRef.current = false; }, 300);

    // Neue Objekt-Referenzen erzwingen Rerender (gleiche Konstante würde batched)
    setLayouts(JSON.parse(JSON.stringify(DEFAULT_LAYOUT)) as LayoutsMap);
    setVisibility({ ...DEFAULT_VISIBILITY });
    setResetKey(k => k + 1);   // erzwingt Remount der Responsive-Komponente

    try {
      localStorage.removeItem(LS_LAYOUT);
      localStorage.removeItem(LS_VISIBILITY);
    } catch {}
  }

  return { layouts, visibility, resetKey, isResettingRef, updateLayout, toggleWidget, resetToDefault };
}

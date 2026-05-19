"use client";
import { useState, useEffect, useRef } from "react";
import { api } from "@/trpc/react";
import { DEFAULT_LAYOUT, DEFAULT_VISIBILITY, type LayoutsMap } from "./defaultLayout";

// localStorage-Keys — nur noch für einmalige Migration (Phase 2 → Phase 3)
const LS_LAYOUT     = "lagernaut.dashboard.layout";
const LS_VISIBILITY = "lagernaut.dashboard.visibility";

export function useDashboardConfig() {
  const utils = api.useUtils();

  // ── Lokaler UI-State (wird aus Server-Daten initialisiert) ────────────────
  const [layouts,    setLayouts]    = useState<LayoutsMap>(DEFAULT_LAYOUT);
  const [visibility, setVisibility] = useState<Record<string, boolean>>(DEFAULT_VISIBILITY);
  const [resetKey,   setResetKey]   = useState(0);

  // Refs für stabilen Closure-Zugriff in Debounce-Callbacks
  const latestLayoutsRef    = useRef(layouts);
  const latestVisibilityRef = useRef(visibility);
  latestLayoutsRef.current   = layouts;
  latestVisibilityRef.current = visibility;

  // isResettingRef: verhindert dass onLayoutChange-Remount nach Reset den alten
  // Zustand zurückschreibt (Ursache B — aus Phase-2-Diagnose)
  const isResettingRef = useRef(false);

  const hasInitializedRef  = useRef(false);   // initialisierung nur einmal
  const saveDebouncedRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Server-Query ──────────────────────────────────────────────────────────
  const { data, isLoading } = api.userPreferences.getDashboardConfig.useQuery(
    undefined,
    { staleTime: Infinity, refetchOnWindowFocus: false }
  );

  // ── Mutations ─────────────────────────────────────────────────────────────
  const save        = api.userPreferences.saveDashboardConfig.useMutation();
  const resetMut    = api.userPreferences.resetDashboardConfig.useMutation();
  const saveMutRef  = useRef(save.mutate);
  saveMutRef.current = save.mutate;

  // ── Initialisierung aus Server-Daten (einmalig) ───────────────────────────
  useEffect(() => {
    if (data === undefined || hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    if (data !== null) {
      // Server hat gespeicherte Konfiguration
      const cfg = data as { layouts?: LayoutsMap; visibility?: Record<string, boolean> };
      setLayouts(cfg.layouts ?? DEFAULT_LAYOUT);
      setVisibility({ ...DEFAULT_VISIBILITY, ...(cfg.visibility ?? {}) });
      return;
    }

    // Null → localStorage-Migration versuchen (Phase 2 → Phase 3)
    try {
      const oldL = localStorage.getItem(LS_LAYOUT);
      const oldV = localStorage.getItem(LS_VISIBILITY);
      if (oldL || oldV) {
        const migL = oldL ? JSON.parse(oldL) as LayoutsMap : DEFAULT_LAYOUT;
        const migV = oldV ? JSON.parse(oldV) as Record<string, boolean> : DEFAULT_VISIBILITY;
        // Veraltetes Layout mit 'stats' statt KPI-Widgets ignorieren
        const hasOldStats = (migL.lg ?? []).some((l: { i: string }) => l.i === "stats");
        if (!hasOldStats) {
          setLayouts(migL);
          setVisibility({ ...DEFAULT_VISIBILITY, ...migV });
          saveMutRef.current({ layouts: migL, visibility: { ...DEFAULT_VISIBILITY, ...migV } });
        }
        localStorage.removeItem(LS_LAYOUT);
        localStorage.removeItem(LS_VISIBILITY);
      }
    } catch {}
    // Kein localStorage → Default bleibt
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── API ───────────────────────────────────────────────────────────────────

  function updateLayout(newLayouts: LayoutsMap) {
    setLayouts(newLayouts);
    // Debounce: 800ms — verhindert DB-Spam während Drag
    if (saveDebouncedRef.current) clearTimeout(saveDebouncedRef.current);
    saveDebouncedRef.current = setTimeout(() => {
      saveMutRef.current({ layouts: newLayouts, visibility: latestVisibilityRef.current });
    }, 800);
  }

  function toggleWidget(id: string) {
    const newVis = { ...visibility, [id]: !visibility[id] };
    setVisibility(newVis);
    // Visibility sofort speichern (selten genug für sofortigen DB-Call)
    saveMutRef.current({ layouts: latestLayoutsRef.current, visibility: newVis });
  }

  async function resetToDefault() {
    // Sperre onLayoutChange für 300ms (Ursache-B-Guard aus Phase 2)
    isResettingRef.current = true;
    setTimeout(() => { isResettingRef.current = false; }, 300);

    // Visuell sofort auf Default setzen
    setLayouts(JSON.parse(JSON.stringify(DEFAULT_LAYOUT)) as LayoutsMap);
    setVisibility({ ...DEFAULT_VISIBILITY });
    setResetKey(k => k + 1);

    // DB leeren + Cache invalidieren
    await resetMut.mutateAsync();
    await utils.userPreferences.getDashboardConfig.invalidate();
  }

  return {
    layouts,
    visibility,
    resetKey,
    isLoading,
    isResettingRef,
    isSaving:   save.isPending,
    isResetting: resetMut.isPending,
    updateLayout,
    toggleWidget,
    resetToDefault,
  };
}

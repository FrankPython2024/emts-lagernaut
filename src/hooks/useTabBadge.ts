"use client";
import { useEffect, useState, useRef, useCallback } from "react";

const BASE_TITLE = "EMTS Lagernaut";

/**
 * Tab-Titel-Counter à la Slack/Gmail: `(N) EMTS Lagernaut`.
 *
 * `notify()` erhöht den Counter NUR wenn der Tab gerade nicht sichtbar ist.
 * Sobald der Tab wieder fokussiert wird (visibilitychange → visible), springt
 * der Counter auf 0 zurück. Keine Sounds / Push-Notifications (bewusst).
 */
export function useTabBadge() {
  const [count, setCount] = useState(0);
  const countRef = useRef(0);

  // Tab-Titel synchron zum Counter halten
  useEffect(() => {
    document.title = count > 0 ? `(${count}) ${BASE_TITLE}` : BASE_TITLE;
  }, [count]);

  // Bei Tab-Fokus: Counter zurück auf 0
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        countRef.current = 0;
        setCount(0);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    if (document.visibilityState === "visible") setCount(0);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // Beim Verlassen des Portals: Titel zurücksetzen
  useEffect(() => () => { document.title = BASE_TITLE; }, []);

  // Increment nur wenn Tab nicht fokussiert. Ref + Sync gegen stale closures.
  const notify = useCallback(() => {
    if (document.visibilityState !== "visible") {
      countRef.current += 1;
      setCount(countRef.current);
    }
  }, []);

  return { count, notify };
}

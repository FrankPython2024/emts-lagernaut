"use client";
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { playPing } from "./ping";

const LS_ENABLED = "lagernaut.notifications-enabled";

// "unsupported" = Browser kennt die Notifications-API nicht
export type NotifPermission = NotificationPermission | "unsupported";

interface NotificationCtxValue {
  supported:  boolean;
  permission: NotifPermission; // default | granted | denied | unsupported
  enabled:    boolean;         // localStorage-Toggle (leise stellen ohne Browser-Reset)
  active:     boolean;         // permission === granted && enabled
  /** Einziger Klick-Handler für den Toggle — kapselt die gesamte Logik. */
  handleToggle: () => void;
}

const NotificationCtx = createContext<NotificationCtxValue>({
  supported:    false,
  permission:   "default",
  enabled:      false,
  active:       false,
  handleToggle: () => {},
});

export function useNotifications(): NotificationCtxValue {
  return useContext(NotificationCtx);
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [supported,  setSupported]  = useState(false);
  const [permission, setPermission] = useState<NotifPermission>("default");
  const [enabled,    setEnabled]    = useState(false);

  // ── Init aus Browser-Status + localStorage ─────────────────────────────────
  useEffect(() => {
    const ok = typeof window !== "undefined" && "Notification" in window;
    setSupported(ok);
    if (!ok) { setPermission("unsupported"); return; }
    setPermission(Notification.permission);
    try { setEnabled(localStorage.getItem(LS_ENABLED) === "true"); } catch {}
  }, []);

  // ── Permission live nachziehen (Edge-Case: Permission zwischenzeitlich
  //    zurückgezogen → Toggle springt automatisch auf „Blockiert"). ──────────
  useEffect(() => {
    if (!supported) return;
    const recheck = () => setPermission(Notification.permission);
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [supported]);

  const persistEnabled = useCallback((v: boolean) => {
    setEnabled(v);
    try { localStorage.setItem(LS_ENABLED, String(v)); } catch {}
  }, []);

  const handleToggle = useCallback(() => {
    if (!supported) return;
    const perm = Notification.permission;

    // Blockiert → kein Toggle möglich, Tooltip erklärt die Reaktivierung
    if (perm === "denied") { setPermission("denied"); return; }

    if (perm === "default") {
      // playPing() synchron in der User-Geste → schaltet AudioContext frei
      // und dient gleichzeitig als Beispiel-Ton.
      playPing();
      void Notification.requestPermission().then((result) => {
        setPermission(result);
        if (result === "granted") persistEnabled(true);
      });
      return;
    }

    // granted → leise/laut umschalten (Permission bleibt erhalten)
    const next = !enabled;
    persistEnabled(next);
    if (next) playPing(); // Beispiel-Ton + Audio-Unlock
  }, [supported, enabled, persistEnabled]);

  const active = permission === "granted" && enabled;

  return (
    <NotificationCtx.Provider value={{ supported, permission, enabled, active, handleToggle }}>
      {children}
    </NotificationCtx.Provider>
  );
}

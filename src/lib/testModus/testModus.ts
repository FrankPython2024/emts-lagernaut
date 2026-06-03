"use client";
import { useEffect, useState } from "react";

/**
 * Test-Modus (Client-State).
 *
 * ADMIN / ADMIN_READONLY können sich ins Techniker-Portal versetzen, um den
 * kompletten Anfrage-Workflow live durchzuspielen. Alle dabei erzeugten Anfragen
 * werden als `testModus = true` markiert und wirken NICHT auf Statistik / KPIs /
 * Bestell-Empfehlung. Der Zustand lebt clientseitig im localStorage und wird beim
 * Logout zurückgesetzt.
 */
export const TEST_MODUS_KEY = "lagernaut.test-modus";

/** Rollen die den Test-Modus nutzen dürfen. BETRACHTER/TECHNIKER ausdrücklich nicht. */
export function darfTestModus(rolle?: string | null): boolean {
  return rolle === "ADMIN" || rolle === "ADMIN_READONLY";
}

export function istTestModusAktiv(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(TEST_MODUS_KEY) === "true";
}

/** Setzt/löscht den Test-Modus und benachrichtigt Listener im selben Tab. */
export function setzeTestModus(aktiv: boolean): void {
  if (typeof window === "undefined") return;
  if (aktiv) window.localStorage.setItem(TEST_MODUS_KEY, "true");
  else window.localStorage.removeItem(TEST_MODUS_KEY);
  // `storage`-Event feuert nur in ANDEREN Tabs → eigenes Event für denselben Tab.
  window.dispatchEvent(new Event("lagernaut:test-modus"));
}

/** Reaktiver Hook: liefert den aktuellen Test-Modus-Zustand. */
export function useTestModus(): boolean {
  const [aktiv, setAktiv] = useState(false);
  useEffect(() => {
    const update = () => setAktiv(istTestModusAktiv());
    update();
    window.addEventListener("lagernaut:test-modus", update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener("lagernaut:test-modus", update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return aktiv;
}

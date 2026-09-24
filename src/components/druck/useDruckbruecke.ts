"use client";

// ── Gemeinsame Abfrage der lokalen Druckbrücke ───────────────────────────────
// EINE Abfrage für alle Anzeigen der Seite (Druckerkarte, Drucken-Knöpfe auf
// jeder Vorlagenkarte) — sonst fragte jede Karte alle 3 s einzeln nach.
// Die Brücke läuft nur auf dem PC beim Drucker (tools/druckbruecke); an jedem
// anderen PC ist sie „nicht erreichbar", dann wird nur alle 15 s nachgesehen.

import { useSyncExternalStore } from "react";

export const BRUECKE_URL = "http://127.0.0.1:17350";

export type BrueckenDrucker = {
  zustand: string | null; zustandText: string; datei: string | null;
  fortschritt: number | null; restMinuten: number | null; schicht: number | null; schichten: number | null;
  duese: number | null; dueseZiel: number | null; bett: number | null; bettZiel: number | null;
  fehlercode: number | null; meldungen: number;
};
export type BrueckenStatus = {
  bruecke: { version: string }; verbindung: string; fehler: string | null;
  letzterBericht: string | null; drucker: BrueckenDrucker | null;
};
export type BrueckenStand = { erreichbar: boolean | null; status: BrueckenStatus | null };

/** In diesen Zuständen nimmt die Brücke einen neuen Druck an (wie STARTBEREIT dort). */
export const STARTBEREIT = ["IDLE", "FINISH", "FAILED"];

let stand: BrueckenStand = { erreichbar: null, status: null };
const LEER: BrueckenStand = { erreichbar: null, status: null };
const hoerer = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let laeuft = false;

async function hole() {
  if (typeof document !== "undefined" && document.visibilityState === "visible") {
    const ab = new AbortController();
    const t = setTimeout(() => ab.abort(), 2500);
    let neu: BrueckenStand = { erreichbar: false, status: stand.status };
    try {
      const r = await fetch(`${BRUECKE_URL}/status`, { signal: ab.signal, cache: "no-store" });
      if (r.ok) neu = { erreichbar: true, status: (await r.json()) as BrueckenStatus };
    } catch { /* keine Brücke an diesem PC */ } finally {
      clearTimeout(t);
    }
    stand = neu;
    hoerer.forEach((h) => h());
  }
  if (laeuft) timer = setTimeout(hole, stand.erreichbar ? 3000 : 15000);
}

function abonniere(h: () => void) {
  hoerer.add(h);
  if (!laeuft) { laeuft = true; void hole(); }
  return () => {
    hoerer.delete(h);
    if (hoerer.size === 0) { laeuft = false; clearTimeout(timer); }
  };
}

/** Sofort neu fragen (z. B. direkt nach dem Start eines Drucks). */
export function brueckeJetztFragen() {
  clearTimeout(timer);
  void hole();
}

export function useDruckbruecke(): BrueckenStand {
  return useSyncExternalStore(abonniere, () => stand, () => LEER);
}

// ── Letzter aus Lagernaut gestarteter Druck (für „fertig → einbuchen?") ─────
// Nur in diesem Browser — die Frage gehört an den PC, an dem gedruckt wurde.
export type LetzterAuftrag = { vorlageId: number; titel: string; datei: string; gestartet: string };
const AUFTRAG_KEY = "druck-letzter-auftrag";

export function merkeAuftrag(a: LetzterAuftrag) {
  try { localStorage.setItem(AUFTRAG_KEY, JSON.stringify(a)); } catch { /* egal */ }
}
export function leseAuftrag(): LetzterAuftrag | null {
  try {
    const a = JSON.parse(localStorage.getItem(AUFTRAG_KEY) ?? "null") as LetzterAuftrag | null;
    // Älter als zwei Tage: nicht mehr fragen.
    return a && Date.now() - new Date(a.gestartet).getTime() < 48 * 3600_000 ? a : null;
  } catch { return null; }
}
export function vergissAuftrag(vorlageId?: number) {
  try {
    const a = leseAuftrag();
    if (vorlageId == null || a?.vorlageId === vorlageId) localStorage.removeItem(AUFTRAG_KEY);
  } catch { /* egal */ }
}

import * as searx  from "./searxng";
import * as google from "./google";
import type { SucheErgebnis } from "./typen";

export type { Fundstelle, SucheErgebnis } from "./typen";

// ── Auswahl der Suchquelle ───────────────────────────────────────────────────
//
// Zwei mögliche Quellen, und die Reihenfolge hat einen Grund:
//
// 1. SearXNG im eigenen Haus. Sucht im GANZEN Web, kostet nichts, braucht kein
//    Konto und kann uns von niemandem gekündigt werden.
// 2. Google Custom Search als Rückfall. Nur noch die gelisteten Domains, und
//    laut Google für neue Kunden ohnehin geschlossen.
//
// Ist keine von beiden eingerichtet, laufen alle Aufrufe ins Leere und melden
// das sauber. Nichts im Programm hängt davon ab — Modelle lassen sich immer
// von Hand eintragen und wachsen über das Spendergerät ohnehin von allein.

export type Quelle = "searxng" | "google" | null;

export function aktiveQuelle(): Quelle {
  if (searx.istEingerichtet())  return "searxng";
  if (google.istEingerichtet()) return "google";
  return null;
}

export function istEingerichtet(): boolean {
  return aktiveQuelle() !== null;
}

export async function verbrauchHeute(): Promise<number> {
  switch (aktiveQuelle()) {
    case "searxng": return searx.verbrauchHeute();
    case "google":  return google.verbrauchHeute();
    default:        return 0;
  }
}

/** Tagesgrenze der aktiven Quelle — nur zur Anzeige. */
export function tageslimit(): number {
  return aktiveQuelle() === "searxng" ? 300 : 90;
}

export async function suche(begriff: string, anzahl = 8): Promise<SucheErgebnis> {
  switch (aktiveQuelle()) {
    case "searxng": return searx.suche(begriff, anzahl);
    case "google":  return google.suche(begriff, anzahl);
    default:
      return {
        ok: false,
        grund: "Keine Suchquelle eingerichtet. Modelle lassen sich weiterhin von Hand eintragen.",
      };
  }
}

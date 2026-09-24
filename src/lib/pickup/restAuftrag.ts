// ── „Rest in neuen Auftrag übernehmen" (Paket 4, 24.09.2026) ─────────────────
//
// Gemessen am 23.09.2026: 1.339 LogIDs wurden nach einem Fehlversuch einfach neu
// angelegt — der alte Auftrag blieb oft offen (#168 „Richard 285" neben #169 und
// #183: 114 LogIDs gleichzeitig in zwei offenen Aufträgen). Und von den nie
// gefundenen Geräten abgeschlossener Aufträge waren später
//   • 34 % ausgeschieden (verkauft/abgegangen) — da läuft niemand mehr hin,
//   • 27 % auf einem anderen Stellplatz.
// Deshalb übernimmt der Rest-Auftrag nicht blind die alten Orte: Ist der
// Lagerfuchs NACH dem alten Auftrag gesehen worden, gilt sein Ort; ist das Gerät
// seitdem ausgeschieden, wird es (auf Wunsch) gar nicht erst aufgenommen.
//
// ⚠️ Nur wenn der Lagerfuchs-Stand JÜNGER als der alte Auftrag ist. Der Auftrag
// kommt aus einer frisch gezogenen ReForm-Datei und ist beim Anlegen meist
// aktueller als der Lagerfuchs (284 Fälle, in denen ein späterer Import nur
// nachzog, was der Auftrag schon wusste).
//
// Reine Funktion, Test: `npm run test:rest`.

import { nurZiffern } from "@/lib/format/ziffern";

export type RestPosition = {
  logId: string;
  colli: string | null;
  stellplatz: string | null;
  bezeichnung: string | null;
};

export type LagerfuchsStand = {
  stellplatz: string | null;
  colli: string | null;
  zuletztGesehen: Date;
  ausgeschieden: boolean;
  ausgeschiedenAm: Date | null;
};

export type RestPlan = {
  /** Diese Positionen kommen in den neuen Auftrag (ggf. mit neuem Ort). */
  uebernehmen: (RestPosition & { ortNeu: boolean })[];
  /** Laut Lagerfuchs seit dem alten Auftrag nicht mehr im Haus. */
  ausgeschieden: { logId: string; seit: Date | null }[];
  /** Laut Lagerfuchs seit dem alten Auftrag umgezogen (Platz oder Colli). */
  umgezogen: number;
  /** Nicht im Lagerfuchs — alter Ort bleibt. */
  unbekannt: number;
};

const gleicherPlatz = (a: string | null, b: string | null) =>
  (a ?? "").trim().toUpperCase() === (b ?? "").trim().toUpperCase();
const gleichesColli = (a: string | null, b: string | null) => nurZiffern(a ?? "") === nurZiffern(b ?? "");

export function planeRest(args: {
  positionen: RestPosition[];
  /** Lagerfuchs-Stand je LogID (Schlüssel: reine Ziffern). */
  stand: Map<string, LagerfuchsStand>;
  auftragAngelegt: Date;
  ohneAusgeschiedene: boolean;
  ortAktualisieren: boolean;
}): RestPlan {
  const plan: RestPlan = { uebernehmen: [], ausgeschieden: [], umgezogen: 0, unbekannt: 0 };
  const seit = args.auftragAngelegt.getTime();

  for (const p of args.positionen) {
    const s = args.stand.get(nurZiffern(p.logId));
    if (!s) {
      plan.unbekannt++;
      plan.uebernehmen.push({ ...p, ortNeu: false });
      continue;
    }
    const abgang = s.ausgeschiedenAm ?? s.zuletztGesehen;
    if (s.ausgeschieden && abgang.getTime() > seit) {
      plan.ausgeschieden.push({ logId: nurZiffern(p.logId), seit: s.ausgeschiedenAm });
      if (!args.ohneAusgeschiedene) plan.uebernehmen.push({ ...p, ortNeu: false });
      continue;
    }
    const neuer = s.zuletztGesehen.getTime() > seit;
    const anders = !gleicherPlatz(s.stellplatz, p.stellplatz) || !gleichesColli(s.colli, p.colli);
    if (neuer && anders && (s.stellplatz || s.colli)) {
      plan.umgezogen++;
      if (args.ortAktualisieren) {
        plan.uebernehmen.push({
          ...p,
          stellplatz: s.stellplatz ?? p.stellplatz,
          colli:      s.colli ?? p.colli,
          ortNeu:     true,
        });
        continue;
      }
    }
    plan.uebernehmen.push({ ...p, ortNeu: false });
  }
  return plan;
}

/** Name des Rest-Auftrags: „Richard 179" → „Richard 179 · Rest". Nie „· Rest · Rest". */
export function restName(alt: string): string {
  const basis = alt.replace(/(\s*·\s*Rest)+$/i, "").trim();
  return `${basis} · Rest`.slice(0, 200);
}

// ── Wie oft wurde welches Teil für diesen Gerätetyp angefragt? ───────────────
// Für die Reihenfolge der Teile im Techniker-Portal (src/lib/anfragen/haeufigkeit.ts).
//
// Gezählt wird je Modellschlüssel über die ROH-Bezeichnung des Zielgeräts
// (`anfrageSchluesselFuer`, wie Teilespender und „gleiche Teile") — über den
// bereinigten Namen fiele ein „Latitude 7320 Detachable" mit dem normalen 7320
// zusammen. Letzte 12 Monate, ohne Storno, Test-Modus und Sonderanfragen.
//
// Die Zählung aller Modelle wird einmal gerechnet und 10 min gehalten (Prozess-
// speicher) — ein Scan kostet dann nur noch die Schlüssel-Suche für das eine Gerät.

import { prisma } from "@/core/db/prisma";
import { zeitraum } from "@/lib/zeit/berlin";
import { anfrageSchluesselFuer } from "@/modules/teilespender/service";
import type { Haeufigkeit } from "@/lib/anfragen/haeufigkeit";

const HALTEN_MS = 10 * 60_000;
const TAGE = 365;

type Zaehlung = Map<string, Map<string, number>>;
const g = globalThis as unknown as { __teilHaeufigkeit?: { bis: number; wert: Promise<Zaehlung> } };

async function zaehleAlle(): Promise<Zaehlung> {
  const anfragen = await prisma.anfrage.findMany({
    where:  { testModus: false, istSonderAnfrage: false, status: { not: "STORNIERT" }, datum: { gte: zeitraum(TAGE).von } },
    select: { id: true, logId: true, geraeteName: true, geraet: true, teil: true },
  });
  const schluessel = await anfrageSchluesselFuer(anfragen);
  const je: Zaehlung = new Map();
  for (const a of anfragen) {
    const key = schluessel.get(a.id);
    if (!key || !a.teil) continue;
    const m = je.get(key) ?? new Map<string, number>();
    m.set(a.teil, (m.get(a.teil) ?? 0) + 1);
    je.set(key, m);
  }
  return je;
}

function zaehlung(): Promise<Zaehlung> {
  const jetzt = Date.now();
  if (g.__teilHaeufigkeit && g.__teilHaeufigkeit.bis > jetzt) return g.__teilHaeufigkeit.wert;
  const wert = zaehleAlle();
  g.__teilHaeufigkeit = { bis: jetzt + HALTEN_MS, wert };
  wert.catch(() => { g.__teilHaeufigkeit = undefined; });
  return wert;
}

/** Anfragen je Teil für das gescannte Gerät. Leer, wenn der Typ nicht erkannt wird. */
export async function teilHaeufigkeitFuer(logId: string | null, geraet: string): Promise<Haeufigkeit> {
  const echteLogId = logId && /\d/.test(logId) ? logId : null;   // „---" = ohne LogID
  const [schluessel, alle] = await Promise.all([
    anfrageSchluesselFuer([{ id: 0, logId: echteLogId, geraeteName: geraet, geraet }]),
    zaehlung(),
  ]);
  const key = schluessel.get(0);
  const m = key ? alle.get(key) : undefined;
  return m ? [...m].map(([teil, anzahl]) => ({ teil, anzahl })) : [];
}

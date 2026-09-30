// ── 3D-Druck: Nachfrage und Bestand je Modell + Teiltyp ──────────────────────
// Grundlage für Druckliste und Vorlagen-Karten (Router `druck`). Planung selbst:
// src/lib/druck/druckliste.ts (rein, getestet). Ausgelagert beim Audit 30.09.2026.

import { prisma } from "@/core/db/prisma";
import { zeitraum } from "@/lib/zeit/berlin";
import { zerlegeGeraetename } from "@/lib/geraete/schildName";
import { anfrageSchluesselFuer, modellSchluessel } from "@/modules/teilespender/service";
import { verteileBestand, type ArtikelBestand, type BedarfZeile } from "@/lib/druck/druckliste";

const OFFEN = ["NEU", "BEDARF", "IN_BEARBEITUNG"] as const;

/** „Lenovo ThinkPad L13 Gen 1 20R4-S37W0N" → „Lenovo ThinkPad L13 Gen 1". */
export function sauberName(name: string, hersteller?: string | null): string {
  const s = zerlegeGeraetename(name, hersteller);
  return [s.hersteller ?? "", s.serie, s.modell, s.zusatz].filter((x) => x).join(" ").trim() || name.trim();
}

/**
 * Nachfrage und Bestand je Modellschlüssel + Teiltyp.
 * Nachfrage = Anfragen der letzten `tage` Tage ohne Storno und Test-Modus —
 * auch „nicht verfügbar": genau das ist die ungedeckte Nachfrage.
 * Offen = heute noch offene Anfragen, unabhängig vom Zeitraum.
 */
// `liste` und `druckliste` brauchen dieselbe Rechnung und laden gleichzeitig (Audit
// 30.09.2026: jede Seite rechnete sie doppelt — alle Anfragen von 90 Tagen plus alle
// Kompatibilitäten). Gleiche Anfrage innerhalb von 15 s → dasselbe Ergebnis.
const BEDARF_MERKEN_MS = 15_000;
export type Bedarf = { zeilen: BedarfZeile[]; gruppeBestand: Map<number, number> };
const bedarfGemerkt = new Map<string, { bis: number; wert: Promise<Bedarf> }>();
export function ladeBedarf(teiltypen: string[], tage: number, standortFilter: Record<string, unknown>): Promise<Bedarf> {
  const schluessel = `${tage}|${[...teiltypen].sort().join("|")}|${JSON.stringify(standortFilter)}`;
  const jetzt = Date.now();
  const alt = bedarfGemerkt.get(schluessel);
  if (alt && alt.bis > jetzt) return alt.wert;
  const wert = ladeBedarfFrisch(teiltypen, tage, standortFilter);
  bedarfGemerkt.set(schluessel, { bis: jetzt + BEDARF_MERKEN_MS, wert });
  wert.catch(() => bedarfGemerkt.delete(schluessel));
  for (const [k, v] of bedarfGemerkt) if (v.bis <= jetzt) bedarfGemerkt.delete(k);
  return wert;
}

async function ladeBedarfFrisch(teiltypen: string[], tage: number, standortFilter: Record<string, unknown>): Promise<Bedarf> {
  if (teiltypen.length === 0) return { zeilen: [], gruppeBestand: new Map() };
  const { von } = zeitraum(tage);
  const anfrageFelder = { id: true, logId: true, geraeteName: true, geraet: true, teil: true, menge: true } as const;
  const [imZeitraum, offen, kompat] = await Promise.all([
    prisma.anfrage.findMany({
      where:  { teil: { in: teiltypen }, testModus: false, status: { not: "STORNIERT" }, datum: { gte: von } },
      select: anfrageFelder,
    }),
    prisma.anfrage.findMany({
      where:  { teil: { in: teiltypen }, testModus: false, status: { in: [...OFFEN] } },
      select: anfrageFelder,
    }),
    // Auch Artikel mit 0 Stück: Ihr Pool-Partner kann Bestand haben.
    prisma.kompatibilitaet.findMany({
      where:  { teiltyp: { in: teiltypen }, artikel: { ...standortFilter } },
      select: { geraet: true, teiltyp: true, artikel: { select: { id: true, bestand: true, poolPartnerId: true } } },
    }),
  ]);

  // Nachfrage über die Roh-Bezeichnung des Zielgeräts, wie Teilespender und
  // „gleiche Teile" (CLAUDE.md): Über `geraeteName` landete ein „Latitude 7320
  // Detachable" beim normalen 7320 (Audit 30.09.2026).
  const alleAnfragen = [...new Map([...imZeitraum, ...offen].map((a) => [a.id, a])).values()];
  const schluesselJe = await anfrageSchluesselFuer(alleAnfragen);
  const keyVon = (a: (typeof alleAnfragen)[number]) => schluesselJe.get(a.id) ?? modellSchluessel(a.geraeteName ?? a.geraet ?? "");

  const zeilen = new Map<string, BedarfZeile & { namen: Map<string, number> }>();
  const zeile = (key: string, teiltyp: string) => {
    const k = `${key}\u0000${teiltyp}`;
    let z = zeilen.get(k);
    if (!z) {
      z = { key, teiltyp, name: "", anfragen: 0, stueck: 0, offenStueck: 0, bestand: 0, namen: new Map() };
      zeilen.set(k, z);
    }
    return z;
  };
  const merkeName = (z: { namen: Map<string, number> }, roh: string) => {
    const n = sauberName(roh);
    z.namen.set(n, (z.namen.get(n) ?? 0) + 1);
  };

  for (const a of imZeitraum) {
    const key = keyVon(a);
    if (!key) continue;
    const z = zeile(key, a.teil);
    z.anfragen++;
    z.stueck += Math.max(1, a.menge);
    merkeName(z, a.geraeteName ?? a.geraet ?? "");
  }
  for (const a of offen) {
    const key = keyVon(a);
    if (!key) continue;
    const z = zeile(key, a.teil);
    z.offenStueck += Math.max(1, a.menge);
    merkeName(z, a.geraeteName ?? a.geraet ?? "");
  }

  // Bestand: Artikel samt Pool-Partner, genau einmal gezählt und nach Nachfrage
  // auf die Zeilen verteilt (verteileBestand).
  const artikel = new Map<number, ArtikelBestand>();
  const links: { zeile: string; artikelId: number }[] = [];
  for (const k of kompat) {
    const key = modellSchluessel(k.geraet);
    if (!key) continue;
    const z = zeile(key, k.teiltyp);
    if (k.artikel.bestand > 0) merkeName(z, k.geraet);
    artikel.set(k.artikel.id, k.artikel);
    links.push({ zeile: `${key}\u0000${k.teiltyp}`, artikelId: k.artikel.id });
  }
  const fehlendePartner = [...new Set([...artikel.values()].map((a) => a.poolPartnerId).filter((p): p is number => p != null && !artikel.has(p)))];
  if (fehlendePartner.length > 0) {
    const partner = await prisma.artikel.findMany({
      where:  { id: { in: fehlendePartner }, ...standortFilter },
      select: { id: true, bestand: true, poolPartnerId: true },
    });
    for (const p of partner) artikel.set(p.id, p);
  }
  const { jeZeile, gruppenJeZeile, gruppeBestand } = verteileBestand(
    links, artikel, (k) => { const z = zeilen.get(k); return z ? z.stueck + z.offenStueck : 0; },
  );

  const liste = [...zeilen.entries()]
    // Zeilen ohne Nachfrage und ohne Bestand (nur eine Kompatibilität mit 0 Stück) interessieren niemanden.
    .filter(([k, z]) => z.stueck > 0 || z.offenStueck > 0 || (gruppenJeZeile.get(k) ?? []).some((g) => (gruppeBestand.get(g) ?? 0) > 0))
    .map(([k, { namen, ...z }]) => ({
      ...z,
      bestand: jeZeile.get(k) ?? 0,
      gruppen: gruppenJeZeile.get(k) ?? [],
      name: [...namen].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0] ?? z.key,
    }));
  return { zeilen: liste, gruppeBestand };
}

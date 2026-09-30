// ── Vorschau und Eckdaten aus der Druckdatei (Druckerkarte, 30.09.2026) ───────
//
// Bambu Studio legt in jede geslicte .gcode.3mf fertige Bilder und Eckdaten
// (gemessen an Vorlage 1 am 30.09.2026):
//   Metadata/plate_N.png   — Vorschau der Platte (mit Licht)
//   Metadata/top_N.png     — Ansicht von oben
//   Metadata/slice_info.config — je Platte: prediction (Sekunden), weight (Gramm),
//                                je Filament used_g
// Die Druckerkarte zeigt das zum laufenden Druck. Einmal je Datei entpackt und im
// Prozessspeicher gehalten (die Karte fragt alle 3 s).

import { prisma } from "@/core/db/prisma";
import { leseZip, type ZipEintrag } from "@/lib/zip/einfach";

/** gedruckt = die Datei enthält G-Code für diese Platte (sonst nur ein Vorschaubild einer anderen Platte des Projekts). */
export type PlattenInfo = { nr: number; gedruckt: boolean; bild: Buffer | null; oben: Buffer | null; gramm: number | null; minuten: number | null };
export type DateiInfo = { platten: PlattenInfo[] };

const zahl = (s: string | undefined) => {
  const n = s == null ? NaN : Number(s);
  return Number.isFinite(n) ? n : null;
};

/** Platten, Bilder und Eckdaten aus den ZIP-Einträgen einer .gcode.3mf. */
export function plattenAusZip(eintraege: readonly ZipEintrag[]): DateiInfo {
  const nach = new Map(eintraege.map((e) => [e.name, e.daten]));
  const nummern = new Set<number>();
  for (const e of eintraege) {
    const m = /^Metadata\/plate_(\d+)\.(?:gcode|png)$/.exec(e.name);
    if (m) nummern.add(Number(m[1]));
  }
  // slice_info.config: je <plate> … </plate> die Kennwerte
  const slice = nach.get("Metadata/slice_info.config")?.toString("utf8") ?? "";
  const kennwerte = new Map<number, { gramm: number | null; minuten: number | null }>();
  for (const block of slice.split(/<plate>/).slice(1)) {
    const inhalt = block.split(/<\/plate>/)[0] ?? "";
    const meta = (k: string) => new RegExp(`<metadata\\s+key="${k}"\\s+value="([^"]*)"`).exec(inhalt)?.[1];
    const nr = zahl(meta("index"));
    if (nr == null) continue;
    let gramm = zahl(meta("weight"));
    if (gramm == null) {
      const teile = [...inhalt.matchAll(/used_g="([^"]+)"/g)].map((m) => zahl(m[1]) ?? 0);
      gramm = teile.length ? Math.round(teile.reduce((s, n) => s + n, 0) * 100) / 100 : null;
    }
    const sek = zahl(meta("prediction"));
    kennwerte.set(nr, { gramm, minuten: sek != null ? Math.round(sek / 60) : null });
    nummern.add(nr);
  }
  return {
    platten: [...nummern].sort((a, b) => a - b).map((nr) => ({
      nr,
      gedruckt: nach.has(`Metadata/plate_${nr}.gcode`),
      bild: nach.get(`Metadata/plate_${nr}.png`) ?? null,
      oben: nach.get(`Metadata/top_${nr}.png`) ?? null,
      gramm: kennwerte.get(nr)?.gramm ?? null,
      minuten: kennwerte.get(nr)?.minuten ?? null,
    })),
  };
}

/**
 * Die vom Drucker gemeldete Platte, sonst die mit G-Code, sonst die erste.
 * Gemessen am 30.09.2026: Eine exportierte Datei enthält oft plate_2.gcode UND ein
 * Vorschaubild plate_1.png der nicht exportierten Platte — „die erste" wäre falsch.
 */
export function waehlePlatte(info: DateiInfo, nr: number | null | undefined): PlattenInfo | null {
  return info.platten.find((p) => p.nr === nr) ?? info.platten.find((p) => p.gedruckt) ?? info.platten[0] ?? null;
}

/** Nur Bilder und slice_info entpacken — der G-Code (bis zig MB) wird nie gebraucht. */
export const NUR_METADATEN = (name: string) => /^Metadata\/((plate|top)_\d+\.png|slice_info\.config)$/.test(name);
const MAX_METADATEI = 8 * 1024 * 1024;

const g = globalThis as unknown as { __druckVorschau?: Map<number, DateiInfo | null> };
function ablage(): Map<number, DateiInfo | null> {
  return (g.__druckVorschau ??= new Map());
}

/** Eckdaten einer Druckdatei (DruckvorlageDatei.id), zwischengespeichert. */
export async function druckdateiInfo(dateiId: number): Promise<DateiInfo | null> {
  const a = ablage();
  if (a.has(dateiId)) {
    // Zuletzt benutzt ans Ende (Verdrängung trifft den am längsten unbenutzten).
    const v = a.get(dateiId)!;
    a.delete(dateiId);
    a.set(dateiId, v);
    return v;
  }
  const d = await prisma.druckvorlageDatei.findUnique({ where: { id: dateiId }, select: { daten: true } });
  let info: DateiInfo | null = null;
  try {
    info = d?.daten ? plattenAusZip(leseZip(Buffer.from(d.daten), { nurDaten: NUR_METADATEN, maxEintrag: MAX_METADATEI })) : null;
  } catch {
    info = null;                       // kaputtes ZIP → einfach ohne Vorschau
  }
  a.set(dateiId, info);
  while (a.size > 50) a.delete(a.keys().next().value as number);
  return info;
}

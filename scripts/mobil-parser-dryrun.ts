// ── Mobil-Ersatzteile — Parser-Trockenlauf ──────────────────────────────────
//
// Liest die echte CSV ein und schreibt NUR einen Bericht in die Konsole.
// KEIN DB-Zugriff, KEIN Schreiben, kein Import von Prisma — reine Analyse.
//
// Aufruf:
//   npx tsx scripts/mobil-parser-dryrun.ts "<pfad/zur/export.csv>"
//   npm run mobil:dryrun -- "<pfad/zur/export.csv>"
//
// Erwartet einen ;-getrennten, UTF-8-Export. Nutzbare Spalten:
//   LogId, Bezeichnung, Colli, Stellplatz, EK, Status

import fs from "fs";
import Papa from "papaparse";
import { zuordnen, bezeichnungNormalisieren, type MobilZuordnung } from "../src/lib/mobil/parser";

// ── CSV-Pfad ────────────────────────────────────────────────────────────────
const pfad = process.argv[2];
if (!pfad) {
  console.error("\n❌ Kein CSV-Pfad angegeben.\n   Aufruf: npx tsx scripts/mobil-parser-dryrun.ts \"<pfad/zur/export.csv>\"\n");
  process.exit(1);
}
if (!fs.existsSync(pfad)) {
  console.error(`\n❌ Datei nicht gefunden: ${pfad}\n`);
  process.exit(1);
}

// ── Spalten case-insensitiv auflösen ─────────────────────────────────────────
function feld(row: Record<string, string>, name: string): string {
  const key = Object.keys(row).find((k) => k.trim().toLowerCase() === name.toLowerCase());
  return key ? (row[key] ?? "").trim() : "";
}

// ── CSV lesen ─────────────────────────────────────────────────────────────────
const text   = fs.readFileSync(pfad, "utf8");
const parsed = Papa.parse<Record<string, string>>(text, {
  header:         true,
  delimiter:      ";",
  skipEmptyLines: true,
});

type Zeile = { logId: string; bezeichnung: string; colli: string; z: MobilZuordnung };
const zeilen: Zeile[] = [];
for (const row of parsed.data) {
  const logId       = feld(row, "LogId");
  const bezeichnung = feld(row, "Bezeichnung");
  if (!logId && !bezeichnung) continue; // Leerzeile
  zeilen.push({
    logId,
    bezeichnung,
    colli: feld(row, "Colli"),
    z:     zuordnen(bezeichnung), // Alias-Map im Trockenlauf bewusst leer
  });
}

// ── Auswertung ────────────────────────────────────────────────────────────────
const gesamt   = zeilen.length;
const sicher   = zeilen.filter((r) => r.z.sicher);
const mehrfach = zeilen.filter((r) => !r.z.sicher && r.z.mehrfachModell);
const review   = zeilen.filter((r) => !r.z.sicher && !r.z.mehrfachModell);

function pct(n: number): string {
  return gesamt ? `${((n / gesamt) * 100).toFixed(1)} %` : "—";
}
function zaehle<T>(items: T[], key: (t: T) => string | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}
function tabelle(map: Map<string, number>, limit = Infinity): string[] {
  return [...map].sort((a, b) => b[1] - a[1]).slice(0, limit)
    .map(([k, c]) => `   ${String(c).padStart(5)}×  ${k}`);
}
const line = (c = "═") => c.repeat(72);

console.log(`\n${line()}`);
console.log(`  MOBIL-PARSER — TROCKENLAUF   (${pfad})`);
console.log(`${line()}`);

// 1) Trefferquote
console.log(`\n📊 TREFFERQUOTE  (${gesamt} Datenzeilen)`);
console.log(`   SICHER (Hersteller + 1 Modell + Teiltyp):  ${String(sicher.length).padStart(5)}  (${pct(sicher.length)})`);
console.log(`   MEHRFACH-MODELL (erkannt, >1 Modell):      ${String(mehrfach.length).padStart(5)}  (${pct(mehrfach.length)})`);
console.log(`   REVIEW (nicht eindeutig):                  ${String(review.length).padStart(5)}  (${pct(review.length)})`);
console.log(`   ── erkannt gesamt (sicher + mehrfach):     ${String(sicher.length + mehrfach.length).padStart(5)}  (${pct(sicher.length + mehrfach.length)})`);

// 2) Verteilungen
console.log(`\n🏭 HERSTELLER (alle erkannten Zeilen)`);
tabelle(zaehle([...sicher, ...mehrfach], (r) => r.z.hersteller)).forEach((l) => console.log(l));

console.log(`\n📱 TOP-MODELLE (nur SICHER, eindeutiges Modell)`);
tabelle(zaehle(sicher, (r) => r.z.modell), 25).forEach((l) => console.log(l));

console.log(`\n🔧 TEILTYPEN (alle erkannten Zeilen)`);
tabelle(zaehle([...sicher, ...mehrfach], (r) => r.z.teiltyp)).forEach((l) => console.log(l));

// 3) Vorschau: Modell + Teiltyp → Anzahl LogIDs + Collis (spätere Anzeige)
console.log(`\n${line("─")}`);
console.log(`  📋 VORSCHAU: Modell + Teiltyp → Anzahl LogIDs + Collis  (nur SICHER)`);
console.log(`${line("─")}`);
type Bucket = { anzahl: number; collis: Set<string> };
const vorschau = new Map<string, Bucket>();
for (const r of sicher) {
  const k = `${r.z.modell}  ·  ${r.z.teiltyp}`;
  const b = vorschau.get(k) ?? { anzahl: 0, collis: new Set<string>() };
  b.anzahl += 1;
  if (r.colli) b.collis.add(r.colli);
  vorschau.set(k, b);
}
for (const [k, b] of [...vorschau].sort((a, b2) => b2[1].anzahl - a[1].anzahl)) {
  const collis = [...b.collis].sort();
  const collTxt = collis.length ? collis.join(", ") : "—";
  console.log(`   ${String(b.anzahl).padStart(4)}×  ${k.padEnd(40)}  Collis: ${collTxt}`);
}

// 4) Mehrfach-Modell-Fälle (wie aufgeteilt wurde)
console.log(`\n${line("─")}`);
console.log(`  🔀 MEHRFACH-MODELL-FÄLLE  (eine Bezeichnung → mehrere Modelle)`);
console.log(`${line("─")}`);
const mehrfachGruppen = new Map<string, { anzahl: number; modelle: string[]; teiltyp: string | null; bsp: string }>();
for (const r of mehrfach) {
  const norm = bezeichnungNormalisieren(r.bezeichnung);
  const g = mehrfachGruppen.get(norm) ?? { anzahl: 0, modelle: r.z.modelle, teiltyp: r.z.teiltyp, bsp: r.bezeichnung.replace(/[\r\n]+/g, "⏎") };
  g.anzahl += 1;
  mehrfachGruppen.set(norm, g);
}
if (mehrfachGruppen.size === 0) console.log("   (keine)");
for (const [, g] of [...mehrfachGruppen].sort((a, b) => b[1].anzahl - a[1].anzahl)) {
  console.log(`   ${String(g.anzahl).padStart(4)}×  "${g.bsp}"`);
  console.log(`         → ${g.modelle.join("  +  ")}   [Teiltyp: ${g.teiltyp ?? "—"}]`);
}

// 5) REVIEW-Liste (distinct Bezeichnungen, die NICHT sicher zugeordnet wurden)
console.log(`\n${line("─")}`);
console.log(`  ⚠️  REVIEW: distinct Bezeichnungen ohne sichere Zuordnung`);
console.log(`${line("─")}`);
const reviewGruppen = new Map<string, { anzahl: number; bsp: string; z: MobilZuordnung }>();
for (const r of review) {
  const norm = bezeichnungNormalisieren(r.bezeichnung);
  const g = reviewGruppen.get(norm) ?? { anzahl: 0, bsp: r.bezeichnung.replace(/[\r\n]+/g, "⏎"), z: r.z };
  g.anzahl += 1;
  reviewGruppen.set(norm, g);
}
console.log(`   ${reviewGruppen.size} distinct Bezeichnungen, ${review.length} Zeilen\n`);
for (const [, g] of [...reviewGruppen].sort((a, b) => b[1].anzahl - a[1].anzahl)) {
  const fehlt: string[] = [];
  if (!g.z.hersteller)            fehlt.push("Hersteller");
  if (g.z.modelle.length === 0)  fehlt.push("Modell");
  if (!g.z.teiltyp)              fehlt.push("Teiltyp");
  console.log(`   ${String(g.anzahl).padStart(4)}×  "${g.bsp}"`);
  console.log(`         fehlt: ${fehlt.join(", ") || "—"}  |  erkannt: H=${g.z.hersteller ?? "?"} M=[${g.z.modelle.join(", ") || "?"}] T=${g.z.teiltyp ?? "?"}`);
}

console.log(`\n${line()}`);
console.log(`  Ende Trockenlauf — NICHTS in die DB geschrieben.`);
console.log(`${line()}\n`);

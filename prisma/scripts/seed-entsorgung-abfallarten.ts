/**
 * Seed: Abfallarten für Schrottabholung und Batterietransport.
 *
 * Ausführung:
 *   npx tsx prisma/scripts/seed-entsorgung-abfallarten.ts
 *
 * Idempotent: upsert auf die Bezeichnung, bestehende Einträge bleiben
 * unverändert (update: {}). Kurzform, Tara und Sortierung sind danach im
 * Formular änderbar — ein Seed-Lauf darf eine Handkorrektur nicht zurückdrehen.
 *
 * ⚠️ Eine Schlüsselnummer kann MEHRERE Abfallarten tragen:
 *   16 02 13 → Elektronikschrott gemischt UND Laptop ohne Akku
 *   17 04 11 → Kabel mit Stecker UND Kabel ohne Stecker
 * Die Kurzformen sind deshalb so gewählt, dass sie unterscheidbar bleiben.
 * Stünde bei beiden Kabel-Arten nur "Kabel", könnte in der fertigen
 * Auftragstabelle niemand mehr sehen, was im Behälter liegt.
 */
import { PrismaClient, EntsorgungBereich } from "@prisma/client";

const prisma = new PrismaClient();

/** Leergewicht der Gitterbox — in den Schrott-Altdaten durchgängig 85 kg. */
const TARA_GITTERBOX = 85;

const ARTEN = [
  // ── Schrottabholung (Quelle: Abfallarten.xlsx, AfB Sömmerda) ────────────
  { bereich: EntsorgungBereich.SCHROTT, bezeichnung: "Netzteile, (Notebook) mit Kabel", kurzform: "ext. Netzt.",    schluessel: "160216", taraKg: TARA_GITTERBOX, sortierung: 10 },
  { bereich: EntsorgungBereich.SCHROTT, bezeichnung: "Dockingstations",                 kurzform: "Docking",        schluessel: "160214", taraKg: TARA_GITTERBOX, sortierung: 20 },
  { bereich: EntsorgungBereich.SCHROTT, bezeichnung: "Elektronikschrott IT gemischt",   kurzform: "Elektr. gem.",   schluessel: "160213", taraKg: TARA_GITTERBOX, sortierung: 30 },
  { bereich: EntsorgungBereich.SCHROTT, bezeichnung: "Laptop ohne Akku, mit Display",   kurzform: "Laptop o. Akku", schluessel: "160213", taraKg: TARA_GITTERBOX, sortierung: 40 },
  { bereich: EntsorgungBereich.SCHROTT, bezeichnung: "Kabel, sortiert, ohne Stecker",   kurzform: "Kabel o. St.",   schluessel: "170411", taraKg: TARA_GITTERBOX, sortierung: 50 },
  { bereich: EntsorgungBereich.SCHROTT, bezeichnung: "Kabel, sortiert, mit Stecker",    kurzform: "Kabel m. St.",   schluessel: "170411", taraKg: TARA_GITTERBOX, sortierung: 60 },
  { bereich: EntsorgungBereich.SCHROTT, bezeichnung: "Mischschrott",                    kurzform: "Mischschrott",   schluessel: "170405", taraKg: TARA_GITTERBOX, sortierung: 70 },

  // ── Batterietransport ───────────────────────────────────────────────────
  // Schlüssel wie vorgegeben. Das Leergewicht des Fasses ist NICHT bekannt und
  // bleibt deshalb leer — dann rechnet das Formular kein Netto vor, statt eine
  // Zahl zu erfinden. Sobald ein Fass gewogen ist, im Formular nachtragen.
  { bereich: EntsorgungBereich.BATTERIE, bezeichnung: "Bleibatterien",                   kurzform: "Blei",   schluessel: "160601", taraKg: null, sortierung: 10 },
  { bereich: EntsorgungBereich.BATTERIE, bezeichnung: "Nickel-Cadmium-Batterien",        kurzform: "Ni-Cd",  schluessel: "160602", taraKg: null, sortierung: 20 },
  { bereich: EntsorgungBereich.BATTERIE, bezeichnung: "Quecksilberhaltige Batterien",    kurzform: "Hg",     schluessel: "160603", taraKg: null, sortierung: 30 },
];

async function main() {
  let neu = 0, vorhanden = 0;
  for (const a of ARTEN) {
    const r = await prisma.entsorgungAbfallart.upsert({
      where:  { bezeichnung: a.bezeichnung },
      update: {},
      create: { ...a, aktiv: true },
    });
    if (r.erstelltAm.getTime() > Date.now() - 5_000) neu++; else vorhanden++;
  }
  console.log(`[seed-entsorgung] ${neu} angelegt, ${vorhanden} bereits vorhanden.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

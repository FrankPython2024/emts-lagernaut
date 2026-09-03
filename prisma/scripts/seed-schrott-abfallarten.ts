/**
 * Seed: Abfallarten für die Schrott-Erfassung.
 *
 * Ausführung:
 *   npx tsx prisma/scripts/seed-schrott-abfallarten.ts
 *
 * Idempotent: upsert auf die Bezeichnung. Bestehende Einträge bleiben
 * unverändert (update: {}) — Kurzform, Tara und Sortierung sind danach im
 * Admin-UI änderbar, und ein Seed-Lauf darf eine Handkorrektur nicht
 * zurückdrehen.
 *
 * Quelle: „Abfallarten.xlsx" (AfB Sömmerda). Die dortige Doppelzeile
 * „Netzteile, (Notebook) mit Kabel" ist hier nur einmal enthalten.
 *
 * ⚠️ Eine Schlüsselnummer kann MEHRERE Abfallarten tragen:
 *   16 02 13 → Elektronikschrott IT gemischt UND Laptop ohne Akku
 *   17 04 11 → Kabel mit Stecker UND Kabel ohne Stecker
 * Deshalb sind die Kurzformen so gewählt, dass sie unterscheidbar bleiben.
 * Stünde bei beiden Kabel-Arten nur „Kabel", könnte in der fertigen
 * Auftragstabelle niemand mehr sehen, was im Colli liegt.
 *
 * Tara: In den Altdaten war Brutto minus Netto durchgängig 85 kg — das
 * Leergewicht der Gitterbox. Steht als Vorschlag drin, ist beim Erfassen
 * überschreibbar.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TARA_GITTERBOX = 85;

const ARTEN = [
  { bezeichnung: "Netzteile, (Notebook) mit Kabel", kurzform: "ext. Netzt.",    schluessel: "160216", sortierung: 10 },
  { bezeichnung: "Dockingstations",                 kurzform: "Docking",        schluessel: "160214", sortierung: 20 },
  { bezeichnung: "Elektronikschrott IT gemischt",   kurzform: "Elektr. gem.",   schluessel: "160213", sortierung: 30 },
  { bezeichnung: "Laptop ohne Akku, mit Display",   kurzform: "Laptop o. Akku", schluessel: "160213", sortierung: 40 },
  { bezeichnung: "Kabel, sortiert, ohne Stecker",   kurzform: "Kabel o. St.",   schluessel: "170411", sortierung: 50 },
  { bezeichnung: "Kabel, sortiert, mit Stecker",    kurzform: "Kabel m. St.",   schluessel: "170411", sortierung: 60 },
  { bezeichnung: "Mischschrott",                    kurzform: "Mischschrott",   schluessel: "170405", sortierung: 70 },
];

async function main() {
  let neu = 0, vorhanden = 0;
  for (const a of ARTEN) {
    const r = await prisma.schrottAbfallart.upsert({
      where:  { bezeichnung: a.bezeichnung },
      update: {},
      create: { ...a, taraKg: TARA_GITTERBOX, aktiv: true },
    });
    if (r.erstelltAm.getTime() > Date.now() - 5_000) neu++; else vorhanden++;
  }
  console.log(`[seed-schrott] ${neu} angelegt, ${vorhanden} bereits vorhanden.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

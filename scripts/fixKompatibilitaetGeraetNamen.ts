/**
 * Repair: Kompatibilitaet.geraet normalisieren
 *
 * Problem: einlagern.execute() speicherte Kompatibilitaet mit geraet="EliteBook 840 G5"
 * (kein Hersteller-Prefix), während der Artikel-Generator "HP EliteBook 840 G5" verwendet.
 * Das führt zu doppelten Einträgen für dieselbe Teiltyp-Kombination — einer mit
 * bestand>0 (Einlager), einer mit bestand=0 (Generator). Der Techniker-Lookup
 * zeigt dann fälschlich "kein Bestand".
 *
 * Fix: Für jeden Eintrag ohne bekannten Hersteller-Prefix den kanonischen Namen
 * mit Prefix erstellen (upsert). Bei Konflikt gewinnt der Eintrag mit höherem Bestand.
 *
 * Ausführen: npx tsx scripts/fixKompatibilitaetGeraetNamen.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const HERSTELLER = ["HP", "Lenovo", "Dell", "Fujitsu"];

function hatHerstellerPrefix(geraet: string): boolean {
  return HERSTELLER.some((h) => geraet.startsWith(h + " ") || geraet === h);
}

async function main() {
  console.log("=== Kompatibilitaet-Geraet-Repair ===\n");

  // Alle Einträge ohne Hersteller-Prefix laden
  const ohnePrefix = await prisma.kompatibilitaet.findMany({
    include: { artikel: { select: { bestand: true } } },
  });

  const kandidaten = ohnePrefix.filter((e) => !hatHerstellerPrefix(e.geraet));
  console.log(`Gefunden: ${ohnePrefix.length} total, ${kandidaten.length} ohne Prefix\n`);

  if (kandidaten.length === 0) {
    console.log("Nichts zu reparieren. Alle Einträge haben bereits Hersteller-Prefix.");
    return;
  }

  let fixed   = 0;
  let skipped = 0;
  let noModell = 0;

  for (const e of kandidaten) {
    // GeraeteModell für diesen geraet-String finden (exakter Match auf modell-Feld)
    const modell = await prisma.geraeteModell.findFirst({
      where: { modell: e.geraet },
      select: { hersteller: true, modell: true },
    });

    if (!modell) {
      console.log(`  [SKIP] "${e.geraet}" + "${e.teiltyp}" — kein GeraeteModell gefunden`);
      noModell++;
      continue;
    }

    const geraetVoll = `${modell.hersteller} ${modell.modell}`;

    // Prüfen ob es bereits einen kanonischen Eintrag gibt
    const existing = await prisma.kompatibilitaet.findUnique({
      where:   { geraet_teiltyp: { geraet: geraetVoll, teiltyp: e.teiltyp } },
      include: { artikel: { select: { bestand: true } } },
    });

    // Kanonischen Eintrag nur anlegen/überschreiben wenn kein Eintrag existiert
    // ODER der bestehende Eintrag weniger Bestand hat (Einlager-Artikel gewinnt)
    if (!existing || e.artikel.bestand > existing.artikel.bestand) {
      await prisma.kompatibilitaet.upsert({
        where:  { geraet_teiltyp: { geraet: geraetVoll, teiltyp: e.teiltyp } },
        create: { geraet: geraetVoll, teiltyp: e.teiltyp, artikelId: e.artikelId },
        update: { artikelId: e.artikelId },
      });
      const action = existing ? "UPDATED" : "CREATED";
      console.log(`  [${action}] "${e.geraet}" → "${geraetVoll}" + "${e.teiltyp}" (bestand: ${e.artikel.bestand})`);
      fixed++;
    } else {
      console.log(`  [SKIP]  "${e.geraet}" + "${e.teiltyp}" — bestehender Eintrag hat mehr Bestand (${existing.artikel.bestand} >= ${e.artikel.bestand})`);
      skipped++;
    }
  }

  console.log(`\n=== Ergebnis ===`);
  console.log(`  Repariert:   ${fixed}`);
  console.log(`  Übersprungen: ${skipped}`);
  console.log(`  Kein Modell: ${noModell}`);
  console.log("\nHinweis: Die alten Einträge ohne Prefix wurden NICHT gelöscht (sicher,");
  console.log("da findMatchingGeraete() sie via reverseHits weiterhin findet).");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

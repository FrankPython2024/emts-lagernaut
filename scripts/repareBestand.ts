/**
 * Bestand-Konsistenz-Check und Reparatur.
 *
 * Berechnet für jeden Artikel den korrekten Bestand aus der Buchungshistorie
 * (EINGANG summiert, AUSGANG subtrahiert, DIREKT ignoriert) und korrigiert
 * Artikel.bestand-Felder die davon abweichen.
 *
 * Ausführen: npx ts-node scripts/repareBestand.ts
 * Nur anzeigen (kein Schreiben): npx ts-node scripts/repareBestand.ts --dry-run
 */

import { PrismaClient, BuchungsTyp } from "@prisma/client";

const prisma  = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");

async function berechneBestandAusHistorie(artikelId: number): Promise<number> {
  const buchungen = await prisma.buchung.findMany({
    where: {
      artikelId,
      typ: { in: [BuchungsTyp.EINGANG, BuchungsTyp.AUSGANG] }, // DIREKT wird ignoriert!
    },
    select: { typ: true, menge: true },
  });

  return buchungen.reduce((summe, b) => {
    if (b.typ === BuchungsTyp.EINGANG) return summe + b.menge;
    if (b.typ === BuchungsTyp.AUSGANG) return summe - b.menge;
    return summe;
  }, 0);
}

async function main() {
  if (DRY_RUN) {
    console.log("🔍 DRY-RUN Modus — keine Änderungen werden gespeichert\n");
  } else {
    console.log("🔧 Bestand-Reparatur startet…\n");
  }

  const artikel = await prisma.artikel.findMany({
    select: { id: true, bezeichnung: true, bestand: true },
    orderBy: { id: "asc" },
  });

  console.log(`Prüfe ${artikel.length} Artikel…\n`);

  let inkonsistent = 0;
  let repariert    = 0;

  for (const a of artikel) {
    const berechnet = await berechneBestandAusHistorie(a.id);

    if (berechnet !== a.bestand) {
      inkonsistent++;
      const symbol = berechnet < a.bestand ? "📉" : "📈";
      console.log(`${symbol} ID ${a.id}: "${a.bezeichnung}"`);
      console.log(`     DB-Bestand: ${a.bestand}  →  Berechnet: ${berechnet}  (Δ ${berechnet - a.bestand})`);

      if (!DRY_RUN) {
        await prisma.artikel.update({
          where: { id: a.id },
          data:  { bestand: berechnet },
        });
        repariert++;
        console.log(`     ✅ Korrigiert auf ${berechnet}\n`);
      } else {
        console.log(`     ⚠️  Würde auf ${berechnet} korrigiert werden\n`);
      }
    }
  }

  console.log("─".repeat(50));
  if (inkonsistent === 0) {
    console.log("✅ Alle Bestände sind konsistent — kein Handlungsbedarf.");
  } else if (DRY_RUN) {
    console.log(`⚠️  ${inkonsistent} inkonsistente Bestände gefunden.`);
    console.log(`   Reparatur ausführen: npx ts-node scripts/repareBestand.ts`);
  } else {
    console.log(`✅ ${repariert} von ${inkonsistent} Artikeln repariert.`);
  }
}

main()
  .catch((e) => { console.error("Fehler:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());

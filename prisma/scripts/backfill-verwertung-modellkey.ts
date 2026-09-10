/**
 * Modellschlüssel der Verwertungsgeräte neu berechnen.
 *
 * `VerwertungsGeraet.modellKey` wird beim Import berechnet und gespeichert.
 * Ändert sich die Regel dahinter — etwa weil `istMaschinennummer` seit dem
 * 10.09.2026 auch Nummern MIT Bindestrich erkennt („21BS-S49A00") —, tragen
 * die bereits importierten Zeilen weiter den alten Schlüssel und werden über
 * den neuen nicht mehr gefunden.
 *
 * Ein erneuter Import würde dasselbe leisten; dieses Skript geht auch ohne die
 * CSV-Datei und zeigt vorher, was sich ändert.
 *
 * Ausführen (Trockenlauf, schreibt NICHTS):
 *   docker compose exec -T app npx tsx prisma/scripts/backfill-verwertung-modellkey.ts
 *
 * Wirklich schreiben:
 *   docker compose exec -T app npx tsx prisma/scripts/backfill-verwertung-modellkey.ts --schreiben
 */

import { PrismaClient } from "@prisma/client";
import { zerlegeGeraetename, schildSchluessel } from "../../src/lib/geraete/schildName";

const prisma = new PrismaClient();
const SCHREIBEN = process.argv.includes("--schreiben");

async function main(): Promise<void> {
  const geraete = await prisma.verwertungsGeraet.findMany({
    select: { logId: true, hersteller: true, bezeichnung: true, modellKey: true },
  });
  console.log(`Verwertungsgeräte gesamt: ${geraete.length}`);

  const aenderungen: { logId: string; alt: string; neu: string; name: string }[] = [];
  for (const g of geraete) {
    const neu = schildSchluessel(
      zerlegeGeraetename(g.bezeichnung ?? "", g.hersteller),
    ).slice(0, 191);
    if (neu && neu !== g.modellKey) {
      aenderungen.push({ logId: g.logId, alt: g.modellKey, neu, name: g.bezeichnung ?? "" });
    }
  }

  console.log(`Schlüssel, die sich ändern: ${aenderungen.length}`);
  for (const a of aenderungen.slice(0, 30)) {
    console.log(`  ${a.logId}  ${JSON.stringify(a.name)}`);
    console.log(`      ${a.alt}  →  ${a.neu}`);
  }
  if (aenderungen.length > 30) console.log(`  … und ${aenderungen.length - 30} weitere`);

  if (aenderungen.length === 0) {
    console.log("Nichts zu tun.");
    return;
  }

  if (!SCHREIBEN) {
    console.log("\nTrockenlauf — es wurde nichts geschrieben. Mit --schreiben anwenden.");
    return;
  }

  let n = 0;
  for (const a of aenderungen) {
    await prisma.verwertungsGeraet.update({
      where: { logId: a.logId },
      data: { modellKey: a.neu },
    });
    n++;
  }
  console.log(`\n${n} Schlüssel aktualisiert.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

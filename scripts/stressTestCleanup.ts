#!/usr/bin/env tsx
/**
 * scripts/stressTestCleanup.ts
 *
 * Löscht ALLE Stress-Test-Daten (alle Läufe) — über dieselbe Funktion wie der
 * Knopf auf /admin/system/stresstest (`bereinigeTestdaten`).
 *
 * ⚠️ Die frühere Fassung löschte als „System-Nachrichten der Test-Aktionen"
 * JEDE System-Nachricht ohne LogID — also auch „Teil bereit zur Abholung" an
 * alle echten Techniker. Und sie kannte weder Warenkörbe noch den Bestand.
 *
 * Verwendung:
 *   npm run stresstest:cleanup
 *
 * Einzelnen Run löschen:
 *   STRESS_RUN=123456 npm run stresstest:cleanup
 */

import * as readline from "readline";
import { prisma }    from "../src/core/db/prisma";
import { bereinigeTestdaten, zaehleTestdaten, markerFuer } from "../src/modules/stresstest/testdaten";

const spezifischerRun = process.env.STRESS_RUN;

async function cleanup() {
  const stand = await zaehleTestdaten();

  if (stand.gesamt === 0) {
    console.log("✅ Keine Stresstest-Daten gefunden.");
    await prisma.$disconnect();
    return;
  }

  console.log(`
⚠️  CLEANUP: Folgende Test-Daten werden UNWIDERRUFLICH gelöscht:
   Marker:       "${markerFuer(spezifischerRun)}"${spezifischerRun ? "" : " + Kürzel ST01–ST10 / STA1–STA3"}
   Anfragen:     ${stand.anfragen}
   Buchungen:    ${stand.buchungen}
   Nachrichten:  ${stand.nachrichten}
   Warenkörbe:   ${stand.warenkoerbe}
   (Zahlen über alle Läufe; der Bestand betroffener Artikel wird danach neu berechnet.)
`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const antwort = await new Promise<string>((resolve) => rl.question("Wirklich löschen? [j/N] ", resolve));
  rl.close();

  if (antwort.trim().toLowerCase() !== "j") {
    console.log("Abgebrochen.");
    await prisma.$disconnect();
    return;
  }

  const r = await bereinigeTestdaten(spezifischerRun);
  console.log(`
✅ Cleanup abgeschlossen.
   Anfragen:     ${r.anfragen}
   Buchungen:    ${r.buchungen}
   Nachrichten:  ${r.nachrichten}
   Warenkörbe:   ${r.warenkoerbe}
   Bestand neu:  ${r.bestandNeuBerechnet} Artikel
`);
  await prisma.$disconnect();
}

cleanup().catch((err) => {
  console.error("Fehler beim Cleanup:", err);
  process.exit(1);
});

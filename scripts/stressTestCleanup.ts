#!/usr/bin/env tsx
/**
 * scripts/stressTestCleanup.ts
 *
 * Löscht ALLE Stress-Test-Daten (alle Läufe).
 * Markierung: kommentar/notiz enthält "STRESSTEST"
 *
 * Verwendung:
 *   npm run stresstest:cleanup
 *
 * Einzelnen Run löschen:
 *   STRESS_RUN=123456 npm run stresstest:cleanup
 */

import * as readline from "readline";
import { prisma }    from "../src/core/db/prisma";

const spezifischerRun = process.env.STRESS_RUN;
const MARKER = spezifischerRun ? `STRESSTEST_${spezifischerRun}` : "STRESSTEST";

async function zaehle() {
  const [anfragen, buchungen] = await Promise.all([
    prisma.anfrage.count({ where: { kommentar: { contains: MARKER } } }),
    prisma.buchung.count({ where: { notiz:     { contains: MARKER } } }),
  ]);
  return { anfragen, buchungen };
}

async function cleanup() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const { anfragen, buchungen } = await zaehle();

  if (anfragen === 0 && buchungen === 0) {
    console.log(`✅ Keine Test-Daten mit Marker "${MARKER}" gefunden.`);
    rl.close();
    await prisma.$disconnect();
    return;
  }

  console.log(`
⚠️  CLEANUP: Folgende Test-Daten werden UNWIDERRUFLICH gelöscht:
   Marker:    "${MARKER}"
   Anfragen:  ${anfragen}
   Buchungen: ${buchungen}
`);

  return new Promise<void>((resolve) => {
    rl.question("Wirklich löschen? [j/N] ", async (antwort) => {
      rl.close();

      if (antwort.trim().toLowerCase() !== "j") {
        console.log("Abgebrochen.");
        await prisma.$disconnect();
        resolve();
        return;
      }

      console.log("🗑️  Lösche...");

      // 1. Test-Anfragen sammeln
      const testAnfragen = await prisma.anfrage.findMany({
        where:  { kommentar: { contains: MARKER } },
        select: { id: true },
      });
      const ids = testAnfragen.map((a) => a.id);

      if (ids.length > 0) {
        // 2. Chat-Nachrichten löschen
        const chatLogIds = ids.map((id) => `chat:${id}`);
        const nachrichten = await prisma.nachricht.findMany({
          where:  { logId: { in: chatLogIds } },
          select: { id: true },
        });
        const nachrichtIds = nachrichten.map((n) => n.id);

        if (nachrichtIds.length > 0) {
          await prisma.nachrichtEmpf.deleteMany({ where: { nachrichtId: { in: nachrichtIds } } });
          await prisma.nachrichtAntwort.deleteMany({ where: { nachrichtId: { in: nachrichtIds } } });
          await prisma.nachricht.deleteMany({ where: { id: { in: nachrichtIds } } });
          console.log(`  ✓ ${nachrichtIds.length} Chat-Nachrichten gelöscht`);
        }

        // 3. System-Nachrichten die von Test-Aktionen kamen
        const sysNachrichten = await prisma.nachricht.deleteMany({
          where: { vonKuerzel: { in: ["SYSTEM"] }, logId: null },
        });
        if (sysNachrichten.count > 0) {
          console.log(`  ✓ ${sysNachrichten.count} System-Nachrichten bereinigt`);
        }

        // 4. Anfragen löschen (korbId wird durch onDelete: SetNull automatisch genullt)
        const gelöschteAnfragen = await prisma.anfrage.deleteMany({
          where: { id: { in: ids } },
        });
        console.log(`  ✓ ${gelöschteAnfragen.count} Anfragen gelöscht`);
      }

      // 5. Buchungen löschen
      const gelöschte = await prisma.buchung.deleteMany({
        where: { notiz: { contains: MARKER } },
      });
      console.log(`  ✓ ${gelöschte.count} Buchungen gelöscht`);

      console.log("\n✅ Cleanup abgeschlossen.");
      await prisma.$disconnect();
      resolve();
    });
  });
}

cleanup().catch((err) => {
  console.error("Fehler beim Cleanup:", err);
  process.exit(1);
});

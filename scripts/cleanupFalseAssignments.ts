/**
 * Löscht falsche Kompatibilitäts-Einträge anhand ihrer IDs.
 *
 * Vorbereitung:
 *   1. npx ts-node scripts/findFalseAssignments.ts  → erzeugt false_assignments.csv
 *   2. CSV prüfen, welche IDs tatsächlich falsch sind
 *   3. IDs unten in ZU_LOESCHEN eintragen
 *   4. npx ts-node scripts/cleanupFalseAssignments.ts
 */

import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

try {
  readFileSync(".env.local", "utf-8")
    .split("\n").filter((l) => l.trim() && !l.startsWith("#"))
    .forEach((l) => { const eq = l.indexOf("="); if (eq < 1) return; const k = l.slice(0, eq).trim(); const v = l.slice(eq + 1).trim().replace(/^["']|["']$/g, ""); if (!process.env[k]) process.env[k] = v; });
} catch {}

const prisma = new PrismaClient();

// ── IDs hier eintragen (aus false_assignments.csv) ──────────────────────────
const ZU_LOESCHEN: number[] = [
  // Beispiel: 42, 57, 123
  // Trage die IDs aus der CSV ein:
];
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  if (ZU_LOESCHEN.length === 0) {
    console.log("⚠️  ZU_LOESCHEN ist leer.");
    console.log("    Zuerst findFalseAssignments.ts ausführen und die IDs hier eintragen.");
    return;
  }

  console.log(`🗑️  Lösche ${ZU_LOESCHEN.length} Kompatibilitäts-Einträge: [${ZU_LOESCHEN.join(", ")}]\n`);

  // Vorher zeigen was gelöscht wird
  const vorher = await prisma.kompatibilitaet.findMany({
    where:   { id: { in: ZU_LOESCHEN } },
    include: { artikel: { select: { bezeichnung: true } } },
  });

  for (const e of vorher) {
    console.log(`  ID ${e.id}: "${e.geraet}" + "${e.teiltyp}" → "${e.artikel.bezeichnung}"`);
  }

  if (vorher.length !== ZU_LOESCHEN.length) {
    console.warn(`\n⚠️  ${ZU_LOESCHEN.length - vorher.length} IDs nicht gefunden — möglicherweise bereits gelöscht.`);
  }

  console.log("\n🗑️  Lösche...");
  const result = await prisma.kompatibilitaet.deleteMany({
    where: { id: { in: ZU_LOESCHEN } },
  });

  console.log(`\n✅ ${result.count} Einträge gelöscht.`);
  console.log("\nTipp: Ggf. autoVerknuepfung() für die betroffenen Modelle erneut ausführen.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

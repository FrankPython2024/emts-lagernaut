/**
 * Findet verdächtige Kompatibilitäts-Einträge wo der Gerätename
 * nicht mit dem Artikel-Namen übereinstimmt.
 *
 * Ausführen: npx ts-node scripts/findFalseAssignments.ts
 * Output:    false_assignments.csv
 */

import { readFileSync, writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

try {
  readFileSync(".env.local", "utf-8")
    .split("\n").filter((l) => l.trim() && !l.startsWith("#"))
    .forEach((l) => { const eq = l.indexOf("="); if (eq < 1) return; const k = l.slice(0, eq).trim(); const v = l.slice(eq + 1).trim().replace(/^["']|["']$/g, ""); if (!process.env[k]) process.env[k] = v; });
} catch {}

const prisma = new PrismaClient();

async function main() {
  console.log("🔍 Suche nach verdächtigen Kompatibilitäts-Einträgen…\n");

  const eintraege = await prisma.kompatibilitaet.findMany({
    include: {
      artikel: { select: { id: true, bezeichnung: true, kategorie: true, bestand: true } },
    },
    orderBy: { geraet: "asc" },
  });

  console.log(`Gesamt: ${eintraege.length} Kompatibilitäts-Einträge\n`);

  const verdaechtig: { id: number; geraet: string; teiltyp: string; bezeichnung: string; grund: string }[] = [];

  for (const e of eintraege) {
    const bezeichnung = e.artikel.bezeichnung;
    const geraetLow   = e.geraet.toLowerCase();
    const bezLow      = bezeichnung.toLowerCase();

    // Alter Stil: Artikel-Name = nur Teiltyp (z.B. "Tastatur") ohne Gerätename
    const alterStil = bezLow === e.teiltyp.toLowerCase();

    // Falscher Gerätename: Artikel-Name enthält anderen Gerätennamen
    // Methode: Artikel-Name beginnt NICHT mit dem Gerätenamen und ist kein reiner Teiltyp
    const startsMitGerät = bezLow.startsWith(geraetLow);
    const querGerät      = !alterStil && !startsMitGerät;

    if (alterStil) {
      verdaechtig.push({
        id:         e.id,
        geraet:     e.geraet,
        teiltyp:    e.teiltyp,
        bezeichnung,
        grund: `Alter Stil: Artikel "${bezeichnung}" hat kein Gerät im Namen (sollte "${e.geraet} ${e.teiltyp}" heißen)`,
      });
    } else if (querGerät) {
      verdaechtig.push({
        id:         e.id,
        geraet:     e.geraet,
        teiltyp:    e.teiltyp,
        bezeichnung,
        grund: `Cross-Device: Gerät "${e.geraet}" aber Artikel "${bezeichnung}"`,
      });
    }
  }

  if (verdaechtig.length === 0) {
    console.log("✅ Keine verdächtigen Einträge gefunden — Daten sind konsistent.");
    return;
  }

  console.log(`⚠️  ${verdaechtig.length} verdächtige Einträge:\n`);

  const lines = ["ID,Gerät,Teiltyp,Artikel-Bezeichnung,Grund"];

  for (const v of verdaechtig) {
    console.log(`  ID ${v.id}: "${v.geraet}" + "${v.teiltyp}" → "${v.bezeichnung}"`);
    console.log(`          ${v.grund}\n`);
    const safeGrund = v.grund.replace(/"/g, "'");
    lines.push(`${v.id},"${v.geraet}","${v.teiltyp}","${v.bezeichnung}","${safeGrund}"`);
  }

  const csvPath = "false_assignments.csv";
  writeFileSync(csvPath, lines.join("\n"), "utf-8");

  console.log(`\n📄 CSV gespeichert: ${csvPath}`);
  console.log(`\nNächster Schritt:`);
  console.log(`  1. Öffne false_assignments.csv`);
  console.log(`  2. Prüfe welche Einträge wirklich falsch sind`);
  console.log(`  3. Trage die IDs in scripts/cleanupFalseAssignments.ts ein`);
  console.log(`  4. npx ts-node scripts/cleanupFalseAssignments.ts`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

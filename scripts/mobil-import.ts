// ── Mobil-Ersatzteile — CLI-Import ───────────────────────────────────────────
//
// Liest eine CSV (Pfad als Argument) und ruft runMobilImport() auf — DIESELBE
// Logik wie der tRPC-Endpunkt (keine Duplikat-Logik hier).
//
// Aufruf im app-Container:
//   docker compose exec app npx tsx scripts/mobil-import.ts <csvPfad> [--dry]
//
//   --dry  → parst + zeigt den vollen Bericht, schreibt aber NICHTS in die DB
//            (Sicherheits-Vorschau direkt gegen die echte DB-Umgebung).
//
// Ohne --dry wird wirklich importiert (idempotenter Upsert je LogID).

import { readFileSync } from "fs";
import { prisma } from "@/core/db/prisma";
import { runMobilImport, type MobilImportBericht } from "@/modules/mobil/import";

// .env.local als Fallback laden (lokaler Lauf ohne Container-Env). Im Container
// ist DATABASE_URL bereits gesetzt → dieser Block ist dann ein No-Op.
try {
  readFileSync(".env.local", "utf-8")
    .split("\n").filter((l) => l.trim() && !l.startsWith("#"))
    .forEach((l) => { const eq = l.indexOf("="); if (eq < 1) return; const k = l.slice(0, eq).trim(); const v = l.slice(eq + 1).trim().replace(/^["']|["']$/g, ""); if (!process.env[k]) process.env[k] = v; });
} catch {}

function berichtAusgeben(b: MobilImportBericht, dry: boolean) {
  const line = "═".repeat(60);
  console.log(`\n${line}`);
  console.log(`  MOBIL-IMPORT — ${dry ? "TROCKENLAUF (nichts geschrieben)" : "ECHT-LAUF"}`);
  console.log(line);
  const z = (n: number) => String(n).padStart(6);
  console.log(`  importiertGesamt   ${z(b.importiertGesamt)}`);
  console.log(`  ├─ erkannt          ${z(b.erkannt)}   (davon mehrfachModell ${b.mehrfachModell})`);
  console.log(`  └─ review           ${z(b.review)}`);
  console.log(`  ${dry ? "würde neu" : "neu"}           ${z(b.neu)}`);
  console.log(`  ${dry ? "würde aktual." : "aktualisiert"}        ${z(b.aktualisiert)}   (manuellGeschuetzt ${b.manuellGeschuetzt})`);
  console.log(`  uebersprungen      ${z(b.uebersprungen)}   (Zeilen ohne LogID)`);
  console.log(`  ${dry ? "würde neue Modelle" : "neue Modelle"}   ${z(b.neueModelle)}`);
  console.log(`  ${dry ? "würde neue Teiltypen" : "neue Teiltypen"} ${z(b.neueTeiltypen)}`);
  console.log(`${line}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const dry  = args.includes("--dry");
  const pfad = args.find((a) => !a.startsWith("--"));

  if (!pfad) {
    console.error("\n❌ Kein CSV-Pfad angegeben.");
    console.error("   Aufruf: npx tsx scripts/mobil-import.ts <csvPfad> [--dry]\n");
    process.exit(1);
  }

  let csvText: string;
  try {
    csvText = readFileSync(pfad, "utf8");
  } catch {
    console.error(`\n❌ Datei nicht lesbar: ${pfad}\n`);
    process.exit(1);
  }

  if (dry) console.log("\n🔎 TROCKENLAUF — es wird NICHTS in die Datenbank geschrieben.");
  const bericht = await runMobilImport(csvText, { dryRun: dry });
  berichtAusgeben(bericht, dry);
}

main()
  .catch((e) => { console.error("\n❌ FEHLER:", e instanceof Error ? e.message : e); process.exit(1); })
  .finally(() => prisma.$disconnect());

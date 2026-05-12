/**
 * ⚠️  LAGERNAUT RESET — löscht alle Lager-Daten, behält User + GeraeteLookup.
 *
 * Ausführen (im Docker-Container, mit Terminal-Eingabe):
 *   docker compose exec -it app npx tsx scripts/resetLagernaut.ts
 *
 * Was GELÖSCHT wird:
 *   Anfragen, Buchungen, Warenkörbe, Artikel, Kompatibilitäten,
 *   Nachrichten, TechnikerSessions, StressTest-History, Redis Beleg-Counter
 *
 * Was BLEIBT:
 *   User, GeraeteLookup (49.821 Geräte!), GeraeteModell, LagerplatzConfig
 */

import { readFileSync } from "fs";
import * as readline     from "readline";
import { PrismaClient }  from "@prisma/client";

try {
  readFileSync(".env.local", "utf-8")
    .split("\n").filter((l) => l.trim() && !l.startsWith("#"))
    .forEach((l) => { const eq = l.indexOf("="); if (eq < 1) return; const k = l.slice(0, eq).trim(); const v = l.slice(eq + 1).trim().replace(/^["']|["']$/g, ""); if (!process.env[k]) process.env[k] = v; });
} catch {}

const prisma = new PrismaClient();

function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (a) => { rl.close(); resolve(a); }));
}

async function main() {
  console.log("\n⚠️  LAGERNAUT RESET — ALLE LAGER-DATEN LÖSCHEN");
  console.log("═".repeat(48));
  console.log("\nWas GELÖSCHT wird:");
  console.log("  ❌ Alle Anfragen + Chats");
  console.log("  ❌ Alle Buchungen");
  console.log("  ❌ Alle Warenkörbe + Items");
  console.log("  ❌ Alle Artikel + Bestände");
  console.log("  ❌ Alle Kompatibilitäts-Verknüpfungen");
  console.log("  ❌ Alle Nachrichten");
  console.log("  ❌ Alle TechnikerSessions");
  console.log("  ❌ Alle StressTest-History");
  console.log("  ❌ Redis Beleg-Counter (Nummernkreise)");
  console.log("\nWas BLEIBT:");
  console.log("  ✅ User + Passwörter");
  console.log("  ✅ GeraeteLookup (49.821 Geräte!)");
  console.log("  ✅ GeraeteModell-Liste");
  console.log("  ✅ LagerplatzConfig");

  // Aktuellen Stand anzeigen
  const [a, b, an, k, w, n] = await Promise.all([
    prisma.artikel.count(),
    prisma.buchung.count(),
    prisma.anfrage.count(),
    prisma.kompatibilitaet.count(),
    prisma.warenkorb.count(),
    prisma.nachricht.count(),
  ]);
  console.log(`\nAktuell in DB:`);
  console.log(`  Artikel:          ${a}`);
  console.log(`  Buchungen:        ${b}`);
  console.log(`  Anfragen:         ${an}`);
  console.log(`  Kompatibilitäten: ${k}`);
  console.log(`  Warenkörbe:       ${w}`);
  console.log(`  Nachrichten:      ${n}`);

  console.log("");
  const answer = await ask('Zum Bestätigen "RESET" eingeben (oder Enter für Abbruch): ');

  if (answer.trim() !== "RESET") {
    console.log("\n❌ Abgebrochen — nichts gelöscht.\n");
    process.exit(0);
  }

  console.log("\n🗑️  Lösche Daten...\n");

  // ── Lösch-Reihenfolge strikt nach Foreign-Key-Abhängigkeiten ──────────────
  const r = await prisma.$transaction(async (tx) => {
    const nachrichtAntworten = await tx.nachrichtAntwort.deleteMany();
    process.stdout.write(`  ✓ ${nachrichtAntworten.count} Nachricht-Antworten\n`);

    const nachrichtEmpf = await tx.nachrichtEmpf.deleteMany();
    process.stdout.write(`  ✓ ${nachrichtEmpf.count} Nachricht-Empfänger\n`);

    const nachrichten = await tx.nachricht.deleteMany();
    process.stdout.write(`  ✓ ${nachrichten.count} Nachrichten\n`);

    // Anfragen vor Artikel löschen (FK: artikelId → Artikel.id ohne onDelete)
    const anfragen = await tx.anfrage.deleteMany();
    process.stdout.write(`  ✓ ${anfragen.count} Anfragen\n`);

    // WarenkorbItems vor Warenkorb und Artikel löschen
    const korbItems = await tx.warenkorbItem.deleteMany();
    process.stdout.write(`  ✓ ${korbItems.count} Warenkorb-Items\n`);

    const koerbe = await tx.warenkorb.deleteMany();
    process.stdout.write(`  ✓ ${koerbe.count} Warenkörbe\n`);

    // Buchungen vor Artikel löschen (FK: artikelId → Artikel.id)
    const buchungen = await tx.buchung.deleteMany();
    process.stdout.write(`  ✓ ${buchungen.count} Buchungen\n`);

    // Kompatibilitäten vor Artikel löschen (FK: artikelId → Artikel.id)
    const komps = await tx.kompatibilitaet.deleteMany();
    process.stdout.write(`  ✓ ${komps.count} Kompatibilitäts-Einträge\n`);

    // Artikel zuletzt (alle FKs darauf sind jetzt weg)
    const artikel = await tx.artikel.deleteMany();
    process.stdout.write(`  ✓ ${artikel.count} Artikel\n`);

    // Standalone-Tabellen
    const sessions = await tx.technikerSession.deleteMany();
    process.stdout.write(`  ✓ ${sessions.count} TechnikerSessions\n`);

    const stresstests = await tx.stressTestRun.deleteMany();
    process.stdout.write(`  ✓ ${stresstests.count} StressTest-History\n`);

    return { anfragen, buchungen, komps, artikel, nachrichten, korbItems, koerbe };
  }, { timeout: 60_000 });

  // Redis Beleg-Counter zurücksetzen
  try {
    const { default: Redis } = await import("ioredis");
    const redis = new Redis(process.env.REDIS_URL ?? "redis://redis:6379");
    const belegKeys = await redis.keys("beleg:*");
    if (belegKeys.length > 0) {
      await redis.del(...belegKeys);
      process.stdout.write(`  ✓ ${belegKeys.length} Redis Beleg-Counter zurückgesetzt\n`);
    }
    await redis.quit();
  } catch {
    process.stdout.write("  ⚠️  Redis Reset übersprungen (nicht erreichbar)\n");
  }

  console.log("\n" + "═".repeat(48));
  console.log("✅ RESET ABGESCHLOSSEN!\n");
  console.log(`  ${r.artikel.count} Artikel gelöscht`);
  console.log(`  ${r.buchungen.count} Buchungen gelöscht`);
  console.log(`  ${r.anfragen.count} Anfragen gelöscht`);
  console.log(`  ${r.komps.count} Kompatibilitäten gelöscht`);
  console.log("\nLagernaut ist bereit für einen frischen Start.");
  console.log("Nächster Schritt: Artikel einlagern via /admin/einlagern\n");
}

main()
  .catch((e) => { console.error("\n❌ FEHLER:", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());

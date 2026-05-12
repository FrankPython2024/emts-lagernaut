/**
 * Wendet Hersteller-Filter + neue Bezeichnung-Bereinigung auf ALLE
 * bestehenden GeraeteLookup-Einträge an.
 *
 * Was passiert:
 *   • Hersteller aus bereinigt-Feld (erstes Wort) extrahieren
 *   • Nicht-erlaubte Hersteller (Apple, ASUS, etc.) löschen
 *   • Tippfehler normalisieren ("HPö" → "HP", "Fujjtsu" → "Fujitsu")
 *   • Bezeichnung mit neuer Logik neu bereinigen
 *
 * Ausführen: docker compose exec -it app npm run reprocess:geraete
 */

import { readFileSync } from "fs";
import * as readline    from "readline";
import { PrismaClient } from "@prisma/client";
import { normalisiereHersteller, ERLAUBTE_HERSTELLER_LISTE } from "@/lib/geraete/herstellerFilter";
import { bereinigeBezeichnung } from "@/lib/geraete/bezeichnungBereinigen";

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
  console.log("\n🔍 Lade alle GeraeteLookup-Einträge...");
  const alle = await prisma.geraeteLookup.findMany({
    select: { id: true, bereinigt: true, bezeichnung: true },
    orderBy: { id: "asc" },
  });
  console.log(`   Gefunden: ${alle.length.toLocaleString("de-DE")} Einträge\n`);

  type Update = { id: number; bereinigt: string; grund: string };
  const updates: Update[] = [];
  const deletes: number[] = [];
  let unveraendert = 0;

  const skipPerHersteller = new Map<string, number>();

  for (const g of alle) {
    // Hersteller = erstes Wort des bereinigt-Feldes
    const rawHersteller  = g.bereinigt.split(" ")[0] ?? "";
    const normHersteller = normalisiereHersteller(rawHersteller);

    if (!normHersteller) {
      deletes.push(g.id);
      skipPerHersteller.set(rawHersteller, (skipPerHersteller.get(rawHersteller) ?? 0) + 1);
      continue;
    }

    const cleanModel   = bereinigeBezeichnung(normHersteller, g.bezeichnung);
    const neuesBereinigt = `${normHersteller} ${cleanModel}`;

    if (normHersteller !== rawHersteller || neuesBereinigt !== g.bereinigt) {
      updates.push({
        id:       g.id,
        bereinigt: neuesBereinigt,
        grund:    normHersteller !== rawHersteller
          ? `Hersteller: "${rawHersteller}" → "${normHersteller}"`
          : `Bezeichnung: "${g.bereinigt}" → "${neuesBereinigt}"`,
      });
    } else {
      unveraendert++;
    }
  }

  // Statistik
  console.log("📊 ANALYSE:");
  console.log(`   Unverändert:     ${unveraendert.toLocaleString("de-DE")}`);
  console.log(`   Zu aktualisieren: ${updates.length.toLocaleString("de-DE")}`);
  console.log(`   Zu löschen:      ${deletes.length.toLocaleString("de-DE")} (nicht-erlaubte Hersteller)`);

  if (deletes.length > 0 && skipPerHersteller.size > 0) {
    console.log("\n   Zu löschende Hersteller:");
    const sorted = [...skipPerHersteller].sort((a, b) => b[1] - a[1]).slice(0, 15);
    for (const [h, c] of sorted)
      console.log(`     ${c.toLocaleString("de-DE").padStart(8)}× ${h}`);
  }

  if (updates.length > 0) {
    console.log("\n   Beispiel-Korrekturen (erste 10):");
    for (const u of updates.slice(0, 10))
      console.log(`     ${u.grund}`);
    if (updates.length > 10) console.log(`     ... und ${updates.length - 10} weitere`);
  }

  if (updates.length === 0 && deletes.length === 0) {
    console.log("\n✅ Datenbank ist bereits sauber — kein Handlungsbedarf.");
    return;
  }

  console.log("");
  const answer = await ask('Zum Fortfahren "REPROCESS" eingeben (oder Enter zum Abbrechen): ');
  if (answer.trim() !== "REPROCESS") {
    console.log("\n❌ Abgebrochen — nichts geändert.\n");
    process.exit(0);
  }

  console.log("");

  // Updates
  if (updates.length > 0) {
    console.log(`🔄 Aktualisiere ${updates.length} Einträge...`);
    let count = 0;
    for (const u of updates) {
      await prisma.geraeteLookup.update({
        where: { id: u.id },
        data:  { bereinigt: u.bereinigt },
      });
      count++;
      if (count % 500 === 0) console.log(`   Update: ${count}/${updates.length}`);
    }
    console.log(`   ✅ ${updates.length} Einträge aktualisiert`);
  }

  // Deletes in Batches
  if (deletes.length > 0) {
    console.log(`\n🗑️  Lösche ${deletes.length} Einträge (nicht-erlaubte Hersteller)...`);
    const batchSize = 1_000;
    let count = 0;
    for (let i = 0; i < deletes.length; i += batchSize) {
      const batch = deletes.slice(i, i + batchSize);
      await prisma.geraeteLookup.deleteMany({ where: { id: { in: batch } } });
      count += batch.length;
      console.log(`   Gelöscht: ${count}/${deletes.length}`);
    }
    console.log(`   ✅ ${deletes.length} Einträge gelöscht`);
  }

  const final = await prisma.geraeteLookup.count();
  console.log(`\n✅ FERTIG! ${final.toLocaleString("de-DE")} Geräte in DB`);
  console.log("   Erlaubte Hersteller:", ERLAUBTE_HERSTELLER_LISTE.join(", "), "\n");
}

main()
  .catch((e) => { console.error("\n❌ FEHLER:", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());

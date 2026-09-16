/**
 * Geräte aus dem Lagerfuchs (`LogIdStand`) in `GeraeteLookup` nachtragen.
 *
 * Wozu: Das Techniker-Portal löst eine gescannte LogID über `GeraeteLookup` auf.
 * Gefüllt wird die Tabelle nur über den Geräte-Import (CSV-Upload). Wird ein
 * Hersteller erst später freigeschaltet — Microsoft/Surface am 16.09.2026 —,
 * fehlen ALLE seiner Geräte dort, obwohl sie im Lagerfuchs längst stehen: Die
 * LogID war „nicht gefunden", eine Ersatzteil-Anfrage unmöglich.
 *
 * Dieses Skript holt das ohne erneuten CSV-Upload nach. Es nimmt dieselben
 * Regeln wie der Import:
 *   • nur Geräteart „Notebook" (Zubehör bleibt draußen — sonst würden
 *     Dockingstationen und Stifte zu Gerätemodellen; am 16.09.2026 waren das
 *     1.634 von 3.373 Microsoft-Zeilen)
 *   • Hersteller-Whitelist über `checkHersteller`
 *   • Name über `bereinigeBezeichnung`, LogID ohne Punkte als `logIdClean`
 *
 * Vorhandene Einträge werden NICHT angefasst — das Skript trägt nur nach.
 *
 * Ausführen (Trockenlauf, schreibt NICHTS):
 *   docker compose exec -T app npx tsx prisma/scripts/backfill-geraete-lookup.ts
 *   docker compose exec -T app npx tsx prisma/scripts/backfill-geraete-lookup.ts --hersteller Microsoft
 *
 * Wirklich schreiben:
 *   docker compose exec -T app npx tsx prisma/scripts/backfill-geraete-lookup.ts --hersteller Microsoft --schreiben
 */

import { PrismaClient } from "@prisma/client";
import { checkHersteller } from "../../src/lib/geraete/herstellerFilter";
import { bereinigeBezeichnung } from "../../src/lib/geraete/bezeichnungBereinigen";

const prisma    = new PrismaClient();
const SCHREIBEN = process.argv.includes("--schreiben");
const hPos      = process.argv.indexOf("--hersteller");
const NUR_HERSTELLER = hPos >= 0 ? process.argv[hPos + 1] ?? null : null;
const GERAETEART = "Notebook";

function logIdNormalize(logId: string): string {
  return logId.replace(/\./g, "").trim();
}

async function main(): Promise<void> {
  console.log("═══ GeraeteLookup nachtragen ═══");
  console.log(`  Geräteart: ${GERAETEART}${NUR_HERSTELLER ? ` · Hersteller: ${NUR_HERSTELLER}` : " · alle erlaubten Hersteller"}`);
  console.log(`  Modus: ${SCHREIBEN ? "SCHREIBEN" : "TROCKENLAUF (schreibt nichts)"}`);

  const rows = await prisma.logIdStand.findMany({
    where: {
      geraeteart: GERAETEART,
      ...(NUR_HERSTELLER ? { hersteller: NUR_HERSTELLER } : {}),
    },
    select: { logId: true, hersteller: true, bezeichnung: true },
  });
  console.log(`\n  Zeilen im Lagerfuchs: ${rows.length.toLocaleString("de-DE")}`);

  const vorhanden = new Set(
    (await prisma.geraeteLookup.findMany({ select: { logIdClean: true } })).map((g) => g.logIdClean),
  );

  const neu: { logId: string; logIdClean: string; bezeichnung: string; bereinigt: string }[] = [];
  const gruende = new Map<string, number>();
  const zaehle  = (grund: string) => gruende.set(grund, (gruende.get(grund) ?? 0) + 1);

  for (const r of rows) {
    const bez = (r.bezeichnung ?? "").trim();
    if (!bez) { zaehle("ohne Bezeichnung"); continue; }

    const check = checkHersteller(r.hersteller ?? "", bez);
    if (!check.erlaubt || !check.kanonisch) { zaehle(check.grund ?? "Hersteller nicht erlaubt"); continue; }

    const logIdClean = logIdNormalize(r.logId);
    if (vorhanden.has(logIdClean)) { zaehle("schon vorhanden"); continue; }

    const modell = bereinigeBezeichnung(check.kanonisch, bez);
    if (!modell) { zaehle("Name nach Bereinigung leer"); continue; }

    neu.push({ logId: r.logId, logIdClean, bezeichnung: bez, bereinigt: `${check.kanonisch} ${modell}` });
    vorhanden.add(logIdClean); // doppelte LogID in der Quelle nur einmal anlegen
  }

  console.log(`\n  ➕ Neu anzulegen: ${neu.length.toLocaleString("de-DE")}`);
  console.log("  Übersprungen:");
  for (const [grund, n] of [...gruende.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`     ${n.toLocaleString("de-DE").padStart(6)}  ${grund}`);
  }

  const proModell = new Map<string, number>();
  for (const n of neu) proModell.set(n.bereinigt, (proModell.get(n.bereinigt) ?? 0) + 1);
  console.log(`\n  Modelle, die daraus entstehen: ${proModell.size}`);
  for (const [m, n] of [...proModell.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`     ${String(n).padStart(5)}×  ${m}`);
  }
  if (proModell.size > 25) console.log(`     … und ${proModell.size - 25} weitere`);

  if (!SCHREIBEN) {
    console.log("\n  TROCKENLAUF — nichts geschrieben. Anwenden mit --schreiben\n");
    return;
  }

  let geschrieben = 0;
  const BATCH = 500;
  for (let i = 0; i < neu.length; i += BATCH) {
    // skipDuplicates: falls parallel doch jemand dieselbe LogID importiert.
    const res = await prisma.geraeteLookup.createMany({ data: neu.slice(i, i + BATCH), skipDuplicates: true });
    geschrieben += res.count;
    process.stdout.write(`\r  → ${geschrieben} / ${neu.length}`);
  }
  process.stdout.write("\n");
  console.log(`\n  ✓ ${geschrieben.toLocaleString("de-DE")} Geräte nachgetragen.`);
  console.log("    Der Suchindex zieht beim nächsten `npm run reindex -- --only modelle` nach.\n");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

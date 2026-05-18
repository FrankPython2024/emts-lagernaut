import { MeiliSearch } from "meilisearch";
import { PrismaClient } from "@prisma/client";

const MEILI_URL  = process.env.MEILISEARCH_URL ?? "http://localhost:7700";
const MEILI_KEY  = process.env.MEILISEARCH_KEY;
const BATCH_SIZE = 1000;

const ms     = new MeiliSearch({ host: MEILI_URL, apiKey: MEILI_KEY });
const prisma = new PrismaClient();

// --only <index> CLI-Flag
const args      = process.argv.slice(2);
const onlyPos   = args.indexOf("--only");
const onlyIndex = onlyPos >= 0
  ? args[onlyPos + 1]
  : (args.find(a => a.startsWith("--only="))?.split("=")[1] ?? null);

// ── Index-Settings ─────────────────────────────────────────────────────────

const SETTINGS = {
  artikel: {
    searchableAttributes: ["bezeichnung", "modell", "kategorie"],
    filterableAttributes: ["kategorie", "bestandStatus", "lagerplatz"],
    sortableAttributes:   ["bestand", "bezeichnung"],
  },
  modelle: {
    searchableAttributes: ["modell", "hersteller", "logIds"],
    filterableAttributes: ["hersteller", "aktiv"],
    sortableAttributes:   [],
  },
  anfragen: {
    searchableAttributes: ["gruppenNr", "teiltyp", "geraet", "techniker", "notiz"],
    filterableAttributes: ["status", "techniker", "hersteller"],
    sortableAttributes:   ["erstelltAm"],
  },
  buchungen: {
    searchableAttributes: ["artikelBezeichnung", "notiz", "ausgefuehrtVon"],
    filterableAttributes: ["typ", "ausgefuehrtVon", "artikelKategorie"],
    sortableAttributes:   ["datum"],
  },
} as const;

// ── Hilfsfunktionen ─────────────────────────────────────────────────────────

async function initIndex(name: string, settings: Record<string, unknown>) {
  try {
    await ms.createIndex(name, { primaryKey: "id" });
    console.log(`  [${name}] Index angelegt`);
  } catch {
    // bereits vorhanden — ok
  }
  const task = await ms.index(name).updateSettings(settings as Parameters<ReturnType<typeof ms.index>["updateSettings"]>[0]);
  await ms.waitForTask(task.taskUid);
  console.log(`  [${name}] Settings gesetzt (task ${task.taskUid})`);
}

async function addInBatches(indexName: string, docs: object[]) {
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    await ms.index(indexName).addDocuments(batch, { primaryKey: "id" });
    const from = i + 1;
    const to   = Math.min(i + BATCH_SIZE, docs.length);
    process.stdout.write(`\r  → ${from}–${to} / ${docs.length}`);
  }
  process.stdout.write("\n");
}

// ── Reindex-Funktionen ─────────────────────────────────────────────────────

async function reindexArtikel(): Promise<number> {
  console.log("\n── artikel ───────────────────────────────────");
  await initIndex("artikel", SETTINGS.artikel);

  const rows = await prisma.artikel.findMany({
    select: { id: true, bezeichnung: true, kategorie: true, bestand: true, lagerplatz: true },
  });

  const docs = rows.map(a => {
    const teile   = a.bezeichnung.trim().split(/\s+/);
    const modell  = teile.length > 1 ? teile.slice(0, -1).join(" ") : a.bezeichnung;
    return {
      id:            a.id,
      bezeichnung:   a.bezeichnung,
      kategorie:     a.kategorie,
      bestand:       a.bestand,
      lagerplatz:    a.lagerplatz ?? null,
      modell,
      bestandStatus: a.bestand > 0 ? "vorhanden" : "leer",
    };
  });

  await addInBatches("artikel", docs);
  console.log(`  ✓ ${docs.length} Artikel`);
  return docs.length;
}

async function reindexModelle(): Promise<number> {
  console.log("\n── modelle ───────────────────────────────────");
  await initIndex("modelle", SETTINGS.modelle);

  const rows = await prisma.geraeteModell.findMany({
    select: {
      id: true, hersteller: true, modell: true, aktiv: true,
      lagerplatz: { select: { code: true } },
    },
  });

  // logIds aus GeraeteLookup: bereinigt ≈ modell
  const lookups = await prisma.geraeteLookup.findMany({
    select: { logId: true, bereinigt: true },
  });
  const logIdMap = new Map<string, string[]>();
  for (const l of lookups) {
    if (!logIdMap.has(l.bereinigt)) logIdMap.set(l.bereinigt, []);
    logIdMap.get(l.bereinigt)!.push(l.logId);
  }

  const docs = rows.map(m => {
    const logIds = logIdMap.get(m.modell) ?? [];
    return {
      id:           m.id,
      hersteller:   m.hersteller,
      modell:       m.modell,
      aktiv:        m.aktiv,
      lagerplatz:   m.lagerplatz?.code ?? null,
      logIds,
      anzahlLogIds: logIds.length,
    };
  });

  await addInBatches("modelle", docs);
  console.log(`  ✓ ${docs.length} Modelle`);
  return docs.length;
}

async function reindexAnfragen(): Promise<number> {
  console.log("\n── anfragen ──────────────────────────────────");
  await initIndex("anfragen", SETTINGS.anfragen);

  const rows = await prisma.anfrage.findMany({
    select: {
      id: true, gruppenNr: true, teil: true, geraet: true,
      techniker: true, status: true, kommentar: true, datum: true,
    },
  });

  const docs = rows.map(a => ({
    id:          a.id,
    gruppenNr:   a.gruppenNr  ?? null,
    teiltyp:     a.teil,
    geraet:      a.geraet,
    hersteller:  a.geraet.split(" ")[0] ?? null,
    techniker:   a.techniker,
    status:      a.status,
    notiz:       a.kommentar ?? null,
    erstelltAm:  a.datum.getTime(),
  }));

  await addInBatches("anfragen", docs);
  console.log(`  ✓ ${docs.length} Anfragen`);
  return docs.length;
}

async function reindexBuchungen(): Promise<number> {
  console.log("\n── buchungen ─────────────────────────────────");
  await initIndex("buchungen", SETTINGS.buchungen);

  const total   = await prisma.buchung.count();
  let   indexed = 0;
  let   page    = 0;

  while (true) {
    const batch = await prisma.buchung.findMany({
      skip:    page * BATCH_SIZE,
      take:    BATCH_SIZE,
      orderBy: { id: "asc" },
      select: {
        id: true, typ: true, bezeichnung: true, menge: true,
        notiz: true, mitarbeiter: true, datum: true,
        artikel: { select: { kategorie: true } },
      },
    });

    if (batch.length === 0) break;

    const docs = batch.map(b => ({
      id:               b.id,
      typ:              b.typ,
      artikelBezeichnung: b.bezeichnung,
      menge:            b.menge,
      notiz:            b.notiz ?? null,
      ausgefuehrtVon:   b.mitarbeiter,
      artikelKategorie: b.artikel?.kategorie ?? null,
      datum:            b.datum.getTime(),
    }));

    await ms.index("buchungen").addDocuments(docs, { primaryKey: "id" });
    indexed += docs.length;
    process.stdout.write(`\r  → ${indexed} / ${total}`);
    page++;

    if (batch.length < BATCH_SIZE) break;
  }

  process.stdout.write("\n");
  console.log(`  ✓ ${indexed} Buchungen`);
  return indexed;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════");
  console.log("  Meilisearch Re-Index — EMTS Lagernaut");
  console.log(`  URL:   ${MEILI_URL}`);
  if (onlyIndex) console.log(`  Modus: --only ${onlyIndex}`);
  console.log("═══════════════════════════════════════════════");

  try {
    await ms.health();
    console.log("  ✓ Meilisearch erreichbar");
  } catch {
    console.error("  ✗ Meilisearch nicht erreichbar. Läuft der Docker-Stack?");
    process.exit(1);
  }

  const counts: Record<string, number> = {};

  const maybe = (name: string, fn: () => Promise<number>) =>
    !onlyIndex || onlyIndex === name
      ? fn().then(n => { counts[name] = n; })
      : Promise.resolve();

  await maybe("artikel",  reindexArtikel);
  await maybe("modelle",  reindexModelle);
  await maybe("anfragen", reindexAnfragen);
  await maybe("buchungen", reindexBuchungen);

  await prisma.$disconnect();

  console.log("\n═══════════════════════════════════════════════");
  console.log("  FERTIG:");
  for (const [name, count] of Object.entries(counts)) {
    console.log(`  • ${name.padEnd(12)} ${count.toLocaleString("de-DE")} Dokumente`);
  }
  console.log("═══════════════════════════════════════════════\n");
}

main().catch(e => {
  console.error(e);
  prisma.$disconnect().finally(() => process.exit(1));
});

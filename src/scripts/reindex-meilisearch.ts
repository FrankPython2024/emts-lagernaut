/**
 * Meilisearch Re-Index.
 *
 *   npm run reindex                          alle Zeilen in den Index schreiben (wie bisher)
 *   npm run reindex -- --only artikel        nur ein Index
 *   npm run reindex -- --aufraeumen          TROCKENLAUF: zählt je Index verwaiste und
 *                                            fehlende Dokumente, schreibt NICHTS
 *   npm run reindex -- --aufraeumen --schreiben
 *                                            verwaiste Dokumente löschen + alle Zeilen neu schreiben
 *
 * ⚠️ Der normale Lauf fügt nur hinzu und löscht nie. Am 15.09.2026 standen deshalb
 * 38.345 Artikel-Dokumente im Index, deren Zeile es seit dem Reset vom 22.05.2026
 * nicht mehr gab — ein Reindex hätte daran nichts geändert. Dafür `--aufraeumen`.
 */
import { MeiliSearch } from "meilisearch";
import { PrismaClient } from "@prisma/client";
import {
  ANFRAGE_SUCH_SELECT, ARTIKEL_SUCH_SELECT, BUCHUNG_SUCH_SELECT, SUCH_INDIZES,
  anfrageDokument, artikelDokument, buchungDokument, type SuchIndex,
} from "../core/infra/meilisearchDokumente";

const MEILI_URL  = process.env.MEILISEARCH_URL ?? "http://localhost:7700";
const MEILI_KEY  = process.env.MEILISEARCH_KEY;
const BATCH_SIZE = 1000;
/** Große Indizes brauchen beim Schreiben einige Minuten. */
const TASK_TIMEOUT_MS = 15 * 60_000;

const ms     = new MeiliSearch({ host: MEILI_URL, apiKey: MEILI_KEY });
const prisma = new PrismaClient();

// --only <index> CLI-Flag
const args      = process.argv.slice(2);
const onlyPos   = args.indexOf("--only");
const onlyIndex = onlyPos >= 0
  ? args[onlyPos + 1]
  : (args.find(a => a.startsWith("--only="))?.split("=")[1] ?? null);
const aufraeumen = args.includes("--aufraeumen");
const schreiben  = args.includes("--schreiben");

// ── Index-Settings ─────────────────────────────────────────────────────────

const SETTINGS = {
  artikel: {
    searchableAttributes: ["bezeichnung", "modell", "kategorie"],
    filterableAttributes: ["standortId", "kategorie", "bestandStatus", "lagerplatz"],
    sortableAttributes:   ["bestand", "bezeichnung"],
  },
  modelle: {
    searchableAttributes: ["modell", "hersteller", "logIds"],
    filterableAttributes: ["hersteller", "aktiv"],
    sortableAttributes:   [],
  },
  anfragen: {
    searchableAttributes: ["gruppenNr", "teiltyp", "geraet", "techniker", "notiz"],
    filterableAttributes: ["standortId", "status", "techniker", "hersteller"],
    sortableAttributes:   ["erstelltAm"],
  },
  buchungen: {
    searchableAttributes: ["artikelBezeichnung", "notiz", "ausgefuehrtVon"],
    filterableAttributes: ["standortId", "typ", "ausgefuehrtVon", "artikelKategorie"],
    sortableAttributes:   ["datum"],
  },
} as const;

// ── Hilfsfunktionen ─────────────────────────────────────────────────────────

async function initIndex(name: string, settings: Record<string, unknown>) {
  // ⚠️ `createIndex` wirft NICHT, wenn es den Index schon gibt — es reiht nur
  // einen Auftrag ein, der später mit `index_already_exists` scheitert. Die alte
  // Fassung meldete deshalb bei jedem Lauf „Index angelegt". Erst nachsehen.
  let vorhanden = true;
  try {
    await ms.getIndex(name);
  } catch {
    vorhanden = false;
  }
  if (!vorhanden) {
    const task = await ms.createIndex(name, { primaryKey: "id" });
    await ms.waitForTask(task.taskUid);
    console.log(`  [${name}] Index angelegt`);
  }
  const task = await ms.index(name).updateSettings(settings as Parameters<ReturnType<typeof ms.index>["updateSettings"]>[0]);
  await ms.waitForTask(task.taskUid);
  console.log(`  [${name}] Settings gesetzt (task ${task.taskUid})`);
}

async function addInBatches(indexName: string, docs: object[]) {
  const tasks: number[] = [];
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    const task  = await ms.index(indexName).addDocuments(batch, { primaryKey: "id" });
    tasks.push(task.taskUid);
    const from = i + 1;
    const to   = Math.min(i + BATCH_SIZE, docs.length);
    process.stdout.write(`\r  → ${from}–${to} / ${docs.length}`);
  }
  process.stdout.write("\n");
  // Im Aufräum-Modus auf die Indizierung warten, sonst stimmt die Schlusszählung nicht.
  if (aufraeumen) await ms.waitForTasks(tasks, { timeOutMs: TASK_TIMEOUT_MS });
}

// ── Abgleich Index ↔ DB ────────────────────────────────────────────────────

async function idsImIndex(name: SuchIndex): Promise<number[]> {
  const ids: number[] = [];
  const SEITE = 10_000;
  for (let offset = 0; ; offset += SEITE) {
    const r = await ms.index(name).getDocuments({ fields: ["id"], limit: SEITE, offset });
    for (const d of r.results) ids.push(Number(d.id));
    if (r.results.length < SEITE) break;
  }
  return ids;
}

async function idsInDb(name: SuchIndex): Promise<number[]> {
  const select = { id: true } as const;
  const rows =
    name === "artikel"   ? await prisma.artikel.findMany({ select })       :
    name === "modelle"   ? await prisma.geraeteModell.findMany({ select }) :
    name === "anfragen"  ? await prisma.anfrage.findMany({ select })       :
                           await prisma.buchung.findMany({ select });
  return rows.map(r => r.id);
}

type Abgleich = { index: number; db: number; verwaist: number[]; fehlend: number };

async function gleicheAb(name: SuchIndex): Promise<Abgleich> {
  // ⚠️ Reihenfolge ist Absicht: ERST der Index, DANN die DB. Umgekehrt würde ein
  // Artikel, der zwischen beiden Abfragen angelegt und schon indiziert wurde, als
  // „verwaist" gelten und gelöscht. So kann höchstens ein gerade gelöschter
  // übrig bleiben — den nimmt der nächste Lauf.
  const imIndex = await idsImIndex(name);
  const inDb    = new Set(await idsInDb(name));
  const indexSet = new Set(imIndex);
  return {
    index:    imIndex.length,
    db:       inDb.size,
    verwaist: imIndex.filter(id => !inDb.has(id)),
    fehlend:  [...inDb].filter(id => !indexSet.has(id)).length,
  };
}

function druckeAbgleich(name: string, a: Abgleich) {
  const f = (n: number) => n.toLocaleString("de-DE");
  console.log(
    `  [${name}] im Index ${f(a.index)} · in DB ${f(a.db)} · ` +
    `verwaist ${f(a.verwaist.length)} · fehlend ${f(a.fehlend)}`,
  );
}

async function loescheVerwaiste(name: SuchIndex, ids: number[]) {
  if (ids.length === 0) return;
  const tasks: number[] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const task = await ms.index(name).deleteDocuments(ids.slice(i, i + BATCH_SIZE));
    tasks.push(task.taskUid);
  }
  await ms.waitForTasks(tasks, { timeOutMs: TASK_TIMEOUT_MS });
  console.log(`  [${name}] ${ids.length.toLocaleString("de-DE")} verwaiste Dokumente gelöscht`);
}

// ── Reindex-Funktionen ─────────────────────────────────────────────────────

async function reindexArtikel(): Promise<number> {
  console.log("\n── artikel ───────────────────────────────────");
  await initIndex("artikel", SETTINGS.artikel);

  const rows = await prisma.artikel.findMany({ select: ARTIKEL_SUCH_SELECT });
  const docs = rows.map(artikelDokument);

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
      belegung: { select: { lagerplatz: { select: { code: true } } } },
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
      lagerplatz:   m.belegung?.lagerplatz?.code ?? null,
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

  const rows = await prisma.anfrage.findMany({ select: ANFRAGE_SUCH_SELECT });
  const docs = rows.map(anfrageDokument);

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
  const tasks: number[] = [];

  while (true) {
    const batch = await prisma.buchung.findMany({
      skip:    page * BATCH_SIZE,
      take:    BATCH_SIZE,
      orderBy: { id: "asc" },
      select:  BUCHUNG_SUCH_SELECT,
    });

    if (batch.length === 0) break;

    const docs = batch.map(buchungDokument);

    const task = await ms.index("buchungen").addDocuments(docs, { primaryKey: "id" });
    tasks.push(task.taskUid);
    indexed += docs.length;
    process.stdout.write(`\r  → ${indexed} / ${total}`);
    page++;

    if (batch.length < BATCH_SIZE) break;
  }

  process.stdout.write("\n");
  if (aufraeumen) await ms.waitForTasks(tasks, { timeOutMs: TASK_TIMEOUT_MS });
  console.log(`  ✓ ${indexed} Buchungen`);
  return indexed;
}

const REINDEX: Record<SuchIndex, () => Promise<number>> = {
  artikel:   reindexArtikel,
  modelle:   reindexModelle,
  anfragen:  reindexAnfragen,
  buchungen: reindexBuchungen,
};

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════");
  console.log("  Meilisearch Re-Index — EMTS Lagernaut");
  console.log(`  URL:   ${MEILI_URL}`);
  if (onlyIndex) console.log(`  Modus: --only ${onlyIndex}`);
  if (aufraeumen) console.log(`  Aufräumen: ${schreiben ? "SCHREIBEN (verwaiste werden gelöscht)" : "TROCKENLAUF (schreibt nichts)"}`);
  console.log("═══════════════════════════════════════════════");

  if (onlyIndex && !(SUCH_INDIZES as readonly string[]).includes(onlyIndex)) {
    console.error(`  ✗ Unbekannter Index „${onlyIndex}". Erlaubt: ${SUCH_INDIZES.join(", ")}`);
    process.exit(1);
  }
  if (schreiben && !aufraeumen) {
    console.error("  ✗ --schreiben gehört zu --aufraeumen. Ein normaler Reindex schreibt ohnehin.");
    process.exit(1);
  }

  try {
    await ms.health();
    console.log("  ✓ Meilisearch erreichbar");
  } catch {
    console.error("  ✗ Meilisearch nicht erreichbar. Läuft der Docker-Stack?");
    process.exit(1);
  }

  const indizes = SUCH_INDIZES.filter(name => !onlyIndex || onlyIndex === name);

  if (aufraeumen) {
    console.log("\n── Abgleich Index ↔ DB (vorher) ──────────────");
    const vorher = new Map<SuchIndex, Abgleich>();
    for (const name of indizes) {
      const a = await gleicheAb(name);
      vorher.set(name, a);
      druckeAbgleich(name, a);
    }

    if (!schreiben) {
      await prisma.$disconnect();
      console.log("\n  TROCKENLAUF — nichts geschrieben. Anwenden mit: --aufraeumen --schreiben\n");
      return;
    }

    for (const name of indizes) {
      await loescheVerwaiste(name, vorher.get(name)!.verwaist);
      await REINDEX[name]();
    }

    console.log("\n── Abgleich Index ↔ DB (nachher) ─────────────");
    for (const name of indizes) druckeAbgleich(name, await gleicheAb(name));
    await prisma.$disconnect();
    console.log("");
    return;
  }

  const counts: Record<string, number> = {};
  for (const name of indizes) counts[name] = await REINDEX[name]();

  await prisma.$disconnect();

  console.log("\n═══════════════════════════════════════════════");
  console.log("  FERTIG:");
  for (const [name, count] of Object.entries(counts)) {
    console.log(`  • ${name.padEnd(12)} ${count.toLocaleString("de-DE")} Dokumente`);
  }
  console.log("  ℹ️  Verwaiste Dokumente werden hier NICHT entfernt → --aufraeumen");
  console.log("═══════════════════════════════════════════════\n");
}

main().catch(e => {
  console.error(e);
  prisma.$disconnect().finally(() => process.exit(1));
});

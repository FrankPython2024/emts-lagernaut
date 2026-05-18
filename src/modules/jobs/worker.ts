import { Queue, Worker, type ConnectionOptions } from "bullmq";
import Redis from "ioredis";

// ── Redis-Verbindung für BullMQ ───────────────────────────────────────────────
// Separate Connection — maxRetriesPerRequest: null ist für BullMQ Pflicht

const connection: ConnectionOptions = new Redis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,  // BullMQ-Anforderung
    enableOfflineQueue:   true,
    connectTimeout:       5_000,
    lazyConnect:          true,
  },
) as ConnectionOptions;

// ── Queue-Definitionen (lightweight, keine Worker-Verbindung) ─────────────────

export const queues = {
  belege:           new Queue("belege",            { connection }),
  meilisearch:      new Queue("meilisearch",       { connection }),
  notify:           new Queue("notify",            { connection }),
  artikelGenerator: new Queue("artikel-generator",  { connection }),
  reprocessGeraete: new Queue("reprocess-geraete",  { connection }),
} as const;

// ── Job-Handler ───────────────────────────────────────────────────────────────

async function handleBelegeJob(job: { id?: string | undefined; name: string; data: Record<string, unknown> }) {
  console.log(`[BullMQ:belege] Job #${job.id} — ${job.name}`);
  switch (job.name) {
    case "generate-einlager":
    case "generate-auslager":
      // Beleg-Daten in DB persistieren (Modell wird bei Bedarf ergänzt)
      console.log("[BullMQ:belege] Beleg-Daten:", job.data);
      break;
    default:
      console.warn("[BullMQ:belege] Unbekannter Job:", job.name);
  }
}

async function handleMeilisearchJob(job: { id?: string | undefined; name: string; data: Record<string, unknown> }) {
  console.log(`[BullMQ:meilisearch] #${job.id} ${job.name}`);
  const { prisma }      = await import("@/core/db/prisma");
  const { meilisearch } = await import("@/core/infra/meilisearch");

  switch (job.name) {

    // ── Bulk-Reindex (via npm run reindex bevorzugt) ──────────────────────────
    case "reindex-artikel": {
      const rows = await prisma.artikel.findMany({
        select: { id: true, bezeichnung: true, kategorie: true, bestand: true, lagerplatz: true },
      });
      const docs = rows.map(a => {
        const t = a.bezeichnung.trim().split(/\s+/);
        return { id: a.id, bezeichnung: a.bezeichnung, kategorie: a.kategorie, bestand: a.bestand,
          lagerplatz: a.lagerplatz ?? null, modell: t.length > 1 ? t.slice(0, -1).join(" ") : a.bezeichnung,
          bestandStatus: a.bestand > 0 ? "vorhanden" : "leer" };
      });
      await meilisearch.index("artikel").addDocuments(docs, { primaryKey: "id" });
      console.log(`[BullMQ:meilisearch] ${docs.length} Artikel bulk-reindexiert`);
      break;
    }
    case "reindex-geraete": {
      const rows = await prisma.geraeteModell.findMany({
        where:  { aktiv: true },
        select: { id: true, hersteller: true, modell: true },
      });
      const docs = rows.map(g => ({ ...g, aktiv: true, lagerplatz: null, logIds: [], anzahlLogIds: 0 }));
      await meilisearch.index("modelle").addDocuments(docs, { primaryKey: "id" });
      console.log(`[BullMQ:meilisearch] ${docs.length} Geräte bulk-reindexiert`);
      break;
    }

    // ── Artikel ───────────────────────────────────────────────────────────────
    case "sync-artikel": {
      const artikelId = job.data.artikelId as number;
      const a = await prisma.artikel.findUnique({
        where:  { id: artikelId },
        select: { id: true, bezeichnung: true, kategorie: true, bestand: true, lagerplatz: true },
      });
      if (!a) {
        await meilisearch.index("artikel").deleteDocument(artikelId);
        break;
      }
      const t = a.bezeichnung.trim().split(/\s+/);
      await meilisearch.index("artikel").addDocuments([{
        id: a.id, bezeichnung: a.bezeichnung, kategorie: a.kategorie, bestand: a.bestand,
        lagerplatz: a.lagerplatz ?? null,
        modell: t.length > 1 ? t.slice(0, -1).join(" ") : a.bezeichnung,
        bestandStatus: a.bestand > 0 ? "vorhanden" : "leer",
      }], { primaryKey: "id" });
      break;
    }
    case "delete-artikel": {
      await meilisearch.index("artikel").deleteDocument(job.data.artikelId as number);
      break;
    }

    // ── Modelle ───────────────────────────────────────────────────────────────
    case "sync-modell": {
      const modellId = job.data.modellId as number;
      const m = await prisma.geraeteModell.findUnique({
        where:  { id: modellId },
        select: { id: true, hersteller: true, modell: true, aktiv: true,
                  lagerplatz: { select: { code: true } } },
      });
      if (!m) {
        await meilisearch.index("modelle").deleteDocument(modellId);
        break;
      }
      const logIds = (await prisma.geraeteLookup.findMany({
        where:  { bereinigt: m.modell },
        select: { logId: true },
      })).map(l => l.logId);
      await meilisearch.index("modelle").addDocuments([{
        id: m.id, hersteller: m.hersteller, modell: m.modell, aktiv: m.aktiv,
        lagerplatz: m.lagerplatz?.code ?? null, logIds, anzahlLogIds: logIds.length,
      }], { primaryKey: "id" });
      break;
    }
    case "delete-modell": {
      await meilisearch.index("modelle").deleteDocument(job.data.modellId as number);
      break;
    }

    // ── Anfragen ──────────────────────────────────────────────────────────────
    case "sync-anfrage": {
      const anfrageId = job.data.anfrageId as number;
      const a = await prisma.anfrage.findUnique({
        where:  { id: anfrageId },
        select: { id: true, gruppenNr: true, teil: true, geraet: true,
                  techniker: true, status: true, kommentar: true, datum: true },
      });
      if (!a) {
        await meilisearch.index("anfragen").deleteDocument(anfrageId);
        break;
      }
      await meilisearch.index("anfragen").addDocuments([{
        id: a.id, gruppenNr: a.gruppenNr ?? null, teiltyp: a.teil, geraet: a.geraet,
        hersteller: a.geraet.split(" ")[0] ?? null, techniker: a.techniker, status: a.status,
        notiz: a.kommentar ?? null, erstelltAm: a.datum.getTime(),
      }], { primaryKey: "id" });
      break;
    }

    // ── Buchungen ─────────────────────────────────────────────────────────────
    case "sync-buchung": {
      const buchungId = job.data.buchungId as number;
      const b = await prisma.buchung.findUnique({
        where:  { id: buchungId },
        select: { id: true, typ: true, bezeichnung: true, menge: true,
                  notiz: true, mitarbeiter: true, datum: true,
                  artikel: { select: { kategorie: true } } },
      });
      if (!b) {
        await meilisearch.index("buchungen").deleteDocument(buchungId);
        break;
      }
      await meilisearch.index("buchungen").addDocuments([{
        id: b.id, typ: b.typ, artikelBezeichnung: b.bezeichnung, menge: b.menge,
        notiz: b.notiz ?? null, ausgefuehrtVon: b.mitarbeiter,
        artikelKategorie: b.artikel?.kategorie ?? null, datum: b.datum.getTime(),
      }], { primaryKey: "id" });
      break;
    }
    case "delete-buchung": {
      await meilisearch.index("buchungen").deleteDocument(job.data.buchungId as number);
      break;
    }

    default:
      console.warn("[BullMQ:meilisearch] Unbekannter Job:", job.name);
  }
}

async function handleNotifyJob(job: { id?: string | undefined; name: string; data: Record<string, unknown> }) {
  console.log(`[BullMQ:notify] Job #${job.id} — ${job.name}`);
  switch (job.name) {
    case "send-nachricht": {
      const { sendeNachricht } = await import("@/modules/nachrichten/service");
      await sendeNachricht(job.data as Parameters<typeof sendeNachricht>[0]);
      break;
    }
    default:
      console.warn("[BullMQ:notify] Unbekannter Job:", job.name);
  }
}

// ── Artikel-Generator ─────────────────────────────────────────────────────────
// Pro Modell (distinct bereinigt aus GeraeteLookup): 17 Standard-Artikel + Kompatibilitaet.
// Idempotent: createMany mit skipDuplicates → mehrfaches Starten ist sicher.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleArtikelGeneratorJob(job: any) {
  const { prisma }           = await import("@/core/db/prisma");
  const { STANDARD_TEILTYPEN } = await import("@/lib/constants/teiltypen");

  // Alle eindeutigen Gerätebezeichnungen aus GeraeteLookup
  const lookups = await prisma.geraeteLookup.findMany({
    where:    { bereinigt: { not: "" } },
    select:   { bereinigt: true },
    distinct: ["bereinigt"],
    orderBy:  { bereinigt: "asc" },
  });

  const modelle = lookups.map((l) => l.bereinigt).filter(Boolean);
  const total   = modelle.length;
  let artikelCreated = 0;
  let artikelSkipped = 0;

  console.log(`[ArtikelGen] Starte: ${total} Modelle × ${STANDARD_TEILTYPEN.length} Teile`);

  for (let i = 0; i < modelle.length; i++) {
    const bereinigt = modelle[i]!;

    // GeraeteModell sicherstellen — Hersteller validieren, kein Duplikat
    const { checkHersteller }    = await import("@/lib/geraete/herstellerFilter");
    const { getOrCreateModell }  = await import("@/lib/geraete/getOrCreateModell");
    const parts      = bereinigt.split(" ");
    const herstellerRoh = parts[0] ?? "";
    const herstellerCheck = checkHersteller(herstellerRoh, bereinigt);

    if (herstellerCheck.erlaubt && herstellerCheck.kanonisch) {
      await getOrCreateModell(bereinigt, herstellerCheck.kanonisch, {
        allowCreate:     true,
        adminBestaetigt: true,
      }).catch((e: Error) => console.warn(`[ArtikelGen] GeraeteModell skip: ${e.message}`));
    }

    // Artikel-Batch für dieses Gerät
    const artikelData = STANDARD_TEILTYPEN.map((t) => ({
      bezeichnung: `${bereinigt} ${t.name}`,
      kategorie:   t.name,
      bestand:     0,
      lagerplatz:  null as string | null,
    }));

    const createRes = await prisma.artikel.createMany({ data: artikelData, skipDuplicates: true });
    artikelCreated += createRes.count;
    artikelSkipped += artikelData.length - createRes.count;

    // Artikel-IDs für Kompatibilitaet holen (inkl. bereits bestehender)
    const artikel = await prisma.artikel.findMany({
      where:  { bezeichnung: { in: artikelData.map((a) => a.bezeichnung) } },
      select: { id: true, kategorie: true },
    });

    if (artikel.length > 0) {
      await prisma.kompatibilitaet.createMany({
        data:           artikel.map((a) => ({ geraet: bereinigt, teiltyp: a.kategorie, artikelId: a.id })),
        skipDuplicates: true,
      });
    }

    // Progress alle 10 Modelle oder am Ende
    if ((i + 1) % 10 === 0 || i === modelle.length - 1) {
      const pct = Math.round(((i + 1) / total) * 100);
      await job.updateProgress({
        progress:       pct,
        modelsProcessed: i + 1,
        totalModels:    total,
        artikelCreated,
        artikelSkipped,
        currentModel:   bereinigt,
      });
      console.log(`[ArtikelGen] ${pct}% — ${i + 1}/${total} — ${artikelCreated} erstellt`);
    }
  }

  console.log(`[ArtikelGen] Fertig: ${artikelCreated} erstellt, ${artikelSkipped} übersprungen`);
  return { success: true, totalModels: total, artikelCreated, artikelSkipped };
}

// ── Reprocess-Geräte ──────────────────────────────────────────────────────────
// Normalisiert Hersteller + Bezeichnungen für alle bestehenden GeraeteLookup-Einträge.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleReprocessJob(job: any) {
  const { prisma }              = await import("@/core/db/prisma");
  const { normalisiereHersteller } = await import("@/lib/geraete/herstellerFilter");
  const { bereinigeBezeichnung }   = await import("@/lib/geraete/bezeichnungBereinigen");

  const alle = await prisma.geraeteLookup.findMany({
    select:  { id: true, bereinigt: true, bezeichnung: true },
    orderBy: { id: "asc" },
  });

  const total = alle.length;
  let updates = 0;
  let deletes = 0;
  const deleteIds: number[] = [];

  for (let i = 0; i < alle.length; i++) {
    const g            = alle[i]!;
    const rawHersteller = g.bereinigt.split(" ")[0] ?? "";
    const normHersteller = normalisiereHersteller(rawHersteller);

    if (!normHersteller) {
      deleteIds.push(g.id);
      continue;
    }

    const cleanModel      = bereinigeBezeichnung(normHersteller, g.bezeichnung);
    const neuesBereinigt  = `${normHersteller} ${cleanModel}`;

    if (normHersteller !== rawHersteller || neuesBereinigt !== g.bereinigt) {
      await prisma.geraeteLookup.update({
        where: { id: g.id },
        data:  { bereinigt: neuesBereinigt },
      });
      updates++;
    }

    if ((i + 1) % 500 === 0 || i === alle.length - 1) {
      await job.updateProgress({
        progress:   Math.round(((i + 1) / total) * 100),
        processed:  i + 1,
        total,
        updates,
        toDelete:   deleteIds.length,
      });
    }
  }

  // Löschen in Batches
  if (deleteIds.length > 0) {
    const batchSize = 1_000;
    for (let i = 0; i < deleteIds.length; i += batchSize) {
      await prisma.geraeteLookup.deleteMany({ where: { id: { in: deleteIds.slice(i, i + batchSize) } } });
      deletes += Math.min(batchSize, deleteIds.length - i);
    }
  }

  const finalCount = await prisma.geraeteLookup.count();
  console.log(`[Reprocess] Fertig: ${updates} aktualisiert, ${deletes} gelöscht, ${finalCount} verbleibend`);
  return { updates, deletes, finalCount };
}

// ── startWorkers() — NUR in server.ts aufrufen, NIE in Next.js Pages/Routes ──

export function startWorkers(): void {
  const belegeWorker = new Worker(
    "belege",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (job: any) => handleBelegeJob(job),
    { connection, concurrency: 2 },
  );

  const meilisearchWorker = new Worker(
    "meilisearch",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (job: any) => handleMeilisearchJob(job),
    { connection, concurrency: 1 },
  );

  const notifyWorker = new Worker(
    "notify",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (job: any) => handleNotifyJob(job),
    { connection, concurrency: 5 },
  );

  belegeWorker.on("failed",      (job, err) => console.error("[BullMQ:belege] Fehler:",      job?.id, err.message));
  meilisearchWorker.on("failed", (job, err) => console.error("[BullMQ:meilisearch] Fehler:", job?.id, err.message));
  notifyWorker.on("failed", (job, err) => console.error("[BullMQ:notify] Fehler:", job?.id, err.message));

  const artikelGeneratorWorker = new Worker(
    "artikel-generator",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (job: any) => handleArtikelGeneratorJob(job),
    { connection, concurrency: 1 }, // NUR EINER gleichzeitig
  );
  artikelGeneratorWorker.on("completed", (job) =>
    console.log(`[BullMQ:artikel-generator] Job #${job.id} abgeschlossen`),
  );
  artikelGeneratorWorker.on("failed", (job, err) =>
    console.error(`[BullMQ:artikel-generator] Job #${job?.id} Fehler:`, err.message),
  );

  const reprocessWorker = new Worker(
    "reprocess-geraete",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (job: any) => handleReprocessJob(job),
    { connection, concurrency: 1 },
  );
  reprocessWorker.on("completed", (job) =>
    console.log(`[BullMQ:reprocess-geraete] Job #${job.id} abgeschlossen`),
  );
  reprocessWorker.on("failed", (job, err) =>
    console.error(`[BullMQ:reprocess-geraete] Job #${job?.id} Fehler:`, err.message),
  );

  console.log("[BullMQ] Workers gestartet:");
  console.log("  • belege            (concurrency: 2)");
  console.log("  • meilisearch       (concurrency: 1)");
  console.log("  • notify            (concurrency: 5)");
  console.log("  • artikel-generator (concurrency: 1)");
  console.log("  • reprocess-geraete (concurrency: 1)");
}

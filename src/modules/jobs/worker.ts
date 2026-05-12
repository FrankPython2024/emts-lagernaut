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
  artikelGenerator: new Queue("artikel-generator", { connection }),
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
  console.log(`[BullMQ:meilisearch] Job #${job.id} — ${job.name}`);
  const { prisma }      = await import("@/core/db/prisma");
  const { meilisearch } = await import("@/core/infra/meilisearch");

  switch (job.name) {
    case "reindex-artikel": {
      const artikel = await prisma.artikel.findMany({
        select: { id: true, bezeichnung: true, kategorie: true, bestand: true },
      });
      await meilisearch.index("artikel").addDocuments(artikel, { primaryKey: "id" });
      console.log(`[BullMQ:meilisearch] ${artikel.length} Artikel re-indexiert`);
      break;
    }
    case "reindex-geraete": {
      const geraete = await prisma.geraeteModell.findMany({
        select: { id: true, hersteller: true, modell: true },
      });
      await meilisearch.index("geraete").addDocuments(geraete, { primaryKey: "id" });
      console.log(`[BullMQ:meilisearch] ${geraete.length} Geräte re-indexiert`);
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

    // GeraeteModell sicherstellen — hersteller = erstes Wort
    const parts      = bereinigt.split(" ");
    const hersteller = parts[0] ?? "";
    const modellName = parts.length > 1 ? parts.slice(1).join(" ") : bereinigt;

    if (hersteller) {
      await prisma.geraeteModell.upsert({
        where:  { hersteller_modell: { hersteller, modell: modellName } },
        update: {},
        create: { hersteller, modell: modellName, aktiv: true },
      }).catch(() => {}); // ignoriere Race-Condition-Duplikate
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

  console.log("[BullMQ] Workers gestartet:");
  console.log("  • belege            (concurrency: 2)");
  console.log("  • meilisearch       (concurrency: 1)");
  console.log("  • notify            (concurrency: 5)");
  console.log("  • artikel-generator (concurrency: 1)");
}

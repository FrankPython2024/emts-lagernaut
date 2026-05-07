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
  belege:      new Queue("belege",      { connection }),
  meilisearch: new Queue("meilisearch", { connection }),
  notify:      new Queue("notify",      { connection }),
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
  notifyWorker.on("failed",      (job, err) => console.error("[BullMQ:notify] Fehler:",      job?.id, err.message));

  console.log("[BullMQ] Workers gestartet:");
  console.log("  • belege      (concurrency: 2)");
  console.log("  • meilisearch (concurrency: 1)");
  console.log("  • notify      (concurrency: 5)");
}

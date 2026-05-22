import { createTRPCRouter, adminProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";
import { redis } from "@/core/infra/redis";
import { meilisearch } from "@/core/infra/meilisearch";
import { getConnectedClients, isSocketIOReady } from "@/modules/realtime/socket";
import { queues } from "@/modules/jobs/worker";

// ── Hilfsfunktionen ─────────────────────────────────────────────────────────

function formatUptime(s: number) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function parseRedisInfo(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

async function getRedisStats() {
  try {
    const [infoRaw, dbSize] = await Promise.all([redis.info(), redis.dbsize()]);
    const info = parseRedisInfo(infoRaw);
    return {
      ok:               true,
      version:          info.redis_version ?? "–",
      usedMemory:       Number(info.used_memory ?? 0),
      usedMemoryHuman:  info.used_memory_human ?? "–",
      connectedClients: Number(info.connected_clients ?? 0),
      totalCommands:    Number(info.total_commands_processed ?? 0),
      keyspaceHits:     Number(info.keyspace_hits ?? 0),
      keyspaceMisses:   Number(info.keyspace_misses ?? 0),
      dbSize,
      uptimeSeconds:    Number(info.uptime_in_seconds ?? 0),
    };
  } catch {
    return { ok: false };
  }
}

async function getMeilisearchStats() {
  try {
    const [health, stats] = await Promise.all([
      meilisearch.health(),
      meilisearch.getStats(),
    ]);
    return { ok: true, status: health.status, stats };
  } catch {
    return { ok: false };
  }
}

async function getBullMQStats() {
  try {
    const [belegeStats, msStats, notifyStats] = await Promise.all([
      queues.belege.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
      queues.meilisearch.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
      queues.notify.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
    ]);
    return {
      ok: true,
      queues: [
        { name: "belege",      ...belegeStats, workers: { concurrency: 2 } },
        { name: "meilisearch", ...msStats,     workers: { concurrency: 1 } },
        { name: "notify",      ...notifyStats, workers: { concurrency: 5 } },
      ],
    };
  } catch {
    return {
      ok: false,
      queues: [
        { name: "belege",      waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, workers: { concurrency: 2 } },
        { name: "meilisearch", waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, workers: { concurrency: 1 } },
        { name: "notify",      waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, workers: { concurrency: 5 } },
      ],
    };
  }
}

async function getSocketIOStats() {
  if (!isSocketIOReady()) {
    return { ok: false, clients: [], note: "Socket.io nicht initialisiert" };
  }
  try {
    const clients = await getConnectedClients();
    return { ok: true, clients };
  } catch {
    return { ok: false, clients: [] };
  }
}

// ── Router ───────────────────────────────────────────────────────────────────

// ── Reset ────────────────────────────────────────────────────────────────────

async function resetAllData() {
  const result = await prisma.$transaction(async (tx) => {
    const nachrichtAntworten = await tx.nachrichtAntwort.deleteMany();
    const nachrichtEmpf      = await tx.nachrichtEmpf.deleteMany();
    const nachrichten        = await tx.nachricht.deleteMany();
    const anfragen           = await tx.anfrage.deleteMany();     // vor Artikel!
    const korbItems          = await tx.warenkorbItem.deleteMany();
    const koerbe             = await tx.warenkorb.deleteMany();
    const buchungen          = await tx.buchung.deleteMany();     // vor Artikel!
    const komps              = await tx.kompatibilitaet.deleteMany(); // vor Artikel!
    const artikel            = await tx.artikel.deleteMany();
    // Lagerplatz-Belegungen zurücksetzen (Hüllen bleiben erhalten)
    const lagerplatzReset    = await tx.lagerplatz.updateMany({
      where: { modellId: { not: null } },
      data:  { modellId: null },
    });
    // Jetzt sind keine FK-Verweise mehr — Modelle und Lookup können weg
    const modelle            = await tx.geraeteModell.deleteMany();
    const lookup             = await tx.geraeteLookup.deleteMany();
    const sessions           = await tx.technikerSession.deleteMany();
    const stresstests        = await tx.stressTestRun.deleteMany();
    return { artikel: artikel.count, buchungen: buchungen.count, anfragen: anfragen.count,
             nachrichten: nachrichten.count, komps: komps.count, koerbe: koerbe.count,
             korbItems: korbItems.count, sessions: sessions.count,
             nachrichtAntworten: nachrichtAntworten.count, nachrichtEmpf: nachrichtEmpf.count,
             stresstests: stresstests.count,
             lagerplatzReset: lagerplatzReset.count,
             modelle: modelle.count, lookup: lookup.count };
  }, { timeout: 120_000 });

  // Redis Beleg-Counter zurücksetzen (non-critical)
  let redisKeys = 0;
  try {
    const keys = await redis.keys("beleg:*");
    if (keys.length > 0) { await redis.del(...keys); redisKeys = keys.length; }
  } catch {}

  return { ...result, redisKeys };
}

// ── Router ───────────────────────────────────────────────────────────────────

export const systemRouter = createTRPCRouter({

  getMetrics: adminProcedure
    .query(async () => {
      const startMs = Date.now();

      const mem       = process.memoryUsage();
      const uptimeSec = process.uptime();

      const [artikelC, geraeteC, buchungC, anfrageC, userC, kompC, lookupC] =
        await Promise.all([
          prisma.artikel.count(),
          prisma.geraeteModell.count({ where: { aktiv: true } }),
          prisma.buchung.count(),
          prisma.anfrage.count(),
          prisma.user.count(),
          prisma.kompatibilitaet.count(),
          prisma.geraeteLookup.count(),
        ]);

      const onlineUsers = await prisma.technikerSession.findMany({
        where:  { online: true },
        select: { kuerzel: true, lastSeen: true },
      });

      const [redisStats, msStats, bullmqStats, socketStats] = await Promise.all([
        getRedisStats(),
        getMeilisearchStats(),
        getBullMQStats(),
        getSocketIOStats(),
      ]);

      const queryLatency = Date.now() - startMs;

      return {
        ts: new Date().toISOString(),
        node: {
          version:     process.version,
          uptime:      formatUptime(uptimeSec),
          uptimeSec,
          platform:    process.platform,
          heapUsed:    mem.heapUsed,
          heapTotal:   mem.heapTotal,
          rss:         mem.rss,
          external:    mem.external,
          heapPercent: Math.round((mem.heapUsed / mem.heapTotal) * 100),
          env:         process.env.NODE_ENV ?? "unknown",
        },
        db: {
          queryLatencyMs: queryLatency,
          tables: {
            artikel:         artikelC,
            geraeteModell:   geraeteC,
            buchung:         buchungC,
            anfrage:         anfrageC,
            user:            userC,
            kompatibilitaet: kompC,
            geraeteLookup:   lookupC,
          },
        },
        redis:      redisStats,
        meilisearch: msStats,
        online:     onlineUsers,
        bullmq:     bullmqStats,
        socketio:   socketStats,
      };
    }),

  // Vorschau: aktuelle DB-Zähler für Danger Zone
  getResetPreview: adminProcedure
    .query(async () => {
      const [artikel, buchungen, anfragen, komps, koerbe, nachrichten,
             modelle, lookup, belegteLagerplaetze] = await Promise.all([
        prisma.artikel.count(),
        prisma.buchung.count(),
        prisma.anfrage.count(),
        prisma.kompatibilitaet.count(),
        prisma.warenkorb.count(),
        prisma.nachricht.count(),
        prisma.geraeteModell.count(),
        prisma.geraeteLookup.count(),
        prisma.lagerplatz.count({ where: { modellId: { not: null } } }),
      ]);
      return { artikel, buchungen, anfragen, komps, koerbe, nachrichten,
               modelle, lookup, belegteLagerplaetze };
    }),

  // ⚠️  RESET — löscht alle Lager-Daten, behält User + GeraeteLookup
  resetLagernaut: adminProcedure
    .mutation(async ({ ctx }) => {
      const user = ctx.session!.user as { kuerzel?: string };
      console.log(`[System] RESET gestartet durch ${user.kuerzel ?? "unbekannt"}`);
      const result = await resetAllData();
      console.log(`[System] RESET abgeschlossen: ${JSON.stringify(result)}`);
      return result;
    }),

});

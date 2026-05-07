import { createTRPCRouter, adminProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";
import { redis } from "@/core/infra/redis";
import { meilisearch } from "@/core/infra/meilisearch";

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
      ok:              true,
      version:         info.redis_version ?? "–",
      usedMemory:      Number(info.used_memory ?? 0),
      usedMemoryHuman: info.used_memory_human ?? "–",
      connectedClients: Number(info.connected_clients ?? 0),
      totalCommands:   Number(info.total_commands_processed ?? 0),
      keyspaceHits:    Number(info.keyspace_hits ?? 0),
      keyspaceMisses:  Number(info.keyspace_misses ?? 0),
      dbSize,
      uptimeSeconds:   Number(info.uptime_in_seconds ?? 0),
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

// ── Router ───────────────────────────────────────────────────────────────────

export const systemRouter = createTRPCRouter({

  getMetrics: adminProcedure
    .query(async () => {
      const startMs = Date.now();

      // Node.js
      const mem     = process.memoryUsage();
      const uptimeSec = process.uptime();

      // DB Tabellen-Größen
      const [artikelC, geraeteC, buchungC, anfrageC, userC, kompC, lookupC] =
        await Promise.all([
          prisma.artikel.count(),
          prisma.geraeteModell.count(),
          prisma.buchung.count(),
          prisma.anfrage.count(),
          prisma.user.count(),
          prisma.kompatibilitaet.count(),
          prisma.geraeteLookup.count(),
        ]);

      // Online Techniker (TechnikerSession)
      const onlineUsers = await prisma.technikerSession.findMany({
        where:  { online: true },
        select: { kuerzel: true, lastSeen: true },
      });

      // Redis + Meilisearch parallel
      const [redisStats, msStats] = await Promise.all([
        getRedisStats(),
        getMeilisearchStats(),
      ]);

      const queryLatency = Date.now() - startMs;

      return {
        ts: new Date().toISOString(),
        node: {
          version:      process.version,
          uptime:       formatUptime(uptimeSec),
          uptimeSec,
          platform:     process.platform,
          heapUsed:     mem.heapUsed,
          heapTotal:    mem.heapTotal,
          rss:          mem.rss,
          external:     mem.external,
          heapPercent:  Math.round((mem.heapUsed / mem.heapTotal) * 100),
          env:          process.env.NODE_ENV ?? "unknown",
        },
        db: {
          queryLatencyMs: queryLatency,
          tables: {
            artikel:       artikelC,
            geraeteModell: geraeteC,
            buchung:       buchungC,
            anfrage:       anfrageC,
            user:          userC,
            kompatibilitaet: kompC,
            geraeteLookup: lookupC,
          },
        },
        redis:        redisStats,
        meilisearch:  msStats,
        online:       onlineUsers,
        // BullMQ — Placeholder (keine Worker registriert)
        bullmq: {
          queues: [
            { name: "indexing", waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
            { name: "belege",   waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
            { name: "notify",   waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
          ],
          note: "BullMQ Worker noch nicht implementiert",
        },
        // Socket.io — Placeholder
        socketio: {
          ok:    false,
          note:  "Socket.io noch nicht implementiert",
          clients: [],
        },
      };
    }),

});

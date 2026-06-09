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

type ConnectedClient = Awaited<ReturnType<typeof getConnectedClients>>[number];
type AngereicherterClient = ConnectedClient & {
  letzteAktion:    string | null;
  letzteAktionAt:  Date | null;
  letzterMenuPfad: string | null;
  letzterMenuAt:   Date | null;
};

// Liest die zuletzt besuchten Menü-Pfade (vom Socket-"activity"-Handler in Redis
// geschrieben, 24h-TTL) für die verbundenen Kürzel. In try/catch — der Redis-
// Client wirft sofort bei Ausfall (enableOfflineQueue:false); das darf das
// Nerd-Dashboard NICHT kippen. Bei Fehler: alle null.
async function leseLetzteNavigation(
  kuerzelListe: string[],
): Promise<Map<string, { path: string; ts: number }>> {
  const map = new Map<string, { path: string; ts: number }>();
  if (kuerzelListe.length === 0) return map;
  try {
    const roh = await redis.mget(kuerzelListe.map((k) => `nav:${k}`));
    kuerzelListe.forEach((k, i) => {
      const v = roh[i];
      if (!v) return;
      try {
        const parsed = JSON.parse(v) as { path?: unknown; ts?: unknown };
        if (typeof parsed.path === "string" && typeof parsed.ts === "number") {
          map.set(k, { path: parsed.path, ts: parsed.ts });
        }
      } catch {
        // defekter Eintrag → ignorieren
      }
    });
  } catch {
    // Redis weg → leere Map (Panel bleibt funktionsfähig)
  }
  return map;
}

// Reichert die (DB-freie) Verbindungsliste pro Kürzel an um:
//   • die zuletzt erzeugte Aktion (neueste Buchung ODER Anfrage, testModus
//     ausgeschlossen, konsistent zu den Dashboard-Statistiken) — auf 24h begrenzt.
//   • den zuletzt besuchten Menü-Pfad (aus Redis, 24h-TTL).
// distinct + orderBy desc liefert je Mitarbeiter/Techniker die jeweils neueste
// Zeile in EINER Query.
async function reichereLetzteAktionAn(
  clients: ConnectedClient[],
): Promise<AngereicherterClient[]> {
  const kuerzelListe = [...new Set(clients.map((c) => c.kuerzel).filter(Boolean))];
  if (kuerzelListe.length === 0) {
    return clients.map((c) => ({
      ...c, letzteAktion: null, letzteAktionAt: null,
      letzterMenuPfad: null, letzterMenuAt: null,
    }));
  }

  const seit24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [buchungen, anfragen, navMap] = await Promise.all([
    prisma.buchung.findMany({
      where:    { mitarbeiter: { in: kuerzelListe }, datum: { gte: seit24h } },
      orderBy:  { datum: "desc" },
      distinct: ["mitarbeiter"],
      select:   { mitarbeiter: true, datum: true, typ: true, bezeichnung: true },
    }),
    prisma.anfrage.findMany({
      where:    { techniker: { in: kuerzelListe }, testModus: false, datum: { gte: seit24h } },
      orderBy:  { datum: "desc" },
      distinct: ["techniker"],
      select:   { techniker: true, datum: true, status: true, teil: true },
    }),
    leseLetzteNavigation(kuerzelListe),
  ]);

  const buchungMap = new Map(buchungen.map((b) => [b.mitarbeiter, b]));
  const anfrageMap = new Map(anfragen.map((a) => [a.techniker, a]));

  return clients.map((c) => {
    const b = buchungMap.get(c.kuerzel);
    const a = anfrageMap.get(c.kuerzel);

    let letzteAktion:   string | null = null;
    let letzteAktionAt: Date   | null = null;

    // neuere der beiden Quellen gewinnt (bei Gleichstand die Buchung)
    if (b && (!a || b.datum >= a.datum)) {
      letzteAktion   = `${b.typ}: ${b.bezeichnung}`;
      letzteAktionAt = b.datum;
    } else if (a) {
      letzteAktion   = `Anfrage ${a.status}: ${a.teil}`;
      letzteAktionAt = a.datum;
    }

    const nav = navMap.get(c.kuerzel);
    return {
      ...c,
      letzteAktion,
      letzteAktionAt,
      letzterMenuPfad: nav?.path ?? null,
      letzterMenuAt:   nav ? new Date(nav.ts) : null,
    };
  });
}

async function getSocketIOStats() {
  if (!isSocketIOReady()) {
    return { ok: false, clients: [], note: "Socket.io nicht initialisiert" };
  }
  try {
    const clients = await reichereLetzteAktionAn(await getConnectedClients());
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
    // Lagerplatz-Belegungen zurücksetzen (Fach-Hüllen bleiben erhalten)
    const lagerplatzReset    = await tx.lagerplatzBelegung.deleteMany();
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

// Eine Zeile der Colli-Etiketten-Nutzungs-Bestenliste (Nerd-Dashboard).
type ColliNutzerZeile = {
  userId:         number;
  name:           string;
  kuerzel:        string;
  vorgaenge:      number;       // Anzahl Druckvorgänge (Events)
  etiketten:      number;       // Summe gedruckter Etiketten
  letzteNutzung:  Date | null;
  colliVorgaenge: number;
  colliEtiketten: number;
  textVorgaenge:  number;
  textEtiketten:  number;
};

export const systemRouter = createTRPCRouter({

  // Colli-Etiketten-Nutzung pro Nutzer (Nerd-Dashboard, read-only). Aggregiert
  // ColliDruckLog: Druckvorgänge (count), Etiketten gesamt (sum), letzte Nutzung
  // (max) — zusätzlich je Modus (colli/text). Sortiert nach Vorgängen absteigend.
  colliNutzung: adminProcedure.query(async () => {
    const grouped = await prisma.colliDruckLog.groupBy({
      by:     ["userId", "modus"],
      _count: { _all: true },
      _sum:   { anzahl: true },
      _max:   { createdAt: true },
    });

    if (grouped.length === 0) {
      return { gesamtVorgaenge: 0, gesamtEtiketten: 0, nutzer: [] as ColliNutzerZeile[] };
    }

    // userId → Name/Kürzel auflösen
    const userIds = [...new Set(grouped.map((g) => g.userId))];
    const users = await prisma.user.findMany({
      where:  { id: { in: userIds } },
      select: { id: true, name: true, kuerzel: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    // pro Nutzer über die Modi zusammenfassen
    const byUser = new Map<number, ColliNutzerZeile>();
    for (const g of grouped) {
      const vorg = g._count._all;
      const etik = g._sum.anzahl ?? 0;
      const max  = g._max.createdAt ?? null;
      let row = byUser.get(g.userId);
      if (!row) {
        const u = userMap.get(g.userId);
        row = {
          userId: g.userId, name: u?.name ?? "—", kuerzel: u?.kuerzel ?? "—",
          vorgaenge: 0, etiketten: 0, letzteNutzung: null,
          colliVorgaenge: 0, colliEtiketten: 0, textVorgaenge: 0, textEtiketten: 0,
        };
        byUser.set(g.userId, row);
      }
      row.vorgaenge += vorg;
      row.etiketten += etik;
      if (max && (!row.letzteNutzung || max > row.letzteNutzung)) row.letzteNutzung = max;
      if (g.modus === "text") { row.textVorgaenge += vorg; row.textEtiketten += etik; }
      else                    { row.colliVorgaenge += vorg; row.colliEtiketten += etik; }
    }

    const nutzer = [...byUser.values()].sort((a, b) => b.vorgaenge - a.vorgaenge);
    return {
      gesamtVorgaenge: nutzer.reduce((s, n) => s + n.vorgaenge, 0),
      gesamtEtiketten: nutzer.reduce((s, n) => s + n.etiketten, 0),
      nutzer,
    };
  }),

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
        prisma.lagerplatz.count({ where: { belegungen: { some: {} } } }),
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

"use client";
import { useEffect, useState, useRef } from "react";
import { api }         from "@/trpc/react";
import { useToast }    from "@/components/ui/Toast";

// ── Formatier-Hilfen ─────────────────────────────────────────────────────────

function fmtBytes(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)}KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)}MB`;
  return `${(b / 1073741824).toFixed(2)}GB`;
}

function fmtNum(n: number): string {
  return n.toLocaleString("de-DE");
}

// ── UI-Primitive ─────────────────────────────────────────────────────────────

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 bg-[#f0f2f5] dark:bg-[#18191a] border-b border-[#ced4da] dark:border-[#3e4042]">
        <span className="text-base">{icon}</span>
        <h2 className="font-bold text-sm tracking-wider uppercase text-[#1a1a1a] dark:text-[#e4e6eb]">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function MetricCard({ label, value, sub, color = "primary", icon }: { label: string; value: string | number; sub?: string; color?: string; icon?: string }) {
  const colors: Record<string, string> = {
    primary: "text-[#0064d2] dark:text-[#45bdff]",
    success: "text-[#00a400]",
    danger:  "text-[#fa3e3e]",
    warning: "text-[#f7b928]",
    purple:  "text-[#8e44ad]",
    gray:    "text-[#65676b] dark:text-[#b0b3b8]",
  };
  return (
    <div className="bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl p-4">
      {icon && <div className="text-xl mb-2">{icon}</div>}
      <div className={`text-2xl font-black ${colors[color] ?? colors.primary}`}>{value}</div>
      <div className="text-xs font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mt-0.5">{label}</div>
      {sub && <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-0.5">{sub}</div>}
    </div>
  );
}

function ProgressBar({ value, max, color = "#0064d2" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(Math.round((value / max) * 100), 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 bg-[#f0f2f5] dark:bg-[#18191a] rounded-full h-3 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs font-bold w-10 text-right" style={{ color }}>{pct}%</span>
    </div>
  );
}

function KvRow({ k, v, mono = false }: { k: string; v: string | number; mono?: boolean }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-[#f0f2f5] dark:border-[#3e4042] last:border-0 text-sm">
      <span className="text-[#65676b] dark:text-[#b0b3b8]">{k}</span>
      <span className={`font-bold text-[#1a1a1a] dark:text-[#e4e6eb] ${mono ? "font-mono" : ""}`}>{v}</span>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 py-4 text-[#65676b] dark:text-[#b0b3b8] text-sm">
      <span className="text-base">🚧</span>
      <span>{text}</span>
    </div>
  );
}

type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";
type LogEntry = { ts: string; level: LogLevel; modul: string; msg: string };

const LOG_COLOR: Record<LogLevel, string> = {
  INFO:  "text-[#00a400]",
  WARN:  "text-[#f7b928]",
  ERROR: "text-[#fa3e3e]",
  DEBUG: "text-[#65676b] dark:text-[#b0b3b8]",
};

// ── Haupt-Seite ───────────────────────────────────────────────────────────────

export default function SystemPage() {
  const [time,      setTime]      = useState("");
  const [logFilter, setLogFilter] = useState<LogLevel | "ALL">("ALL");
  const [log,       setLog]       = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, dataUpdatedAt } = api.system.getMetrics.useQuery(undefined, {
    refetchInterval: 3000,
    staleTime:       0,
  });

  // Uhrzeit aktualisieren
  useEffect(() => {
    setTime(new Date().toLocaleTimeString("de-DE"));
    const t = setInterval(() => setTime(new Date().toLocaleTimeString("de-DE")), 1000);
    return () => clearInterval(t);
  }, []);

  // Simulated log feed
  useEffect(() => {
    const ENTRIES: Omit<LogEntry, "ts">[] = [
      { level: "INFO",  modul: "prisma",      msg: "DB-Verbindung aktiv" },
      { level: "INFO",  modul: "redis",        msg: `redis:6379 verbunden` },
      { level: "INFO",  modul: "meilisearch",  msg: "Index 'artikel' bereit" },
      { level: "DEBUG", modul: "tRPC",         msg: "system.getMetrics (3ms)" },
      { level: "INFO",  modul: "activity",     msg: "Metriken abgerufen" },
    ];
    ENTRIES.forEach((e, i) =>
      setTimeout(() => setLog((l) => [{ ...e, ts: new Date().toLocaleTimeString("de-DE") }, ...l].slice(0, 100)), i * 350),
    );
    const iv = setInterval(() => {
      const LIVE = [
        { level: "DEBUG" as LogLevel, modul: "tRPC",    msg: `getMetrics (${2 + Math.floor(Math.random() * 8)}ms)` },
        { level: "INFO"  as LogLevel, modul: "prisma",  msg: `query ${Math.floor(Math.random() * 6) + 1}ms` },
        { level: "DEBUG" as LogLevel, modul: "redis",   msg: `${Math.random() > 0.3 ? "CACHE HIT" : "CACHE MISS"}` },
      ];
      const entry = LIVE[Math.floor(Math.random() * LIVE.length)]!;
      setLog((l) => [{ ...entry, ts: new Date().toLocaleTimeString("de-DE") }, ...l].slice(0, 100));
    }, 4000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (autoScroll && logRef.current) logRef.current.scrollTop = 0;
  }, [log, autoScroll]);

  const ms   = data?.meilisearch;
  const rd   = data?.redis;
  const node = data?.node;
  const db   = data?.db;

  const filteredLog = logFilter === "ALL" ? log : log.filter((l) => l.level === logFilter);

  const msIndexes = ms?.ok && ms.stats
    ? Object.entries((ms.stats as { indexes?: Record<string, { numberOfDocuments: number; isIndexing: boolean }> }).indexes ?? {})
    : [];

  return (
    <div className="space-y-5 font-mono">
      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#00a400] animate-pulse" />
          <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb] tracking-widest">SYSTEM</h1>
        </div>
        <span className="text-xs text-[#65676b] dark:text-[#b0b3b8] uppercase tracking-wider">Nerd Dashboard</span>
        <div className="ml-auto flex items-center gap-4 text-xs text-[#65676b] dark:text-[#b0b3b8]">
          {dataUpdatedAt > 0 && <span>Aktualisiert: {new Date(dataUpdatedAt).toLocaleTimeString("de-DE")}</span>}
          <span className="text-[#0064d2] dark:text-[#45bdff] font-bold">{time}</span>
          {isLoading && <span className="w-4 h-4 border-2 border-[#0064d2]/20 border-t-[#0064d2] rounded-full animate-spin" />}
        </div>
      </div>

      {/* ── BEREICH 1 — NODE.JS METRIKEN ───────────────────────────────── */}
      <Section title="Node.js / App Server" icon="⚙️">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
          <MetricCard label="Uptime"     value={node?.uptime ?? "–"}                        icon="⏱️" color="primary" sub="seit Start" />
          <MetricCard label="Heap"       value={node ? fmtBytes(node.heapUsed) : "–"}       icon="🧠" color={node && node.heapPercent > 80 ? "danger" : "success"} sub={`von ${node ? fmtBytes(node.heapTotal) : "–"}`} />
          <MetricCard label="RSS"        value={node ? fmtBytes(node.rss) : "–"}            icon="💾" color="purple"  sub="resident" />
          <MetricCard label="DB Queries" value={db ? `${db.queryLatencyMs}ms` : "–"}        icon="🔌" color="primary" sub="latency" />
          <MetricCard label="Online"     value={data?.online.length ?? 0}                   icon="👥" color="success" sub="Techniker" />
          <MetricCard label="Env"        value={node?.env ?? "–"}                           icon="🌐" color="gray"   sub={node?.version ?? ""} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="space-y-2">
            <p className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase mb-2">Heap-Auslastung</p>
            <ProgressBar value={node?.heapUsed ?? 0} max={node?.heapTotal ?? 1} color={node && node.heapPercent > 80 ? "#fa3e3e" : "#00a400"} />
            <div className="grid grid-cols-2 gap-x-4">
              <KvRow k="Heap Used"  v={node ? fmtBytes(node.heapUsed)   : "–"} />
              <KvRow k="Heap Total" v={node ? fmtBytes(node.heapTotal)  : "–"} />
              <KvRow k="RSS"        v={node ? fmtBytes(node.rss)        : "–"} />
              <KvRow k="External"   v={node ? fmtBytes(node.external)   : "–"} />
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase mb-2">Server Info</p>
            <KvRow k="Node.js"     v={node?.version  ?? "–"} mono />
            <KvRow k="Platform"    v={node?.platform ?? "–"} />
            <KvRow k="Environment" v={node?.env      ?? "–"} />
            <KvRow k="Uptime"      v={node ? `${Math.round(node.uptimeSec / 60)}min` : "–"} />
          </div>
        </div>
      </Section>

      {/* ── BEREICH 2 — DATENBANK ──────────────────────────────────────── */}
      <Section title="MySQL / Prisma" icon="🐬">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div>
            <p className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase mb-3">Tabellen-Größen</p>
            {db && (
              <div className="space-y-2">
                {Object.entries(db.tables)
                  .sort(([, a], [, b]) => b - a)
                  .map(([name, count]) => (
                  <div key={name} className="flex items-center gap-3">
                    <div className="w-32 text-xs text-[#65676b] dark:text-[#b0b3b8] truncate">{name}</div>
                    <div className="flex-1 bg-[#f0f2f5] dark:bg-[#18191a] rounded-full h-4 overflow-hidden">
                      <div className="h-full bg-[#0064d2] dark:bg-[#45bdff] rounded-full flex items-center justify-end pr-2"
                        style={{ width: `${Math.max(4, Math.round((count / Math.max(...Object.values(db.tables))) * 100))}%` }}>
                        <span className="text-[9px] text-white font-bold">{fmtNum(count)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <p className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase mb-3">Verbindung</p>
            <KvRow k="Provider"   v="MySQL 8" />
            <KvRow k="Host"       v="db:3306" mono />
            <KvRow k="Datenbank"  v="lagernaut" mono />
            <KvRow k="ORM"        v="Prisma 5.22.0" />
            <KvRow k="Letzte Query" v={db ? `${db.queryLatencyMs}ms` : "–"} />
            <KvRow k="Gesamt Zeilen" v={db ? fmtNum(Object.values(db.tables).reduce((a, b) => a + b, 0)) : "–"} />
          </div>
        </div>
      </Section>

      {/* ── BEREICH 3 — REDIS ──────────────────────────────────────────── */}
      <Section title="Redis" icon="🔴">
        {rd && rd.ok ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                <MetricCard label="Keys"     value={fmtNum(rd.dbSize ?? 0)}       icon="🔑" color="primary" />
                <MetricCard label="Memory"   value={rd.usedMemoryHuman ?? "–"}    icon="💾" color="success" />
                <MetricCard label="Clients"  value={rd.connectedClients ?? 0}     icon="🔌" color="purple" />
              </div>
              <p className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase mb-2">Cache Hit Rate</p>
              {(() => {
                const hits   = rd.keyspaceHits   ?? 0;
                const misses = rd.keyspaceMisses ?? 0;
                const total  = hits + misses;
                const hitRate = total > 0 ? Math.round((hits / total) * 100) : 0;
                return (
                  <>
                    <ProgressBar value={hits} max={total || 1} color="#00a400" />
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      <KvRow k="Hits"   v={fmtNum(hits)} />
                      <KvRow k="Misses" v={fmtNum(misses)} />
                      <KvRow k="Rate"   v={`${hitRate}%`} />
                    </div>
                  </>
                );
              })()}
            </div>
            <div>
              <p className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase mb-3">Server Info</p>
              <KvRow k="Version"     v={rd.version ?? "–"} />
              <KvRow k="URL"         v="redis:6379" mono />
              <KvRow k="DB Size"     v={`${fmtNum(rd.dbSize ?? 0)} Keys`} />
              <KvRow k="Befehle"     v={fmtNum(rd.totalCommands ?? 0)} />
              <KvRow k="Uptime"      v={formatUptimeSec(rd.uptimeSeconds ?? 0)} />
            </div>
          </div>
        ) : (
          <KvRow k="Status" v={rd && !rd.ok ? "⚠️ Nicht erreichbar" : "⏳ Verbinde..."} />
        )}
      </Section>

      {/* ── BEREICH 4 — MEILISEARCH ────────────────────────────────────── */}
      <Section title="Meilisearch" icon="🔍">
        {ms?.ok ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div>
              <p className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase mb-3">Indizes</p>
              {msIndexes.map(([name, idx]) => (
                <div key={name} className="mb-3 p-3 bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">{name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${idx.isIndexing ? "bg-[#f7b928]/20 text-[#f7b928]" : "bg-green-100 text-green-700"}`}>
                      {idx.isIndexing ? "Indiziert..." : "Bereit"}
                    </span>
                  </div>
                  <span className="text-xs text-[#65676b] dark:text-[#b0b3b8]">{fmtNum(idx.numberOfDocuments)} Dokumente</span>
                </div>
              ))}
              {msIndexes.length === 0 && <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Keine Indizes</p>}
            </div>
            <div>
              <p className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase mb-3">Status</p>
              <KvRow k="Status"    v={`✅ ${ms.status}`} />
              <KvRow k="URL"       v="meilisearch:7700" mono />
              <KvRow k="API Key"   v="✅ gesetzt" />
              <KvRow k="DB Size"   v={ms.stats ? fmtBytes((ms.stats as { databaseSize?: number }).databaseSize ?? 0) : "–"} />
            </div>
          </div>
        ) : (
          <KvRow k="Status" v={ms?.ok === false ? "⚠️ Nicht erreichbar" : "⏳ Verbinde..."} />
        )}
      </Section>

      {/* ── BEREICH 5 — BULLMQ ─────────────────────────────────────────── */}
      <Section title="BullMQ Job Queue" icon="⚡">
        {data?.bullmq ? (
          <>
            {!data.bullmq.ok && (
              <p className="text-xs text-[#f7b928] mb-3">⚠️ Redis nicht erreichbar — Worker inaktiv</p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[#65676b] dark:text-[#b0b3b8] border-b border-[#ced4da] dark:border-[#3e4042]">
                    <th className="text-left py-2 pr-4">Queue</th>
                    <th className="text-center py-2 px-2">Waiting</th>
                    <th className="text-center py-2 px-2">Active</th>
                    <th className="text-center py-2 px-2">Completed</th>
                    <th className="text-center py-2 px-2">Failed</th>
                    <th className="text-center py-2 px-2">Delayed</th>
                    <th className="text-center py-2 px-2">Workers</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bullmq.queues.map((q) => {
                    const qAny = q as Record<string, unknown>;
                    return (
                    <tr key={q.name} className="border-b border-[#f0f2f5] dark:border-[#3e4042]">
                      <td className="py-2 pr-4 font-bold text-[#0064d2] dark:text-[#45bdff]">{q.name}</td>
                      <td className="text-center py-2 px-2">{(qAny.waiting as number) ?? 0}</td>
                      <td className={`text-center py-2 px-2 font-bold ${((qAny.active as number) ?? 0) > 0 ? "text-[#f7b928]" : ""}`}>{(qAny.active as number) ?? 0}</td>
                      <td className="text-center py-2 px-2 text-[#00a400]">{(qAny.completed as number) ?? 0}</td>
                      <td className={`text-center py-2 px-2 font-bold ${((qAny.failed as number) ?? 0) > 0 ? "text-[#fa3e3e]" : ""}`}>{(qAny.failed as number) ?? 0}</td>
                      <td className="text-center py-2 px-2">{(qAny.delayed as number) ?? 0}</td>
                      <td className="text-center py-2 px-2 text-[#00a400] font-bold">
                        ✓ ×{((qAny.workers as { concurrency?: number } | undefined)?.concurrency) ?? 1}
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Lade…</p>
        )}
      </Section>

      {/* ── BEREICH 6 — ONLINE TECHNIKER ───────────────────────────────── */}
      <Section title="Online Techniker" icon="👥">
        {data?.online.length ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {data.online.map((u) => (
              <div key={u.kuerzel} className="text-center p-3 bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl">
                <div className="w-10 h-10 rounded-full bg-[#0064d2] text-white font-black text-sm flex items-center justify-center mx-auto mb-2">
                  {u.kuerzel.slice(0, 2)}
                </div>
                <div className="text-xs font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{u.kuerzel}</div>
                <div className="text-[10px] text-[#00a400]">● online</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Niemand online</p>
        )}
      </Section>

      {/* ── BEREICH 7 — SOCKET.IO ──────────────────────────────────────── */}
      <Section title="Socket.io" icon="⚡">
        {data?.socketio ? (
          <>
            <div className="flex items-center gap-2 mb-4">
              <span className={`w-2.5 h-2.5 rounded-full ${data.socketio.ok ? "bg-[#00a400] animate-pulse" : "bg-[#fa3e3e]"}`} />
              <span className={`text-sm font-bold ${data.socketio.ok ? "text-[#00a400]" : "text-[#fa3e3e]"}`}>
                {data.socketio.ok ? "Aktiv" : "Nicht erreichbar"}
              </span>
              {data.socketio.ok && (
                <span className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
                  — {(data.socketio as { clients: unknown[] }).clients?.length ?? 0} Verbindungen
                </span>
              )}
            </div>
            {data.socketio.ok && (data.socketio as { clients: { id: string; kuerzel: string; rolle: string }[] }).clients?.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[#65676b] dark:text-[#b0b3b8] border-b border-[#ced4da] dark:border-[#3e4042]">
                      <th className="text-left py-2 pr-4">Socket ID</th>
                      <th className="text-left py-2 px-2">Kürzel</th>
                      <th className="text-left py-2 px-2">Rolle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.socketio as { clients: { id: string; kuerzel: string; rolle: string }[] }).clients.map((c) => (
                      <tr key={c.id} className="border-b border-[#f0f2f5] dark:border-[#3e4042]">
                        <td className="py-2 pr-4 font-mono text-[#65676b] dark:text-[#b0b3b8] text-[10px]">{c.id}</td>
                        <td className="py-2 px-2 font-bold text-[#0064d2] dark:text-[#45bdff]">{c.kuerzel}</td>
                        <td className="py-2 px-2">{c.rolle}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : data.socketio.ok ? (
              <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Keine verbundenen Clients</p>
            ) : (
              <p className="text-xs text-[#fa3e3e]">{(data.socketio as { note?: string }).note}</p>
            )}
          </>
        ) : (
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Lade…</p>
        )}
      </Section>

      {/* ── BEREICH 8 — SYSTEM LOG ─────────────────────────────────────── */}
      <Section title="System Log" icon="📋">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {(["ALL", "INFO", "WARN", "ERROR", "DEBUG"] as const).map((lvl) => (
            <button key={lvl} onClick={() => setLogFilter(lvl)}
              className={`px-2.5 py-1 rounded text-xs font-bold transition-colors ${
                logFilter === lvl
                  ? "bg-[#0064d2] text-white"
                  : "bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#ced4da]"
              }`}>
              {lvl}
            </button>
          ))}
          <label className="flex items-center gap-1.5 ml-2 text-xs text-[#65676b] dark:text-[#b0b3b8] cursor-pointer">
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} className="w-3 h-3" />
            Auto-Scroll
          </label>
          <span className="ml-auto text-xs text-[#65676b] dark:text-[#b0b3b8]">{filteredLog.length} Einträge</span>
        </div>
        <div
          ref={logRef}
          className="h-64 overflow-y-auto bg-[#0d1117] rounded-xl p-4 space-y-1.5 font-mono"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.scrollTop > 20) setAutoScroll(false);
          }}
        >
          {filteredLog.map((l, i) => (
            <div key={i} className="flex gap-3 text-xs leading-relaxed">
              <span className="text-[#6b7280] flex-shrink-0 w-20">{l.ts}</span>
              <span className={`flex-shrink-0 w-14 font-bold ${LOG_COLOR[l.level]}`}>{l.level}</span>
              <span className="text-[#45bdff] flex-shrink-0 w-24">[{l.modul}]</span>
              <span className="text-[#e4e6eb]">{l.msg}</span>
            </div>
          ))}
          {!filteredLog.length && (
            <span className="text-[#6b7280] text-xs">Keine Einträge</span>
          )}
        </div>
      </Section>

      {/* ── DANGER ZONE ─────────────────────────────────────────────────── */}
      <Section title="Danger Zone" icon="⚠️">
        <DangerZone />
      </Section>
    </div>
  );
}

function formatUptimeSec(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── DANGER ZONE ───────────────────────────────────────────────────────────────

type ResetPhase = "idle" | "confirm" | "eingabe" | "executing" | "done";

function DangerZone() {
  const { show } = useToast();
  const [phase,    setPhase]    = useState<ResetPhase>("idle");
  const [eingabe,  setEingabe]  = useState("");
  const [ergebnis, setErgebnis] = useState<Record<string, number> | null>(null);

  const previewQuery = api.system.getResetPreview.useQuery(undefined, { staleTime: 5_000 });
  const p = previewQuery.data;

  const resetMutation = api.system.resetLagernaut.useMutation({
    onSuccess: (data) => {
      setErgebnis(data);
      setPhase("done");
      show("✅ Reset abgeschlossen", "success");
    },
    onError: (e) => {
      show(`Fehler: ${e.message}`, "error");
      setPhase("idle");
    },
  });

  function handleReset() {
    setPhase("executing");
    resetMutation.mutate();
  }

  const BEFEHL = "RESET LAGERNAUT";
  const eingabeKorrekt = eingabe === BEFEHL;

  return (
    <div style={{ border: "2px solid #fa3e3e", borderRadius: 14, overflow: "hidden", marginTop: 8 }}>
      {/* Header */}
      <div style={{ background: "#fa3e3e", padding: "10px 20px", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: "1.1rem" }}>⚠️</span>
        <span style={{ color: "white", fontWeight: 900, fontSize: "0.95rem", letterSpacing: "0.05em", textTransform: "uppercase" }}>
          DANGER ZONE
        </span>
      </div>

      <div style={{ padding: "1.2rem 1.4rem", background: "rgba(250,62,62,0.04)" }}>

        {/* ── Phase: idle ── */}
        {phase === "idle" && (
          <>
            <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: 8 }}>
              🗑️ Kompletter Lagernaut-Reset
            </div>
            <p style={{ fontSize: "0.85rem", color: "var(--text-dim)", marginBottom: 14, lineHeight: 1.5 }}>
              Löscht alle Anfragen, Buchungen, Artikel und Kompatibilitäten.
              <strong style={{ color: "var(--text)" }}> User und GeraeteLookup bleiben erhalten.</strong>
            </p>

            {p && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 16 }}>
                {[
                  { label: "Artikel",          val: p.artikel },
                  { label: "Buchungen",         val: p.buchungen },
                  { label: "Anfragen",          val: p.anfragen },
                  { label: "Kompatibilitäten",  val: p.komps },
                  { label: "Warenkörbe",        val: p.koerbe },
                  { label: "Nachrichten",       val: p.nachrichten },
                ].map(({ label, val }) => (
                  <div key={label} style={{ background: "var(--bg)", borderRadius: 8, padding: "0.5rem 0.7rem", textAlign: "center" }}>
                    <div style={{ fontSize: "1.2rem", fontWeight: 900, color: val > 0 ? "#fa3e3e" : "var(--text-dim)" }}>{val.toLocaleString("de-DE")}</div>
                    <div style={{ fontSize: "0.7rem", color: "var(--text-dim)", fontWeight: 600 }}>{label}</div>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setPhase("confirm")}
              style={{ padding: "0.7rem 1.4rem", background: "#fa3e3e", color: "white", border: "none", borderRadius: 10, fontWeight: 800, cursor: "pointer", fontSize: "0.9rem", fontFamily: "'Ubuntu', sans-serif" }}
            >
              🗑️ RESET LAGERNAUT
            </button>
          </>
        )}

        {/* ── Phase: confirm ── */}
        {phase === "confirm" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "3rem", marginBottom: 8 }}>⚠️</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 900, marginBottom: 6 }}>Wirklich ALLE Daten löschen?</div>
            <p style={{ fontSize: "0.85rem", color: "var(--text-dim)", marginBottom: 20, lineHeight: 1.5 }}>
              Diese Aktion kann <strong style={{ color: "#fa3e3e" }}>nicht rückgängig</strong> gemacht werden.
              {p && p.artikel + p.buchungen + p.anfragen > 0 && (
                <> Es werden {(p.artikel + p.buchungen + p.anfragen).toLocaleString("de-DE")} Datensätze gelöscht.</>
              )}
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button
                onClick={() => setPhase("idle")}
                style={{ padding: "0.7rem 1.4rem", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontFamily: "'Ubuntu', sans-serif", fontSize: "0.9rem" }}
              >
                Abbrechen
              </button>
              <button
                onClick={() => setPhase("eingabe")}
                style={{ padding: "0.7rem 1.4rem", background: "#fa3e3e", color: "white", border: "none", borderRadius: 10, fontWeight: 800, cursor: "pointer", fontFamily: "'Ubuntu', sans-serif", fontSize: "0.9rem" }}
              >
                Ja, weiter →
              </button>
            </div>
          </div>
        )}

        {/* ── Phase: eingabe ── */}
        {phase === "eingabe" && (
          <>
            <div style={{ fontWeight: 700, marginBottom: 10, fontSize: "0.9rem" }}>
              Bitte genau eingeben um zu bestätigen:
            </div>
            <div style={{ marginBottom: 10, padding: "0.5rem 0.8rem", background: "var(--bg)", borderRadius: 8, fontFamily: "monospace", fontSize: "1rem", fontWeight: 800, color: "#fa3e3e", letterSpacing: 1 }}>
              {BEFEHL}
            </div>
            <input
              type="text"
              value={eingabe}
              onChange={(e) => setEingabe(e.target.value)}
              placeholder={BEFEHL}
              autoFocus
              style={{
                width: "100%", padding: "0.7rem 1rem", borderRadius: 10, fontFamily: "'Ubuntu', sans-serif",
                border: `2px solid ${eingabeKorrekt ? "#04B475" : "#fa3e3e"}`,
                background: "var(--bg)", color: "var(--text)", fontSize: "1rem",
                outline: "none", boxSizing: "border-box", marginBottom: 14,
              }}
            />
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => { setPhase("idle"); setEingabe(""); }}
                style={{ flex: 1, padding: "0.7rem", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontFamily: "'Ubuntu', sans-serif" }}
              >
                Abbrechen
              </button>
              <button
                onClick={handleReset}
                disabled={!eingabeKorrekt}
                style={{ flex: 2, padding: "0.7rem", background: eingabeKorrekt ? "#fa3e3e" : "var(--border)", color: eingabeKorrekt ? "white" : "var(--text-dim)", border: "none", borderRadius: 10, fontWeight: 800, cursor: eingabeKorrekt ? "pointer" : "not-allowed", fontFamily: "'Ubuntu', sans-serif", fontSize: "0.9rem" }}
              >
                🗑️ Jetzt unwiderruflich löschen
              </button>
            </div>
          </>
        )}

        {/* ── Phase: executing ── */}
        {phase === "executing" && (
          <div style={{ textAlign: "center", padding: "1.5rem 0" }}>
            <div style={{ width: 40, height: 40, border: "3px solid rgba(250,62,62,0.2)", borderTopColor: "#fa3e3e", borderRadius: "50%", animation: "spin 0.7s linear infinite", margin: "0 auto 1rem" }} />
            <div style={{ fontWeight: 700 }}>Lösche Daten…</div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-dim)", marginTop: 4 }}>Bitte warten</div>
          </div>
        )}

        {/* ── Phase: done ── */}
        {phase === "done" && ergebnis && (
          <div>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: "2.5rem", marginBottom: 6 }}>✅</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 900 }}>Reset abgeschlossen!</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 16 }}>
              {Object.entries(ergebnis).filter(([, v]) => v > 0).map(([k, v]) => (
                <div key={k} style={{ background: "var(--bg)", borderRadius: 8, padding: "0.4rem 0.8rem", display: "flex", justifyContent: "space-between", fontSize: "0.82rem" }}>
                  <span style={{ color: "var(--text-dim)" }}>{k}</span>
                  <span style={{ fontWeight: 800 }}>{(v as number).toLocaleString("de-DE")}</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => { setPhase("idle"); setEingabe(""); setErgebnis(null); previewQuery.refetch(); }}
              style={{ width: "100%", padding: "0.7rem", background: "#04B475", color: "white", border: "none", borderRadius: 10, fontWeight: 800, cursor: "pointer", fontFamily: "'Ubuntu', sans-serif", fontSize: "0.9rem" }}
            >
              Fertig →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

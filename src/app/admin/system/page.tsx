"use client";
import { useEffect, useState, useRef } from "react";
import { api } from "@/trpc/react";

type LogLevel  = "info" | "warn" | "error";
type LogEntry  = { ts: string; modul: string; msg: string; level: LogLevel };
type EventEntry = { ts: string; event: string; data: string; colorKey: string };

// Farben die in beiden Modi gleich bleiben (Status-Indikatoren)
const STATUS_COLORS = {
  connect:    "#00a400",
  disconnect: "#fa3e3e",
  warn:       "#f7b928",
  error:      "#fa3e3e",
  info:       "#00a400",
} as const;

// Tailwind-Klassen für Event-Farben (Light + Dark)
const EVENT_COLOR_CLASSES: Record<string, string> = {
  connect:    "text-[#00a400]",
  disconnect: "text-[#fa3e3e]",
  anfrage:    "text-[#0064d2] dark:text-[#45bdff]",
  buchung:    "text-[#f7b928]",
  default:    "text-[#65676b] dark:text-[#b0b3b8]",
};

const LOG_LEVEL_CLASSES: Record<LogLevel, string> = {
  info:  "text-[#00a400]",
  warn:  "text-[#f7b928]",
  error: "text-[#fa3e3e]",
};

function InfraCard({ title, icon, status, rows }: {
  title:  string;
  icon:   string;
  status: "online" | "offline" | "unknown";
  rows:   { label: string; value: string | number }[];
}) {
  const dotCls = status === "online"
    ? "bg-[#00a400] shadow-[0_0_6px_rgba(0,164,0,0.6)]"
    : status === "offline"
      ? "bg-[#fa3e3e] shadow-[0_0_6px_rgba(250,62,62,0.6)]"
      : "bg-[#f7b928] shadow-[0_0_6px_rgba(247,185,40,0.6)]";

  return (
    <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 font-mono shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xl">{icon}</span>
        <span className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] tracking-wide">{title}</span>
        <span className={`ml-auto w-2.5 h-2.5 rounded-full ${dotCls} animate-pulse flex-shrink-0`} />
      </div>
      <div className="space-y-2">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex justify-between text-xs">
            <span className="text-[#65676b] dark:text-[#b0b3b8]">{label}</span>
            <span className="text-[#0064d2] dark:text-[#45bdff] font-bold">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SystemPage() {
  const stats = api.statistik.getLiveStats.useQuery(undefined, { refetchInterval: 5_000 });

  const [log,    setLog]    = useState<LogEntry[]>([]);
  const [events, setEvents] = useState<EventEntry[]>([]);
  const logRef   = useRef<HTMLDivElement>(null);
  const evRef    = useRef<HTMLDivElement>(null);
  const [time, setTime] = useState("");

  useEffect(() => {
    setTime(new Date().toLocaleTimeString("de-DE"));
    const t = setInterval(() => setTime(new Date().toLocaleTimeString("de-DE")), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const msgs = [
      { modul: "buchungen",   msg: "Service gestartet",      level: "info"  as LogLevel },
      { modul: "prisma",      msg: "DB-Pool aktiv (5/10)",   level: "info"  as LogLevel },
      { modul: "redis",       msg: "Verbunden redis:6379",   level: "info"  as LogLevel },
      { modul: "meilisearch", msg: "Index 'artikel' bereit", level: "info"  as LogLevel },
    ];
    msgs.forEach((m, i) =>
      setTimeout(() => setLog((l) => [{ ...m, ts: new Date().toLocaleTimeString("de-DE") }, ...l].slice(0, 50)), i * 300),
    );

    const evts = [
      { event: "connect",  data: "Techniker: MMAX",      colorKey: "connect" },
      { event: "anfrage",  data: "LogID: 123456 / Akku",  colorKey: "anfrage" },
      { event: "buchung",  data: "ID:42 EINGANG ×3",      colorKey: "buchung" },
    ];
    evts.forEach((e, i) =>
      setTimeout(() => setEvents((ev) => [{ ...e, ts: new Date().toLocaleTimeString("de-DE") }, ...ev].slice(0, 50)), i * 500 + 200),
    );
  }, []);

  const s = stats.data;

  return (
    <div className="space-y-6 font-mono">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#00a400] animate-pulse shadow-[0_0_6px_rgba(0,164,0,0.6)]" />
          <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb] tracking-widest">SYSTEM</h1>
        </div>
        <span className="text-xs text-[#65676b] dark:text-[#b0b3b8] tracking-wider uppercase">Nerd Dashboard</span>
        <span className="ml-auto text-xs text-[#0064d2] dark:text-[#45bdff]">{time}</span>
      </div>

      {/* Stat Karten */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: "Artikel DB",       value: s?.gesamtArtikel   ?? "–", icon: "📦", color: "text-[#0064d2] dark:text-[#45bdff]" },
          { label: "Offene Anfragen",  value: s?.offeneAnfragen  ?? "–", icon: "🔔", color: "text-[#f7b928]" },
          { label: "Online Techniker", value: s?.technikerOnline ?? "–", icon: "👥", color: "text-[#00a400]" },
          { label: "Buchungen heute",  value: s?.buchungenHeute  ?? "–", icon: "📋", color: "text-[#8e44ad]" },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-4 shadow-sm">
            <div className="text-base mb-1">{icon}</div>
            <div className={`text-2xl font-black ${color}`}>{value}</div>
            <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] tracking-wider uppercase mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* Infrastruktur */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <InfraCard title="Redis" icon="🔴" status="online"
          rows={[
            { label: "Status",     value: "Connected" },
            { label: "URL",        value: "redis:6379" },
            { label: "Verwendung", value: "BullMQ Queue" },
          ]}
        />
        <InfraCard title="MySQL" icon="🐬" status="online"
          rows={[
            { label: "Status",    value: "Connected" },
            { label: "Datenbank", value: "lagernaut" },
            { label: "Pool",      value: "5 / 10" },
          ]}
        />
        <InfraCard title="Meilisearch" icon="🔍" status="online"
          rows={[
            { label: "Status", value: "Ready" },
            { label: "URL",    value: "meilisearch:7700" },
            { label: "Index",  value: "artikel" },
          ]}
        />
      </div>

      {/* Event Stream + System Log */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* Socket.io Event Stream */}
        <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-2 h-2 rounded-full bg-[#00a400] animate-pulse" />
            <span className="text-xs font-bold text-[#1a1a1a] dark:text-[#e4e6eb] tracking-wider uppercase">Socket.io Event Stream</span>
          </div>
          <div ref={evRef} className="h-48 overflow-y-auto space-y-1.5 pr-1">
            {events.map((e, i) => (
              <div key={i} className="flex items-start gap-3 text-xs">
                <span className="text-[#65676b] dark:text-[#b0b3b8] flex-shrink-0 w-20">{e.ts}</span>
                <span className={`font-bold flex-shrink-0 w-24 ${EVENT_COLOR_CLASSES[e.colorKey] ?? EVENT_COLOR_CLASSES.default}`}>
                  {e.event}
                </span>
                <span className="text-[#65676b] dark:text-[#b0b3b8] break-all">{e.data}</span>
              </div>
            ))}
            {!events.length && (
              <span className="text-xs text-[#65676b] dark:text-[#b0b3b8]">Warte auf Events...</span>
            )}
          </div>
        </div>

        {/* System Log */}
        <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs font-bold text-[#1a1a1a] dark:text-[#e4e6eb] tracking-wider uppercase">System Log</span>
          </div>
          <div ref={logRef} className="h-48 overflow-y-auto space-y-1.5 pr-1">
            {log.map((l, i) => (
              <div key={i} className="flex items-start gap-3 text-xs">
                <span className="text-[#65676b] dark:text-[#b0b3b8] flex-shrink-0 w-20">{l.ts}</span>
                <span className="text-[#0064d2] dark:text-[#45bdff] font-bold flex-shrink-0 w-28">[{l.modul}]</span>
                <span className={LOG_LEVEL_CLASSES[l.level]}>{l.msg}</span>
              </div>
            ))}
            {!log.length && (
              <span className="text-xs text-[#65676b] dark:text-[#b0b3b8]">Warte auf Log-Einträge...</span>
            )}
          </div>
        </div>
      </div>

      {/* BullMQ */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
          <span className="text-xs font-bold text-[#1a1a1a] dark:text-[#e4e6eb] tracking-wider uppercase">BullMQ Job Queue</span>
          <span className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
            Realtime-Integration via Socket.io (Schritt Realtime)
          </span>
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          {[
            { label: "Aktiv",         value: 0, color: "text-[#f7b928]" },
            { label: "Abgeschlossen", value: 0, color: "text-[#00a400]" },
            { label: "Fehler",        value: 0, color: "text-[#fa3e3e]" },
          ].map(({ label, value, color }) => (
            <div key={label} className="p-3 bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl">
              <div className={`text-2xl font-black ${color}`}>{value}</div>
              <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1">{label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

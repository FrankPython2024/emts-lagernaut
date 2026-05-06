"use client";
import { useEffect, useState, useRef } from "react";
import { api } from "@/trpc/react";

type LogEntry  = { ts: string; modul: string; msg: string; level: "info" | "warn" | "error" };
type EventEntry = { ts: string; event: string; data: string; color: string };

const EVENT_COLORS: Record<string, string> = {
  connect:    "#00a400",
  disconnect: "#fa3e3e",
  anfrage:    "#0064d2",
  buchung:    "#f7b928",
  default:    "#b0b3b8",
};

function InfraCard({ title, icon, status, rows }: {
  title:  string;
  icon:   string;
  status: "online" | "offline" | "unknown";
  rows:   { label: string; value: string | number }[];
}) {
  const dot = status === "online" ? "bg-[#00a400]" : status === "offline" ? "bg-[#fa3e3e]" : "bg-[#f7b928]";
  return (
    <div className="bg-[#1a1a2e] dark:bg-[#0d0d1a] rounded-xl border border-[#2a2a4a] p-5 font-mono">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xl">{icon}</span>
        <span className="font-bold text-[#e4e6eb] tracking-wide">{title}</span>
        <span className={`ml-auto w-2.5 h-2.5 rounded-full ${dot} animate-pulse`} />
      </div>
      <div className="space-y-2">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex justify-between text-xs">
            <span className="text-[#6b7280]">{label}</span>
            <span className="text-[#45bdff] font-bold">{value}</span>
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

  // Simulated live log (real Socket.io integration kommt mit Schritt Realtime)
  useEffect(() => {
    const msgs = [
      { modul: "buchungen", msg: "Service gestartet", level: "info" as const },
      { modul: "prisma",    msg: "DB-Pool aktiv (5/10)", level: "info" as const },
      { modul: "redis",     msg: "Verbunden redis:6379", level: "info" as const },
      { modul: "meilisearch", msg: "Index 'artikel' bereit", level: "info" as const },
    ];
    msgs.forEach((m, i) => {
      setTimeout(() => {
        setLog((l) => [{ ...m, ts: new Date().toLocaleTimeString("de-DE") }, ...l].slice(0, 50));
      }, i * 300);
    });

    const evts = [
      { event: "connect",    data: "Techniker: MMAX", color: EVENT_COLORS.connect },
      { event: "anfrage",    data: "LogID: 123456 / Akku", color: EVENT_COLORS.anfrage },
      { event: "buchung",    data: "ID:42 EINGANG ×3", color: EVENT_COLORS.buchung },
    ];
    evts.forEach((e, i) => {
      setTimeout(() => {
        setEvents((ev) => [{ ...e, ts: new Date().toLocaleTimeString("de-DE") }, ...ev].slice(0, 50));
      }, i * 500 + 200);
    });
  }, []);

  useEffect(() => { logRef.current?.scrollTo({ top: 0 }); }, [log]);
  useEffect(() => { evRef.current?.scrollTo({ top: 0 }); }, [events]);

  const s = stats.data;

  return (
    <div className="space-y-6 font-mono">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#00a400] animate-pulse" />
          <h1 className="text-2xl font-black text-[#e4e6eb] tracking-widest">SYSTEM</h1>
        </div>
        <span className="text-xs text-[#6b7280] tracking-wider">NERD DASHBOARD</span>
        <span className="ml-auto text-xs text-[#45bdff]">{new Date().toLocaleTimeString("de-DE")}</span>
      </div>

      {/* Stat Karten */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: "Artikel DB",        value: s?.gesamtArtikel   ?? "–", icon: "📦", color: "#45bdff" },
          { label: "Offene Anfragen",   value: s?.offeneAnfragen  ?? "–", icon: "🔔", color: "#f7b928" },
          { label: "Online Techniker",  value: s?.technikerOnline ?? "–", icon: "👥", color: "#00a400" },
          { label: "Buchungen heute",   value: s?.buchungenHeute  ?? "–", icon: "📋", color: "#8e44ad" },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="bg-[#1a1a2e] dark:bg-[#0d0d1a] rounded-xl border border-[#2a2a4a] p-4">
            <div className="text-base mb-1">{icon}</div>
            <div className="text-2xl font-black" style={{ color }}>{value}</div>
            <div className="text-xs text-[#6b7280] tracking-wider uppercase mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* Infrastruktur */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <InfraCard
          title="Redis" icon="🔴" status="online"
          rows={[
            { label: "Status",       value: "Connected" },
            { label: "URL",          value: "redis:6379" },
            { label: "Verwendung",   value: "BullMQ Queue" },
          ]}
        />
        <InfraCard
          title="MySQL" icon="🐬" status="online"
          rows={[
            { label: "Status",     value: "Connected" },
            { label: "Datenbank",  value: "lagernaut" },
            { label: "Pool",       value: "5 / 10" },
          ]}
        />
        <InfraCard
          title="Meilisearch" icon="🔍" status="online"
          rows={[
            { label: "Status",  value: "Ready" },
            { label: "URL",     value: "meilisearch:7700" },
            { label: "Index",   value: "artikel" },
          ]}
        />
      </div>

      {/* Event Stream + System Log */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Socket.io Events */}
        <div className="bg-[#1a1a2e] dark:bg-[#0d0d1a] rounded-xl border border-[#2a2a4a] p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-2 h-2 rounded-full bg-[#00a400] animate-pulse" />
            <span className="text-sm font-bold text-[#e4e6eb] tracking-wider">SOCKET.IO EVENT STREAM</span>
          </div>
          <div ref={evRef} className="h-48 overflow-y-auto space-y-1.5 pr-1">
            {events.map((e, i) => (
              <div key={i} className="flex items-start gap-3 text-xs">
                <span className="text-[#6b7280] flex-shrink-0 w-20">{e.ts}</span>
                <span className="font-bold flex-shrink-0 w-24" style={{ color: e.color }}>{e.event}</span>
                <span className="text-[#b0b3b8] break-all">{e.data}</span>
              </div>
            ))}
            {!events.length && <span className="text-[#6b7280] text-xs">Warte auf Events...</span>}
          </div>
        </div>

        {/* System Log */}
        <div className="bg-[#1a1a2e] dark:bg-[#0d0d1a] rounded-xl border border-[#2a2a4a] p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm font-bold text-[#e4e6eb] tracking-wider">SYSTEM LOG</span>
          </div>
          <div ref={logRef} className="h-48 overflow-y-auto space-y-1.5 pr-1">
            {log.map((l, i) => {
              const col = l.level === "error" ? "#fa3e3e" : l.level === "warn" ? "#f7b928" : "#00a400";
              return (
                <div key={i} className="flex items-start gap-3 text-xs">
                  <span className="text-[#6b7280] flex-shrink-0 w-20">{l.ts}</span>
                  <span className="font-bold flex-shrink-0 w-28" style={{ color: "#45bdff" }}>[{l.modul}]</span>
                  <span style={{ color: col }}>{l.msg}</span>
                </div>
              );
            })}
            {!log.length && <span className="text-[#6b7280] text-xs">Warte auf Log-Einträge...</span>}
          </div>
        </div>
      </div>

      {/* BullMQ Placeholder */}
      <div className="bg-[#1a1a2e] dark:bg-[#0d0d1a] rounded-xl border border-[#2a2a4a] p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm font-bold text-[#e4e6eb] tracking-wider">BULLMQ JOB QUEUE</span>
          <span className="ml-auto text-xs text-[#6b7280]">Realtime-Integration via Socket.io (Schritt Realtime)</span>
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          {[
            { label: "Aktiv",       value: 0, color: "#f7b928" },
            { label: "Abgeschlossen", value: 0, color: "#00a400" },
            { label: "Fehler",      value: 0, color: "#fa3e3e" },
          ].map(({ label, value, color }) => (
            <div key={label} className="p-3 bg-[#0d0d1a] rounded-xl">
              <div className="text-2xl font-black" style={{ color }}>{value}</div>
              <div className="text-xs text-[#6b7280] mt-1">{label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

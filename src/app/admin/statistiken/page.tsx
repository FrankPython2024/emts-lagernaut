"use client";
import { useState } from "react";
import { api } from "@/trpc/react";
import { StatCard } from "@/components/ui/StatCard";

type FilterRange = "heute" | "woche" | "monat" | "quartal" | "jahr";

const TAGE_MAP: Record<FilterRange, number> = {
  heute:   1,
  woche:   7,
  monat:   30,
  quartal: 90,
  jahr:    365,
};

const FILTER_OPTS: { key: FilterRange; label: string }[] = [
  { key: "heute",   label: "Heute" },
  { key: "woche",   label: "Woche" },
  { key: "monat",   label: "Monat" },
  { key: "quartal", label: "Quartal" },
  { key: "jahr",    label: "Jahr" },
];

function HBarChart({ items }: { items: { label: string; value: number }[] }) {
  if (!items.length) return <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-3 text-center py-4">Keine Daten</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="space-y-2 mt-3">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-3">
          <div className="w-28 text-xs text-[#65676b] dark:text-[#b0b3b8] truncate text-right flex-shrink-0">{item.label}</div>
          <div className="flex-1 bg-[#f0f2f5] dark:bg-[#18191a] rounded-full h-5 overflow-hidden">
            <div
              className="h-full bg-[#0064d2] dark:bg-[#45bdff] rounded-full flex items-center justify-end pr-2 transition-all duration-700"
              style={{ width: `${(item.value / max) * 100}%` }}
            >
              <span className="text-[10px] text-white font-bold">{item.value}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SparkLine({ data }: { data: { datum: string; eingang: number; ausgang: number }[] }) {
  if (!data.length) return <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-3 text-center py-4">Keine Daten</p>;
  const maxVal = Math.max(...data.map((d) => d.eingang + d.ausgang), 1);
  return (
    <div className="flex items-end gap-0.5 h-16 mt-3">
      {data.map((d) => (
        <div key={d.datum} className="flex-1 flex flex-col gap-0.5 justify-end" title={`${d.datum}: +${d.eingang} -${d.ausgang}`}>
          <div className="bg-[#fa3e3e]/70 rounded-sm" style={{ height: `${(d.ausgang / maxVal) * 60}px` }} />
          <div className="bg-[#00a400]/70 rounded-sm" style={{ height: `${(d.eingang / maxVal) * 60}px` }} />
        </div>
      ))}
    </div>
  );
}

function QueryError({ label }: { label: string }) {
  return <p className="text-xs text-[#fa3e3e] mt-2">{label} konnte nicht geladen werden.</p>;
}

function CardSkeleton() {
  return <div className="h-24 bg-[#f0f2f5] dark:bg-[#3e4042] rounded-xl animate-pulse" />;
}

export default function StatistikenPage() {
  const [filter, setFilter] = useState<FilterRange>("monat");
  const tage = TAGE_MAP[filter]; // stabiler number — kein Date-Objekt → kein Query-Key-Flicker

  const kpi       = api.statistik.getKpiOverview.useQuery({ tage });
  const verlauf   = api.statistik.getBuchungenVerlauf.useQuery({ tage });
  const geraete   = api.statistik.getMeistgefragteGeraete.useQuery({ tage: 30 });
  const teile     = api.statistik.getMeistgefragteTeile.useQuery({ tage: 30 });
  const techStats = api.statistik.getTechnikerStats.useQuery({ tage });
  const statusData = api.statistik.getAnfragenNachStatus.useQuery();

  return (
    <div className="space-y-6">
      {/* Header + Filter */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Statistiken</h1>
        <div className="flex bg-white dark:bg-[#242526] border border-[#ced4da] dark:border-[#3e4042] rounded-xl overflow-hidden">
          {FILTER_OPTS.map(({ key, label }) => (
            <button key={key} onClick={() => setFilter(key)}
              className={`px-4 py-2 text-sm font-semibold transition-colors ${
                filter === key
                  ? "bg-[#0064d2] text-white"
                  : "text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {kpi.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)
        ) : kpi.error ? (
          <div className="col-span-4 p-4 bg-[#fa3e3e]/10 border border-[#fa3e3e]/30 rounded-xl text-[#fa3e3e] text-sm">
            KPI-Daten: {kpi.error.message}
          </div>
        ) : (
          <>
            <StatCard title="Anfragen gesamt"  value={kpi.data?.gesamtAnfragen ?? 0} icon="🔔" color="primary" />
            <StatCard title="Erledigt"         value={kpi.data?.abgeschlossen ?? 0} icon="✅" color="success"
              sub={`${kpi.data?.erledigungsquote ?? 0}% Erledigungsrate`} />
            <StatCard title="Bedarf / Offen"   value={kpi.data?.bedarf ?? 0}        icon="⏳" color="warning" />
            <StatCard title="Storniert"        value={kpi.data?.storniert ?? 0}     icon="❌" color="danger" />
          </>
        )}
      </div>

      {/* Buchungsverlauf + Status */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm xl:col-span-2">
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Buchungsverlauf</h2>
          <div className="flex gap-4 text-xs mt-1 mb-2">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#00a400]/70 inline-block" />Eingang</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#fa3e3e]/70 inline-block" />Ausgang</span>
          </div>
          {verlauf.isLoading && <div className="h-16 bg-[#f0f2f5] dark:bg-[#3e4042] rounded animate-pulse mt-3" />}
          {verlauf.error && <QueryError label="Buchungsverlauf" />}
          {verlauf.data && <SparkLine data={verlauf.data} />}
        </div>

        <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm">
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Anfragen nach Status</h2>
          {statusData.isLoading && <div className="h-20 bg-[#f0f2f5] dark:bg-[#3e4042] rounded animate-pulse mt-3" />}
          {statusData.error && <QueryError label="Status-Verteilung" />}
          {statusData.data && <HBarChart items={statusData.data.map((s) => ({ label: s.status, value: s.anzahl }))} />}
        </div>
      </div>

      {/* Top Geräte + Teile */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm">
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Top Geräte (30 Tage)</h2>
          {geraete.isLoading && <div className="h-32 bg-[#f0f2f5] dark:bg-[#3e4042] rounded animate-pulse mt-3" />}
          {geraete.error && <QueryError label="Top Geräte" />}
          {geraete.data && <HBarChart items={geraete.data.map((g) => ({ label: g.geraet, value: g.anzahl }))} />}
        </div>
        <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm">
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Top Ersatzteile (30 Tage)</h2>
          {teile.isLoading && <div className="h-32 bg-[#f0f2f5] dark:bg-[#3e4042] rounded animate-pulse mt-3" />}
          {teile.error && <QueryError label="Top Teile" />}
          {teile.data && <HBarChart items={teile.data.map((t) => ({ label: t.teil, value: t.anzahl }))} />}
        </div>
      </div>

      {/* Techniker Vergleich */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm">
        <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-3">Techniker Vergleich</h2>
        {techStats.isLoading && (
          <div className="grid grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-20 bg-[#f0f2f5] dark:bg-[#3e4042] rounded-xl animate-pulse" />
            ))}
          </div>
        )}
        {techStats.error && <QueryError label="Techniker-Vergleich" />}
        {techStats.data && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {techStats.data.map((t) => (
              <div key={t.techniker} className="text-center p-3 bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl">
                <div className="w-10 h-10 rounded-full bg-[#0064d2] text-white font-black text-sm flex items-center justify-center mx-auto mb-2">
                  {t.techniker.slice(0, 2)}
                </div>
                <div className="font-bold text-2xl text-[#1a1a1a] dark:text-[#e4e6eb]">{t.anfragen}</div>
                <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">{t.techniker}</div>
              </div>
            ))}
            {!techStats.data.length && (
              <p className="col-span-full text-center py-6 text-[#65676b] dark:text-[#b0b3b8] text-sm">Keine Daten</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";
import { useState } from "react";
import { api } from "@/trpc/react";
import { StatCard } from "@/components/ui/StatCard";
import { PageLoader } from "@/components/ui/LoadingSpinner";

type FilterRange = "heute" | "woche" | "monat" | "quartal" | "jahr";

function getDateRange(r: FilterRange): { von: Date; bis: Date } {
  const bis = new Date();
  const von = new Date();
  if (r === "heute")   von.setHours(0, 0, 0, 0);
  if (r === "woche")   von.setDate(von.getDate() - 7);
  if (r === "monat")   von.setDate(von.getDate() - 30);
  if (r === "quartal") von.setDate(von.getDate() - 90);
  if (r === "jahr")    von.setDate(von.getDate() - 365);
  return { von, bis };
}

function HBarChart({ items, max: maxVal }: { items: { label: string; value: number }[]; max?: number }) {
  const max = maxVal ?? Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="space-y-2 mt-3">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-3">
          <div className="w-28 text-xs text-[#65676b] dark:text-[#b0b3b8] truncate text-right flex-shrink-0">{item.label}</div>
          <div className="flex-1 bg-[#f0f2f5] dark:bg-[#18191a] rounded-full h-5 overflow-hidden">
            <div className="h-full bg-[#0064d2] dark:bg-[#45bdff] rounded-full flex items-center justify-end pr-2 transition-all duration-700"
              style={{ width: `${(item.value / max) * 100}%` }}>
              <span className="text-[10px] text-white font-bold">{item.value}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SparkLine({ data }: { data: { datum: string; eingang: number; ausgang: number }[] }) {
  if (!data.length) return null;
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

export default function StatistikenPage() {
  const [filter, setFilter] = useState<FilterRange>("monat");
  const { von, bis } = getDateRange(filter);

  const kpi      = api.statistik.getKpiOverview.useQuery({ von, bis });
  const verlauf  = api.statistik.getBuchungenVerlauf.useQuery({ tage: filter === "heute" ? 1 : filter === "woche" ? 7 : filter === "monat" ? 30 : filter === "quartal" ? 90 : 365 });
  const geraete  = api.statistik.getMeistgefragteGeraete.useQuery({ tage: 30 });
  const teile    = api.statistik.getMeistgefragteTeile.useQuery({ tage: 30 });
  const techStats = api.statistik.getTechnikerStats.useQuery({ von, bis });
  const statusData = api.statistik.getAnfragenNachStatus.useQuery();

  const FILTER_OPTS: { key: FilterRange; label: string }[] = [
    { key: "heute",   label: "Heute" },
    { key: "woche",   label: "Woche" },
    { key: "monat",   label: "Monat" },
    { key: "quartal", label: "Quartal" },
    { key: "jahr",    label: "Jahr" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Statistiken</h1>
        <div className="flex bg-white dark:bg-[#242526] border border-[#ced4da] dark:border-[#3e4042] rounded-xl overflow-hidden">
          {FILTER_OPTS.map(({ key, label }) => (
            <button key={key} onClick={() => setFilter(key)}
              className={`px-4 py-2 text-sm font-semibold transition-colors ${filter === key ? "bg-[#0064d2] text-white" : "text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      {kpi.isLoading ? <PageLoader /> : (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard title="Anfragen gesamt"   value={kpi.data?.gesamtAnfragen ?? 0}   icon="🔔" color="primary" />
          <StatCard title="Erledigt"          value={kpi.data?.abgeschlossen ?? 0}    icon="✅" color="success"
            sub={`${kpi.data?.erledigungsquote ?? 0}% Erledigungsrate`} />
          <StatCard title="Bedarf / Offen"    value={kpi.data?.bedarf ?? 0}           icon="⏳" color="warning" />
          <StatCard title="Storniert"         value={kpi.data?.storniert ?? 0}        icon="❌" color="danger" />
        </div>
      )}

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm xl:col-span-2">
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Buchungsverlauf</h2>
          <div className="flex gap-4 text-xs mt-1 mb-2">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#00a400]/70 inline-block" />Eingang</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#fa3e3e]/70 inline-block" />Ausgang</span>
          </div>
          {verlauf.data && <SparkLine data={verlauf.data} />}
        </div>

        <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm">
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Anfragen nach Status</h2>
          {statusData.data && <HBarChart items={statusData.data.map((s) => ({ label: s.status, value: s.anzahl }))} />}
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm">
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Top Geräte (30 Tage)</h2>
          {geraete.data && <HBarChart items={geraete.data.map((g) => ({ label: g.geraet, value: g.anzahl }))} />}
        </div>
        <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm">
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Top Ersatzteile (30 Tage)</h2>
          {teile.data && <HBarChart items={teile.data.map((t) => ({ label: t.teil, value: t.anzahl }))} />}
        </div>
      </div>

      {/* Techniker Vergleich */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm">
        <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-3">Techniker Vergleich</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {techStats.data?.map((t) => (
            <div key={t.techniker} className="text-center p-3 bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl">
              <div className="w-10 h-10 rounded-full bg-[#0064d2] text-white font-black text-sm flex items-center justify-center mx-auto mb-2">
                {t.techniker.slice(0, 2)}
              </div>
              <div className="font-bold text-2xl text-[#1a1a1a] dark:text-[#e4e6eb]">{t.anfragen}</div>
              <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">{t.techniker}</div>
            </div>
          ))}
          {!techStats.data?.length && <p className="col-span-full text-center py-6 text-[#65676b] dark:text-[#b0b3b8] text-sm">Keine Daten</p>}
        </div>
      </div>
    </div>
  );
}

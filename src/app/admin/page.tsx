"use client";
import { api } from "@/trpc/react";
import { StatCard } from "@/components/ui/StatCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PageLoader } from "@/components/ui/LoadingSpinner";

function BarChart({ items }: { items: { label: string; value: number }[] }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="space-y-2 mt-3">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-3">
          <div className="w-32 text-xs text-[#65676b] dark:text-[#b0b3b8] truncate text-right flex-shrink-0">{item.label}</div>
          <div className="flex-1 bg-[#f0f2f5] dark:bg-[#18191a] rounded-full h-5 overflow-hidden">
            <div
              className="h-full bg-[#008bd2] dark:bg-[#45bdff] rounded-full transition-all duration-500 flex items-center justify-end pr-2"
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

export default function DashboardPage() {
  const stats   = api.statistik.getLiveStats.useQuery(undefined, { refetchInterval: 30_000 });
  const geraete = api.statistik.getMeistgefragteGeraete.useQuery({ tage: 30 });
  const teile   = api.statistik.getMeistgefragteTeile.useQuery({ tage: 30 });
  const anfragen = api.anfragen.getAll.useQuery({ limit: 10, offset: 0 });
  const status  = api.statistik.getAnfragenNachStatus.useQuery();

  if (stats.isLoading) return <PageLoader text="Dashboard wird geladen..." />;
  if (stats.error) return (
    <div className="p-6 bg-[#fa3e3e]/10 border border-[#fa3e3e]/30 rounded-xl text-[#fa3e3e]">
      Dashboard-Fehler: {stats.error.message}
    </div>
  );

  const s = stats.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Lagerübersicht · Aktualisierung alle 30 s"
      />

      {/* KPI-Karten */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Aktive Anfragen"
          value={s?.aktiveAnfragen ?? 0}
          accent="cyan"
          sub="NEU + IN BEARBEITUNG"
        />
        <StatCard
          label="Offene BEDARF"
          value={s?.bedarfAnfragen ?? 0}
          accent="amber"
          sub="kein Lagerbestand"
        />
        <StatCard
          label="Artikel im Bestand"
          value={s?.artikelMitBestand ?? 0}
          accent="green"
          sub={s?.artikelOhneBestand ? `${s.artikelOhneBestand} leer` : "alle verfügbar"}
        />
        <StatCard
          label="Auslagerungen heute"
          value={s?.heutigeAuslagerungen ?? 0}
          accent="navy"
          sub="AUSGANG + DIREKT"
        />
      </div>

      {/* Second row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Letzte Anfragen */}
        <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm">
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-4">Letzte Anfragen</h2>
          <div className="space-y-2">
            {anfragen.data?.anfragen.slice(0, 8).map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 py-2 border-b border-[#ced4da] dark:border-[#3e4042] last:border-0">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#1a1a1a] dark:text-[#e4e6eb] truncate">{a.logId}</div>
                  <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">{a.techniker} · {a.teil}</div>
                </div>
                <StatusBadge status={a.status} />
              </div>
            ))}
            {!anfragen.data?.anfragen.length && (
              <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] text-center py-4">Keine Anfragen</p>
            )}
          </div>
        </div>

        {/* Anfragen nach Status */}
        <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm">
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-4">Anfragen nach Status</h2>
          {status.data && (
            <BarChart items={status.data.map((s) => ({ label: s.status, value: s.anzahl }))} />
          )}
          {s && s.artikelOhneBestand > 0 && (
            <div className="mt-4 p-3 bg-[#fa3e3e]/10 border border-[#fa3e3e]/30 rounded-lg">
              <p className="text-sm font-bold text-[#fa3e3e]">
                ⚠️ {s.artikelOhneBestand} Artikel mit Bestand = 0
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm">
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Top 5 Geräte (30 Tage)</h2>
          {geraete.data && (
            <BarChart items={geraete.data.slice(0, 5).map((g) => ({ label: g.geraet, value: g.anzahl }))} />
          )}
        </div>
        <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm">
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Top 5 Ersatzteile (30 Tage)</h2>
          {teile.data && (
            <BarChart items={teile.data.slice(0, 5).map((t) => ({ label: t.teil, value: t.anzahl }))} />
          )}
        </div>
      </div>
    </div>
  );
}

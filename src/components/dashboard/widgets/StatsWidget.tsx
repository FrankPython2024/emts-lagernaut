"use client";
import { api } from "@/trpc/react";
import { StatCard } from "@/components/ui/StatCard";
import { WidgetSkeleton } from "@/components/dashboard/WidgetSkeleton";

export function StatsWidget() {
  const { data, isLoading, error, refetch } = api.dashboard.stats.useQuery(undefined, {
    staleTime: 30_000, refetchInterval: 30_000, refetchIntervalInBackground: false,
  });

  if (isLoading) return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <WidgetSkeleton lines={3} />
        </div>
      ))}
    </div>
  );

  if (error) return (
    <div className="col-span-12 p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl flex items-center justify-between gap-3">
      <p className="text-sm text-red-600 dark:text-red-400">
        ⚠️ Konnte Statistiken nicht laden: {error.message}
      </p>
      <button
        onClick={() => void refetch()}
        className="text-sm text-red-600 dark:text-red-400 underline hover:no-underline flex-shrink-0"
      >
        Erneut versuchen
      </button>
    </div>
  );

  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
      <StatCard label="Aktive Anfragen"    value={data?.aktiveAnfragen    ?? 0} accent="cyan"  sub="NEU + IN BEARBEITUNG" />
      <StatCard label="Offene BEDARF"      value={data?.offeneBedarf      ?? 0} accent="amber" sub="kein Lagerbestand" />
      <StatCard label="Artikel im Bestand" value={data?.artikelImBestand  ?? 0} accent="green" sub="bestand > 0" />
      <StatCard label="Auslagerungen heute" value={data?.auslagerungenHeute ?? 0} accent="navy" sub="AUSGANG + DIREKT" />
    </div>
  );
}

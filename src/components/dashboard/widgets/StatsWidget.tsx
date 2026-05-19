"use client";
import { api } from "@/trpc/react";
import { StatCard } from "@/components/ui/StatCard";
import { WidgetSkeleton } from "@/components/dashboard/WidgetSkeleton";

export function StatsWidget() {
  const { data, isLoading } = api.dashboard.stats.useQuery(undefined, { staleTime: 30_000 });

  if (isLoading) return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <WidgetSkeleton lines={3} />
        </div>
      ))}
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

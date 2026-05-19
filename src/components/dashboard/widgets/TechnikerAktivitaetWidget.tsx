"use client";
import { api } from "@/trpc/react";
import { WidgetCard } from "@/components/dashboard/WidgetCard";
import { WidgetSkeleton } from "@/components/dashboard/WidgetSkeleton";

export function TechnikerAktivitaetWidget() {
  const { data, isLoading, error } = api.dashboard.technikerAktivitaet.useQuery(
    undefined, { staleTime: 60_000 }
  );

  return (
    <WidgetCard title="Techniker-Aktivität (7 Tage)" icon="👥">
      {isLoading && <WidgetSkeleton />}
      {error && <p className="text-sm text-red-500">Fehler beim Laden</p>}
      {data && !data.length && (
        <p className="text-sm text-gray-400 text-center py-8">Keine Aktivität in den letzten 7 Tagen</p>
      )}
      {data && data.length > 0 && (
        <div className="space-y-2.5">
          {data.map(t => {
            const pct = t.anfragen > 0 ? Math.round((t.abgeschlossen / t.anfragen) * 100) : 0;
            return (
              <div key={t.techniker}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-semibold text-gray-900 dark:text-white">{t.techniker}</span>
                  <span className="text-gray-500 dark:text-gray-400">{t.abgeschlossen}/{t.anfragen} · {pct}%</span>
                </div>
                <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, background: pct >= 80 ? "#04B475" : pct >= 50 ? "#008BD2" : "#F59E0B" }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </WidgetCard>
  );
}

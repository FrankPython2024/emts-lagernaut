"use client";
import { api } from "@/trpc/react";
import { WidgetCard } from "@/components/dashboard/WidgetCard";
import { WidgetSkeleton } from "@/components/dashboard/WidgetSkeleton";

export function LagerplatzHeatmapWidget() {
  const { data, isLoading, error } = api.dashboard.lagerplatzAuslastung.useQuery(
    undefined, { staleTime: 120_000 }
  );

  return (
    <WidgetCard title="Lagerplatz-Auslastung" icon="🗄️" minHeight="240px">
      {isLoading && <WidgetSkeleton lines={3} />}
      {error && <p className="text-sm text-red-500">Fehler beim Laden</p>}
      {data && !isLoading && (
        <>
          {/* Zusammenfassung */}
          <div className="flex items-center gap-4 mb-4 text-sm">
            <span className="font-semibold text-gray-900 dark:text-white">
              {data.belegt}/{data.total} belegt
            </span>
            <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-500 rounded-full transition-all"
                style={{ width: data.total > 0 ? `${(data.belegt / data.total) * 100}%` : "0%" }}
              />
            </div>
            <span className="text-gray-500 dark:text-gray-400 text-xs">
              {data.total > 0 ? Math.round((data.belegt / data.total) * 100) : 0}%
            </span>
          </div>

          {/* Heatmap — gruppiert nach Regal */}
          {data.plaetze.length > 0 ? (
            (() => {
              const byRegal = new Map<number, typeof data.plaetze>();
              for (const p of data.plaetze) {
                if (!byRegal.has(p.regal)) byRegal.set(p.regal, []);
                byRegal.get(p.regal)!.push(p);
              }
              return (
                <div className="space-y-2 overflow-x-auto">
                  {[...byRegal.entries()].sort((a, b) => a[0] - b[0]).map(([regal, plaetze]) => (
                    <div key={regal} className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-400 dark:text-gray-500 w-8 flex-shrink-0 font-mono">R{regal}</span>
                      <div className="flex gap-0.5 flex-wrap">
                        {plaetze.map(p => (
                          <div
                            key={p.code}
                            title={p.belegt ? (p.modell ?? "Belegt") : `${p.code} — frei`}
                            className={`w-4 h-4 rounded-sm cursor-default transition-colors ${
                              p.belegt
                                ? "bg-cyan-500 dark:bg-cyan-600"
                                : "bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
                            }`}
                            aria-label={`${p.code}: ${p.belegt ? "belegt" : "frei"}`}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()
          ) : (
            <p className="text-sm text-gray-400 text-center py-4">Keine Lagerplätze konfiguriert</p>
          )}

          {/* Legende */}
          <div className="flex items-center gap-4 mt-3 text-[11px] text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-cyan-500 inline-block" /> Belegt
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 inline-block" /> Frei
            </span>
          </div>
        </>
      )}
    </WidgetCard>
  );
}

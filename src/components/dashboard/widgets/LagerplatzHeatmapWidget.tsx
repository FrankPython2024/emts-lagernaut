"use client";
import { api } from "@/trpc/react";
import { WidgetCard } from "@/components/dashboard/WidgetCard";
import { WidgetSkeleton } from "@/components/dashboard/WidgetSkeleton";

export function LagerplatzHeatmapWidget() {
  const { data, isLoading, error } = api.dashboard.lagerplatzAuslastung.useQuery(
    undefined, { staleTime: 120_000, refetchInterval: 120_000, refetchIntervalInBackground: false }
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
                            title={p.belegt
                              ? `${p.code} · belegt${p.modell ? ` mit ${p.modell}` : ""}`
                              : `${p.code} · frei`}
                            aria-label={p.belegt
                              ? `${p.code}, belegt${p.modell ? ` mit ${p.modell}` : ""}`
                              : `${p.code}, frei`}
                            className={`w-5 h-5 rounded-sm cursor-default transition-colors text-[9px] font-bold leading-none flex items-center justify-center flex-shrink-0 ${
                              p.belegt
                                ? "bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300 border border-cyan-300 dark:border-cyan-700"
                                : "bg-transparent text-gray-300 dark:text-gray-600 border border-dashed border-gray-300 dark:border-gray-600"
                            }`}
                          >
                            {p.belegt ? "✓" : ""}
                          </div>
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

          {/* Legende — zweiter visueller Kanal (Symbol + Farbe) für WCAG 1.4.1 */}
          <div className="flex items-center gap-4 mt-3 text-[11px] text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-sm bg-cyan-100 dark:bg-cyan-900/40 border border-cyan-300 dark:border-cyan-700 flex items-center justify-center text-[8px] font-bold text-cyan-700 dark:text-cyan-300 flex-shrink-0">✓</span>
              Belegt
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-sm bg-transparent border border-dashed border-gray-300 dark:border-gray-600 flex-shrink-0" />
              Frei
            </span>
          </div>
        </>
      )}
    </WidgetCard>
  );
}

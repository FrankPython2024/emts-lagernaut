"use client";
import { api } from "@/trpc/react";
import { WidgetCard } from "@/components/dashboard/WidgetCard";
import { useStandortFilter } from "@/lib/standort/standortContext";
import { WidgetSkeleton } from "@/components/dashboard/WidgetSkeleton";
import { relTime } from "@/lib/utils/relativeTime";

const BADGE: Record<string, string> = {
  EINGANG:        "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  AUSGANG:        "bg-red-100   text-red-700   dark:bg-red-900/30   dark:text-red-400",
  DIREKT:         "bg-gray-100  text-gray-600  dark:bg-gray-800     dark:text-gray-400",
  NEU:            "bg-cyan-100  text-cyan-700  dark:bg-cyan-900/30  dark:text-cyan-400",
  BEDARF:         "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  ABGESCHLOSSEN:  "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  STORNIERT:      "bg-gray-100  text-gray-500  dark:bg-gray-800     dark:text-gray-400",
  IN_BEARBEITUNG: "bg-blue-100  text-blue-700  dark:bg-blue-900/30  dark:text-blue-400",
};

export function AktivitaetWidget() {
  const { activeStandortId } = useStandortFilter();
  const { data, isLoading, error } = api.dashboard.aktivitaetsProtokoll.useQuery(
    { standortId: activeStandortId }, { staleTime: 30_000, refetchInterval: 60_000 }
  );

  return (
    <WidgetCard title="Letzte Aktivitäten" icon="🕐">
      {isLoading && <WidgetSkeleton />}
      {error && <p className="text-sm text-red-500">Fehler beim Laden</p>}
      {data && !data.length && <p className="text-sm text-gray-400 text-center py-4">Noch keine Aktivitäten</p>}
      {data && data.length > 0 && (
        <div className="space-y-2.5">
          {data.map(e => (
            <div key={e.id} className="flex items-start gap-2.5">
              {/* Timeline-Punkt */}
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`text-[10px] font-bold px-1 py-0.5 rounded ${BADGE[e.badge] ?? BADGE.DIREKT}`}>
                    {e.badge}
                  </span>
                  <span className="text-[11px] text-gray-700 dark:text-gray-300 truncate flex-1">{e.label}</span>
                </div>
                <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                  {e.akteur} · {relTime(e.datum)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

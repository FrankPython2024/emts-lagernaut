"use client";
import Link from "next/link";
import { api } from "@/trpc/react";
import { useStandortFilter } from "@/lib/standort/standortContext";
import { WidgetCard } from "@/components/dashboard/WidgetCard";
import { WidgetSkeleton } from "@/components/dashboard/WidgetSkeleton";

export function MindestbestandWidget() {
  const { activeStandortId } = useStandortFilter();
  const { data, isLoading, error } = api.dashboard.mindestbestand.useQuery(
    { standortId: activeStandortId }, { staleTime: 120_000, refetchInterval: 120_000, refetchIntervalInBackground: false }
  );

  return (
    <WidgetCard title="Mindestbestand-Alarm" icon="⚠️">
      {isLoading && <WidgetSkeleton />}
      {error && <p className="text-sm text-red-500">Fehler beim Laden</p>}
      {data && !data.length && (
        <div className="text-center py-6">
          <div className="text-2xl mb-1">✅</div>
          <p className="text-sm text-gray-500 dark:text-gray-400">Alle Artikel über Mindestbestand</p>
        </div>
      )}
      {data && data.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
            {data.length} Artikel unter Schwellwert ({data[0]?.schwellwert})
          </p>
          <div className="space-y-1.5 max-h-[220px] overflow-y-auto">
            {data.map(a => (
              <Link
                key={a.id}
                href={`/admin/artikel/${a.id}`}
                className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <div className={`w-6 h-6 rounded flex items-center justify-center text-xs font-black flex-shrink-0 ${
                  a.bestand === 0
                    ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                    : "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
                }`}>
                  {a.bestand}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-gray-900 dark:text-white truncate">{a.bezeichnung}</div>
                  <div className="text-[11px] text-gray-400">{a.lagerplatz ?? "kein LP"}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </WidgetCard>
  );
}

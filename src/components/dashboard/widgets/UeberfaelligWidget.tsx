"use client";
import { useMemo } from "react";
import Link from "next/link";
import { api } from "@/trpc/react";
import { WidgetCard } from "@/components/dashboard/WidgetCard";
import { WidgetSkeleton } from "@/components/dashboard/WidgetSkeleton";
import { useStandortFilter } from "@/lib/standort/standortContext";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useNow } from "@/hooks/useNow";
import { istUeberfaellig, verstricheneZeit } from "@/lib/anfragen/ueberfaellig";

/**
 * "Überfällige Anfragen"-Widget.
 *
 * Headline = Anzahl überfälliger Anfragen (offen + > 1h). Darunter die Top 5
 * (älteste zuerst) mit LogID, Techniker, Status-Pill und verstrichener Zeit.
 * Klick auf eine Zeile springt zur Anfrage in /admin/anfragen.
 *
 * Die 1h-Marke wird clientseitig über einen tickenden Timer (useNow) bewertet,
 * d.h. das Widget aktualisiert sich live, sobald eine Anfrage die Grenze
 * überschreitet — ohne Server-Refetch (createdAt liegt bereits vor).
 */
export function UeberfaelligWidget() {
  const { activeStandortId } = useStandortFilter();
  const now = useNow(60_000);

  const { data, isLoading, error } = api.dashboard.offeneAnfragen.useQuery(
    { standortId: activeStandortId },
    { staleTime: 30_000, refetchInterval: 60_000, refetchIntervalInBackground: false },
  );

  // Server liefert bereits createdAt-aufsteigend (älteste zuerst).
  const ueberfaellig = useMemo(
    () => (data ?? []).filter(a => istUeberfaellig(a.status, a.createdAt, now)),
    [data, now],
  );
  const top5 = ueberfaellig.slice(0, 5);
  const anzahl = ueberfaellig.length;
  const alarm = anzahl > 0;

  return (
    <WidgetCard title="Überfällige Anfragen" icon={alarm ? "⏱" : "✅"}>
      {isLoading && <WidgetSkeleton />}
      {error && <p className="text-sm text-red-500">Fehler beim Laden</p>}
      {data && !isLoading && (
        <div className="space-y-3">
          {/* Headline */}
          <div
            className={`flex items-baseline gap-2 rounded-xl px-3 py-2.5 ${
              alarm
                ? "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"
                : "bg-gray-50 dark:bg-gray-800/40 text-gray-500 dark:text-gray-400"
            }`}
          >
            <span className="text-2xl font-black tabular-nums leading-none">{anzahl}</span>
            <span className="text-xs font-semibold">
              {alarm
                ? `überfällig · länger als 1h offen`
                : `alles im grünen Bereich`}
            </span>
          </div>

          {/* Top 5 */}
          {top5.length > 0 && (
            <ul className="space-y-1 -mx-1">
              {top5.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/admin/anfragen?highlight=${a.id}`}
                    className="flex items-center gap-2 px-1 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <StatusBadge status={a.status} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-gray-900 dark:text-white truncate">{a.logId}</div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{a.techniker}</div>
                    </div>
                    <span className="text-[11px] font-bold text-red-600 dark:text-red-400 flex-shrink-0 whitespace-nowrap tabular-nums">
                      {verstricheneZeit(a.createdAt, now)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {anzahl > 5 && (
            <Link href="/admin/anfragen" className="block text-center text-xs text-cyan-600 dark:text-cyan-400 hover:underline">
              + {anzahl - 5} weitere →
            </Link>
          )}
        </div>
      )}
    </WidgetCard>
  );
}

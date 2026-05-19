"use client";
import Link from "next/link";
import { api } from "@/trpc/react";
import { useStandortFilter } from "@/lib/standort/standortContext";
import { WidgetCard } from "@/components/dashboard/WidgetCard";
import { WidgetSkeleton } from "@/components/dashboard/WidgetSkeleton";
import type { BuchungsTyp } from "@prisma/client";

const TYP_STYLE: Record<BuchungsTyp, string> = {
  EINGANG: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  AUSGANG: "bg-red-100   text-red-700   dark:bg-red-900/30   dark:text-red-400",
  DIREKT:  "bg-gray-100  text-gray-600  dark:bg-gray-800     dark:text-gray-400",
};

export function LetzteBuchungenWidget() {
  const { activeStandortId } = useStandortFilter();
  const { data, isLoading, error } = api.dashboard.letzteBuchungen.useQuery(
    { standortId: activeStandortId }, { staleTime: 30_000, refetchInterval: 60_000 }
  );

  return (
    <WidgetCard
      title="Letzte Buchungen"
      icon="📋"
      action={
        <Link href="/admin/buchungen" className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline min-h-[32px] flex items-center">
          Alle →
        </Link>
      }
    >
      {isLoading && <WidgetSkeleton />}
      {error && <p className="text-sm text-red-500">Fehler beim Laden</p>}
      {data && !data.length && <p className="text-sm text-gray-400 text-center py-4">Keine Buchungen</p>}
      {data && data.length > 0 && (
        <div className="space-y-1.5 -mx-1">
          {data.map(b => (
            <div key={b.id} className="flex items-center gap-2 px-1 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${TYP_STYLE[b.typ]}`}>
                {b.typ}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-gray-900 dark:text-white truncate">{b.bezeichnung}</div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400">{b.mitarbeiter} · ×{b.menge}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

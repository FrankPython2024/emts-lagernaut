"use client";
import Link from "next/link";
import { api } from "@/trpc/react";
import { WidgetCard } from "@/components/dashboard/WidgetCard";
import { WidgetSkeleton } from "@/components/dashboard/WidgetSkeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { relTime } from "@/lib/utils/relativeTime";
import type { AnfrageStatus } from "@prisma/client";

export function LetzteAnfragenWidget() {
  const { data, isLoading, error } = api.dashboard.letzteAnfragen.useQuery(
    undefined, { staleTime: 30_000, refetchInterval: 60_000 }
  );

  return (
    <WidgetCard
      title="Letzte Anfragen"
      icon="🔔"
      action={
        <Link href="/admin/anfragen" className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline min-h-[32px] flex items-center">
          Alle →
        </Link>
      }
    >
      {isLoading && <WidgetSkeleton />}
      {error && <p className="text-sm text-red-500">Fehler beim Laden</p>}
      {data && !data.length && <p className="text-sm text-gray-400 text-center py-4">Keine Anfragen</p>}
      {data && data.length > 0 && (
        <div className="space-y-1.5 -mx-1">
          {data.map(a => (
            <div key={a.id} className="flex items-center gap-2 px-1 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              <StatusBadge status={a.status as AnfrageStatus} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-gray-900 dark:text-white truncate">{a.teil}</div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{a.techniker} · {a.geraeteName ?? "—"}</div>
              </div>
              <span className="text-[11px] text-gray-400 flex-shrink-0">{relTime(a.datum)}</span>
            </div>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

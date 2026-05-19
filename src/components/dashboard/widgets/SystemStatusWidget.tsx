"use client";
import { api } from "@/trpc/react";
import { WidgetCard } from "@/components/dashboard/WidgetCard";
import { WidgetSkeleton } from "@/components/dashboard/WidgetSkeleton";

type Status = "ok" | "fail";

function StatusDot({ status, label }: { status: Status; label: string }) {
  const ok = status === "ok";
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${ok ? "bg-green-500" : "bg-red-500"}`}
        role="img"
        aria-label={ok ? `${label}: OK` : `${label}: Fehler`}
      />
      <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">{label}</span>
      <span className={`text-xs font-semibold ${ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
        {ok ? "OK" : "FEHLER"}
      </span>
    </div>
  );
}

export function SystemStatusWidget() {
  const { data, isLoading, error, refetch, dataUpdatedAt } = api.dashboard.systemStatus.useQuery(
    undefined, { staleTime: 60_000, refetchInterval: 60_000, refetchIntervalInBackground: false }
  );

  return (
    <WidgetCard
      title="System-Status"
      icon="🟢"
      minHeight="120px"
      action={
        <button
          onClick={() => void refetch()}
          className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors min-h-[32px] px-2"
          title="Aktualisieren"
          aria-label="System-Status aktualisieren"
        >
          ↻
        </button>
      }
    >
      {isLoading && <WidgetSkeleton lines={3} />}
      {error && <p className="text-sm text-red-500">Status nicht abrufbar</p>}
      {data && (
        <div className="space-y-3">
          <StatusDot status={data.db}          label="Datenbank"    />
          <StatusDot status={data.meilisearch} label="Meilisearch"  />
          <StatusDot status={data.redis}       label="Redis / Queue" />
          <div className="pt-2 border-t border-gray-100 dark:border-gray-800 space-y-1">
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              {[data.db, data.meilisearch, data.redis].every(s => s === "ok")
                ? "✅ Alle Services betriebsbereit"
                : "⚠️ Einige Services haben Probleme"}
            </p>
            {dataUpdatedAt > 0 && (
              <p className="text-[11px] text-gray-400 dark:text-gray-500">
                Stand: {new Date(dataUpdatedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </p>
            )}
          </div>
        </div>
      )}
    </WidgetCard>
  );
}

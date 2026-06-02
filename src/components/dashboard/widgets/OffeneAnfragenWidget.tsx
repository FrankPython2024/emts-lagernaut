"use client";
import { useState, useEffect, useMemo } from "react";
import { AnfrageStatus } from "@prisma/client";
import { api } from "@/trpc/react";
import { useWidgetEditContext } from "@/lib/dashboard/widgetContext";
import { useStandortFilter } from "@/lib/standort/standortContext";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { relTime } from "@/lib/utils/relativeTime";
import { useNow } from "@/hooks/useNow";
import { istUeberfaellig, verstricheneZeit } from "@/lib/anfragen/ueberfaellig";
import { UeberfaelligBadge } from "@/components/anfragen/UeberfaelligBadge";

const ACCENT = "#008BD2";

/**
 * "Offene Anfragen"-Counter (= NEU + BEDARF) — ersetzt die früheren zwei
 * KPI-Karten "Aktive Anfragen" und "Offene BEDARF".
 *
 * Klick öffnet ein Modal mit beiden Status gemischt, sortiert nach createdAt
 * aufsteigend (älteste oben). Jede Zeile zeigt einen Status-Pill, damit
 * NEU/BEDARF auf einen Blick unterscheidbar bleiben.
 */
export function OffeneAnfragenWidget() {
  const { editMode, widgetId, onHide } = useWidgetEditContext();
  const { activeStandortId }           = useStandortFilter();
  const [open, setOpen]                = useState(false);

  const { data, isLoading, error, refetch } = api.dashboard.offeneAnfragen.useQuery(
    { standortId: activeStandortId },
    { staleTime: 30_000, refetchInterval: 30_000, refetchIntervalInBackground: false },
  );

  // Nur NEU + BEDARF zählen für den Offene-Counter (IN_BEARBEITUNG ausgenommen).
  const offene = useMemo(
    () => (data ?? []).filter(a => a.status === AnfrageStatus.NEU || a.status === AnfrageStatus.BEDARF),
    [data],
  );
  const value = isLoading ? "…" : offene.length;

  const card = (
    <div className={`h-full bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col overflow-hidden transition-shadow duration-200 ${editMode ? "edit-mode widget-card" : "hover:shadow-md"}`}>
      {editMode && (
        <div
          className="widget-drag-handle flex items-center justify-between px-3 bg-cyan-50 dark:bg-cyan-900/20 border-b border-cyan-200 dark:border-cyan-800 cursor-move select-none flex-shrink-0"
          style={{ minHeight: 40 }}
        >
          <span className="text-xs text-cyan-700 dark:text-cyan-300 font-medium flex items-center gap-1.5">
            <span className="text-sm leading-none tracking-tighter" aria-hidden>⋮⋮</span>
            Offene Anfragen
          </span>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onHide(widgetId); }}
            className="p-1.5 rounded hover:bg-cyan-100 dark:hover:bg-cyan-900/40 text-cyan-600 dark:text-cyan-400 min-w-[28px] min-h-[28px] flex items-center justify-center transition-colors"
            aria-label="Offene Anfragen ausblenden"
            type="button"
          >
            👁️‍🗨️
          </button>
        </div>
      )}

      <div style={{ height: 3, background: ACCENT, flexShrink: 0 }} />

      {error ? (
        <div className="flex-1 flex items-center justify-center gap-2 p-3">
          <span className="text-xs text-red-500">Ladefehler</span>
          <button onClick={() => void refetch()} className="text-xs text-red-400 underline" type="button">↻</button>
        </div>
      ) : (
        <div className="flex-1 p-5 flex flex-col justify-between min-h-0">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
            Offene Anfragen
          </span>
          <div className="text-[2rem] font-black text-gray-900 dark:text-white tabular-nums leading-none my-1">
            {value}
          </div>
          <span className="text-[11px] text-gray-400 dark:text-gray-500">NEU + BEDARF · Klick für Liste</span>
        </div>
      )}
    </div>
  );

  // Im Edit-Mode kein Klick-Handler (sonst öffnet Drag versehentlich das Modal)
  if (editMode) return <div className="h-full">{card}</div>;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block h-full w-full text-left"
        aria-label={`Offene Anfragen: ${value}. Liste öffnen`}
      >
        {card}
      </button>
      {open && <OffeneAnfragenModal anfragen={offene} onClose={() => setOpen(false)} />}
    </>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────────────

type OffeneAnfrage = {
  id: number; logId: string; techniker: string; teil: string;
  beschreibung: string | null; geraeteName: string | null;
  status: AnfrageStatus; createdAt: Date; istSonderAnfrage: boolean;
};

function OffeneAnfragenModal({ anfragen, onClose }: { anfragen: OffeneAnfrage[]; onClose: () => void }) {
  const now = useNow(60_000);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="offene-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-[#242526] rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#ced4da] dark:border-[#3e4042] flex-shrink-0">
          <h2 id="offene-modal-title" className="font-black text-lg text-[#1a1a1a] dark:text-[#e4e6eb]">
            📋 Offene Anfragen ({anfragen.length})
          </h2>
          <button
            onClick={onClose}
            aria-label="Schließen"
            className="text-[#65676b] hover:text-[#fa3e3e] text-xl font-bold w-11 h-11 flex items-center justify-center rounded-lg hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"
            autoFocus
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto px-3 py-3 flex-1">
          {anfragen.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">Keine offenen Anfragen 🎉</p>
          ) : (
            <ul className="space-y-1.5">
              {anfragen.map((a) => {
                const ueberfaellig = istUeberfaellig(a.status, a.createdAt, now);
                const label = a.beschreibung ?? a.teil;
                return (
                  <li key={a.id}>
                    <a
                      href={`/admin/anfragen?highlight=${a.id}`}
                      className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors"
                    >
                      <StatusBadge status={a.status} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-[#1a1a1a] dark:text-[#e4e6eb] truncate">
                          {label}
                        </div>
                        <div className="text-[11px] text-[#65676b] dark:text-[#b0b3b8] truncate">
                          {a.techniker} · {a.logId}{a.geraeteName ? ` · ${a.geraeteName}` : ""}
                        </div>
                      </div>
                      {ueberfaellig && <UeberfaelligBadge title={verstricheneZeit(a.createdAt, now)} />}
                      <span className="text-[11px] text-gray-400 flex-shrink-0 whitespace-nowrap">{relTime(a.createdAt)}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

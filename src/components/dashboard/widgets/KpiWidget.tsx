"use client";
import Link from "next/link";
import { api } from "@/trpc/react";
import { useWidgetEditContext } from "@/lib/dashboard/widgetContext";

// ── AfB-Akzentfarben ──────────────────────────────────────────────────────────
const ACCENT: Record<string, string> = {
  cyan:  "#008BD2",
  amber: "#F59E0B",
  green: "#04B475",
  navy:  "#202F61",
};

type Field = "aktiveAnfragen" | "offeneBedarf" | "artikelImBestand" | "auslagerungenHeute";

interface KpiBaseProps {
  field:  Field;
  label:  string;
  accent: keyof typeof ACCENT;
  sub:    string;
  href:   string;
}

// ── Gemeinsame Basis ──────────────────────────────────────────────────────────

function KpiBase({ field, label, accent, sub, href }: KpiBaseProps) {
  const { editMode, widgetId, onHide } = useWidgetEditContext();

  const { data, isLoading, error, refetch } = api.dashboard.stats.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const value     = isLoading ? "…" : (data?.[field] ?? 0);
  const accentClr = ACCENT[accent];

  const card = (
    <div className={`h-full bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col overflow-hidden transition-shadow duration-200 ${editMode ? "edit-mode widget-card" : "hover:shadow-md"}`}>
      {/* Drag-Handle — nur im Edit-Mode */}
      {editMode && (
        <div
          className="widget-drag-handle flex items-center justify-between px-3 bg-cyan-50 dark:bg-cyan-900/20 border-b border-cyan-200 dark:border-cyan-800 cursor-move select-none flex-shrink-0"
          style={{ minHeight: 40 }}
        >
          <span className="text-xs text-cyan-700 dark:text-cyan-300 font-medium flex items-center gap-1.5">
            <span className="text-sm leading-none tracking-tighter" aria-hidden>⋮⋮</span>
            {label}
          </span>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onHide(widgetId); }}
            className="p-1.5 rounded hover:bg-cyan-100 dark:hover:bg-cyan-900/40 text-cyan-600 dark:text-cyan-400 min-w-[28px] min-h-[28px] flex items-center justify-center transition-colors"
            aria-label={`${label} ausblenden`}
            type="button"
          >
            👁️‍🗨️
          </button>
        </div>
      )}

      {/* Akzent-Balken */}
      <div style={{ height: 3, background: accentClr, flexShrink: 0 }} />

      {/* Inhalt */}
      {error ? (
        <div className="flex-1 flex items-center justify-center gap-2 p-3">
          <span className="text-xs text-red-500">Ladefehler</span>
          <button onClick={() => void refetch()} className="text-xs text-red-400 underline" type="button">↻</button>
        </div>
      ) : (
        <div className="flex-1 p-5 flex flex-col justify-between min-h-0">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
            {label}
          </span>
          <div className="text-[2rem] font-black text-gray-900 dark:text-white tabular-nums leading-none my-1">
            {value}
          </div>
          <span className="text-[11px] text-gray-400 dark:text-gray-500">{sub}</span>
        </div>
      )}
    </div>
  );

  // Im Edit-Mode kein Link (sonst navigiert Drag versehentlich)
  if (editMode) return <div className="h-full">{card}</div>;

  return (
    <Link href={href} className="block h-full" aria-label={`${label}: ${value}`}>
      {card}
    </Link>
  );
}

// ── 4 einzelne Widget-Exports ─────────────────────────────────────────────────

export function KpiAktiveAnfragenWidget() {
  return <KpiBase field="aktiveAnfragen" label="Aktive Anfragen" accent="cyan" sub="NEU + IN BEARBEITUNG" href="/admin/anfragen" />;
}

export function KpiOffeneBedarfWidget() {
  return <KpiBase field="offeneBedarf" label="Offene BEDARF" accent="amber" sub="kein Lagerbestand" href="/admin/anfragen" />;
}

export function KpiArtikelImBestandWidget() {
  return <KpiBase field="artikelImBestand" label="Artikel im Bestand" accent="green" sub="bestand > 0" href="/admin/artikel" />;
}

export function KpiAuslagerungenHeuteWidget() {
  return <KpiBase field="auslagerungenHeute" label="Auslagerungen heute" accent="navy" sub="AUSGANG + DIREKT" href="/admin/buchungen" />;
}

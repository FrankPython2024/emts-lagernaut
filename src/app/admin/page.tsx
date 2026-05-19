"use client";
import { useState, useEffect } from "react";
import { PageHeader }         from "@/components/ui/PageHeader";
import { DashboardGrid }      from "@/components/dashboard/DashboardGrid";
import { useDashboardConfig } from "@/lib/dashboard/useDashboardConfig";
import { useSocket }          from "@/hooks/useSocket";
import { EVENTS }             from "@/modules/realtime/events";
import { api }                from "@/trpc/react";

// Socket.io → tRPC Cache-Invalidierung für Dashboard-Queries (K2-Fix)
function useDashboardSocketInvalidation() {
  const { on, off } = useSocket();
  const utils = api.useUtils();

  useEffect(() => {
    // Neue Anfrage: KPIs, letzte Anfragen, Status-Verteilung, Aktivität
    on(EVENTS.ANFRAGE_NEU, () => {
      void utils.dashboard.stats.invalidate();
      void utils.dashboard.letzteAnfragen.invalidate();
      void utils.dashboard.anfragenStatusVerteilung.invalidate();
      void utils.dashboard.aktivitaetsProtokoll.invalidate();
      void utils.dashboard.technikerAktivitaet.invalidate();
    });

    // Status-Änderung (ABGESCHLOSSEN, STORNIERT, BEDARF usw.)
    on(EVENTS.ANFRAGE_UPDATED, () => {
      void utils.dashboard.stats.invalidate();
      void utils.dashboard.anfragenStatusVerteilung.invalidate();
      void utils.dashboard.aktivitaetsProtokoll.invalidate();
      void utils.dashboard.topTeiltypen.invalidate();
    });

    // Neue Buchung: KPIs, Buchungen-Liste, Trend, Top-Teile, Aktivität
    on(EVENTS.BUCHUNG_ERSTELLT, () => {
      void utils.dashboard.stats.invalidate();
      void utils.dashboard.letzteBuchungen.invalidate();
      void utils.dashboard.auslagerungsTrend.invalidate();
      void utils.dashboard.topTeiltypen.invalidate();
      void utils.dashboard.aktivitaetsProtokoll.invalidate();
    });

    // Bestand-Update: KPIs + Mindestbestand-Alarm
    on(EVENTS.BESTAND_UPDATED, () => {
      void utils.dashboard.stats.invalidate();
      void utils.dashboard.mindestbestand.invalidate();
    });

    return () => {
      off(EVENTS.ANFRAGE_NEU);
      off(EVENTS.ANFRAGE_UPDATED);
      off(EVENTS.BUCHUNG_ERSTELLT);
      off(EVENTS.BESTAND_UPDATED);
    };
  }, [on, off, utils]);
}

// Separater Inner-Component damit useDashboardConfig (localStorage) nur Client-seitig läuft
function DashboardContent() {
  const [editMode, setEditMode] = useState(false);
  const { resetToDefault }      = useDashboardConfig();

  // K2-Fix: Socket.io-Events invalidieren tRPC-Cache
  useDashboardSocketInvalidation();

  const now = new Date().toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dashboard"
        subtitle={`Stand: ${now} · Auto-Refresh aktiv`}
        action={
          <div className="flex items-center gap-2">
            {editMode && (
              <button
                onClick={() => { resetToDefault(); }}
                className="px-3 py-2 rounded-lg text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors min-h-[44px] flex items-center gap-1.5"
                title="Layout auf Standard zurücksetzen"
                type="button"
              >
                🔄 Zurücksetzen
              </button>
            )}
            <button
              onClick={() => setEditMode(!editMode)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors min-h-[44px] flex items-center gap-1.5 ${
                editMode
                  ? "bg-cyan-500 hover:bg-cyan-600 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
              type="button"
            >
              {editMode ? "✓ Fertig" : "✏️ Anpassen"}
            </button>
          </div>
        }
      />

      {editMode && (
        <div className="flex items-center gap-2 p-3 bg-cyan-50 dark:bg-cyan-900/10 border border-cyan-200 dark:border-cyan-800 rounded-xl text-sm text-cyan-700 dark:text-cyan-300">
          <span>ℹ️</span>
          <span>Widgets verschieben: Drag am <strong>Cyan-Balken</strong> oben · Größe: rechte untere Ecke · Ausblenden: 👁️‍🗨️</span>
        </div>
      )}

      {/* Phase 2: DashboardGrid mit Drag & Drop */}
      {/* Phase 3: Layout-Persistierung im Backend (User-Preferences) */}
      <DashboardGrid editMode={editMode} />
    </div>
  );
}

export default function DashboardPage() {
  return <DashboardContent />;
}

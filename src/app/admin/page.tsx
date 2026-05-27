"use client";
import { useState, useEffect } from "react";
import { useRouter }           from "next/navigation";
import { PageHeader }         from "@/components/ui/PageHeader";
import { DashboardGrid }      from "@/components/dashboard/DashboardGrid";
import { useDashboardConfig } from "@/lib/dashboard/useDashboardConfig";
import { useSocket }          from "@/hooks/useSocket";
import { EVENTS }             from "@/modules/realtime/events";
import { api }                from "@/trpc/react";
import { usePermissions }     from "@/hooks/usePermissions";

// ── Socket.io → tRPC Cache-Invalidierung ─────────────────────────────────────

function useDashboardSocketInvalidation() {
  const { on, off } = useSocket();
  const utils = api.useUtils();

  useEffect(() => {
    on(EVENTS.ANFRAGE_NEU, () => {
      void utils.dashboard.stats.invalidate();
      void utils.dashboard.letzteAnfragen.invalidate();
      void utils.dashboard.anfragenStatusVerteilung.invalidate();
      void utils.dashboard.aktivitaetsProtokoll.invalidate();
      void utils.dashboard.technikerAktivitaet.invalidate();
    });
    on(EVENTS.ANFRAGE_UPDATED, () => {
      void utils.dashboard.stats.invalidate();
      void utils.dashboard.anfragenStatusVerteilung.invalidate();
      void utils.dashboard.aktivitaetsProtokoll.invalidate();
      void utils.dashboard.topTeiltypen.invalidate();
    });
    on(EVENTS.BUCHUNG_ERSTELLT, () => {
      void utils.dashboard.stats.invalidate();
      void utils.dashboard.letzteBuchungen.invalidate();
      void utils.dashboard.auslagerungsTrend.invalidate();
      void utils.dashboard.topTeiltypen.invalidate();
      void utils.dashboard.aktivitaetsProtokoll.invalidate();
    });
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

// ── Lade-Skeleton ─────────────────────────────────────────────────────────────

function DashboardLoadingSkeleton() {
  return (
    <div className="grid grid-cols-12 gap-4">
      {/* 4 KPI-Karten */}
      {[...Array(4)].map((_, i) => (
        <div key={i} className="col-span-6 xl:col-span-3 animate-pulse bg-gray-100 dark:bg-gray-800 rounded-xl" style={{ height: 176 }} />
      ))}
      {/* 2 Charts */}
      {[...Array(2)].map((_, i) => (
        <div key={i + 4} className="col-span-12 lg:col-span-6 animate-pulse bg-gray-100 dark:bg-gray-800 rounded-xl" style={{ height: 352 }} />
      ))}
      {/* 3 Listen */}
      {[...Array(3)].map((_, i) => (
        <div key={i + 6} className="col-span-12 md:col-span-6 xl:col-span-4 animate-pulse bg-gray-100 dark:bg-gray-800 rounded-xl" style={{ height: 280 }} />
      ))}
    </div>
  );
}

// ── Dashboard-Content ─────────────────────────────────────────────────────────

function DashboardContent() {
  const [editMode, setEditMode] = useState(false);

  // Config aus DB laden + verwalten (Phase 3)
  const config = useDashboardConfig();

  // Socket.io → tRPC-Cache-Invalidierung
  useDashboardSocketInvalidation();

  const now = new Date().toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  // Lade-State: Skeleton anzeigen bis Config vom Server kommt
  if (config.isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Dashboard" subtitle="Konfiguration wird geladen…" />
        <DashboardLoadingSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dashboard"
        subtitle={`Stand: ${now} · ${config.isSaving ? "💾 Speichert…" : config.isResetting ? "🔄 Zurücksetzen…" : "Auto-Refresh aktiv"}`}
        action={
          <div className="flex items-center gap-2">
            {editMode && (
              <button
                onClick={() => void config.resetToDefault()}
                disabled={config.isResetting}
                className="px-3 py-2 rounded-lg text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors min-h-[44px] flex items-center gap-1.5"
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
          <span>Widgets verschieben: Drag am <strong>Cyan-Balken</strong> · Größe: rechte untere Ecke · Ausblenden: 👁️‍🗨️ · Änderungen werden automatisch gespeichert</span>
        </div>
      )}

      {/* Phase 3: Layout/Visibility wird in DB gespeichert (userPreferences.saveDashboardConfig) */}
      <DashboardGrid
        editMode={editMode}
        layouts={config.layouts}
        visibility={config.visibility}
        resetKey={config.resetKey}
        isResettingRef={config.isResettingRef}
        onLayoutChange={config.updateLayout}
        onToggleWidget={config.toggleWidget}
      />
    </div>
  );
}

// Landing-Page-Priorität: bewusst entkoppelt von der Sidebar-Reihenfolge.
// Bestimmt was ein User nach Login zuerst sieht (Use-Case-orientiert),
// während die Sidebar nach Hierarchie sortiert bleibt.
//   1) ADMIN          → Dashboard
//   2) BETRACHTER     → Statistiken (Analyse-Fokus)
//   3) sonst absteigend nach Wichtigkeit der ersten Read-Permission
const LANDING_PAGES: ReadonlyArray<{ permission: string; href: string }> = [
  { permission: "DASHBOARD_VIEW",   href: "/admin"               },
  { permission: "STATISTIK_VIEW",   href: "/admin/statistiken"   },
  { permission: "ANFRAGE_VIEW_ALL", href: "/admin/anfragen"      },
  { permission: "ARTIKEL_VIEW",     href: "/admin/artikel"       },
  { permission: "MODELL_VIEW",      href: "/admin/modelle"       },
  { permission: "LAGERPLATZ_VIEW",  href: "/admin/lagerplaetze"  },
  { permission: "BUCHUNG_VIEW",     href: "/admin/buchungen"     },
];

// User ohne DASHBOARD_VIEW (z.B. BETRACHTER) auf seine erste passende
// Landing-Page umleiten. Nur in /admin/page.tsx, NICHT im Layout (Loop-Risiko).
function firstAllowedHref(has: (key: string) => boolean): string | null {
  for (const lp of LANDING_PAGES) {
    if (lp.href === "/admin") continue;
    if (has(lp.permission)) return lp.href;
  }
  return null;
}

export default function DashboardPage() {
  const router = useRouter();
  const { has, isLoading } = usePermissions();

  useEffect(() => {
    if (isLoading) return;
    if (has("DASHBOARD_VIEW")) return;
    const target = firstAllowedHref(has);
    if (target) router.replace(target);
  }, [has, isLoading, router]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Dashboard" subtitle="Lade Berechtigungen…" />
        <DashboardLoadingSkeleton />
      </div>
    );
  }

  if (!has("DASHBOARD_VIEW")) {
    return (
      <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
        Weiterleitung…
      </div>
    );
  }

  return <DashboardContent />;
}

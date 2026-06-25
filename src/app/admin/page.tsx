"use client";
import { useState, useEffect } from "react";
import { useRouter }           from "next/navigation";
import Link                    from "next/link";
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
      void utils.dashboard.offeneAnfragen.invalidate();
      void utils.dashboard.letzteAnfragen.invalidate();
      void utils.dashboard.anfragenStatusVerteilung.invalidate();
      void utils.dashboard.aktivitaetsProtokoll.invalidate();
      void utils.dashboard.technikerAktivitaet.invalidate();
    });
    on(EVENTS.ANFRAGE_UPDATED, () => {
      void utils.dashboard.stats.invalidate();
      void utils.dashboard.offeneAnfragen.invalidate();
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
    const onBestellung = () => {
      void utils.bestellempfehlung.top5.invalidate();
      void utils.bestellempfehlung.list.invalidate();
    };
    on(EVENTS.BESTELLUNG_ERFASST,      onBestellung);
    on(EVENTS.BESTELLUNG_AKTUALISIERT, onBestellung);
    on(EVENTS.BESTELLUNG_GELOESCHT,    onBestellung);
    return () => {
      off(EVENTS.ANFRAGE_NEU);
      off(EVENTS.ANFRAGE_UPDATED);
      off(EVENTS.BUCHUNG_ERSTELLT);
      off(EVENTS.BESTAND_UPDATED);
      off(EVENTS.BESTELLUNG_ERFASST);
      off(EVENTS.BESTELLUNG_AKTUALISIERT);
      off(EVENTS.BESTELLUNG_GELOESCHT);
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

// ── Wöchentliche Erinnerung: Verbrauchsmaterial zählen (Montags-Termin) ────────
// Nutzt die bestehende Query `dieseWoche` (gezählte vs. aktive Artikel ab Montag).
// Nur für Nutzer mit MATERIAL_VIEW. Ab Montag „offen", grün sobald alles gezählt.
function VerbrauchsmaterialToDo() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darf = has("MATERIAL_VIEW");
  const { data } = api.verbrauchsmaterial.dieseWoche.useQuery(undefined, {
    enabled: !permsLoading && darf,
    staleTime: 60_000,
  });

  if (!darf || !data) return null;
  const { anzahl, aktiveGesamt } = data;
  if (aktiveGesamt === 0) return null; // kein Material gepflegt → nichts zu tun

  const erledigt = anzahl >= aktiveGesamt;
  const prozent  = aktiveGesamt > 0 ? Math.round((anzahl / aktiveGesamt) * 100) : 0;

  if (erledigt) {
    return (
      <div
        role="status"
        className="flex items-center gap-3 rounded-xl border-2 px-4 py-3"
        style={{ borderColor: "#04B475", background: "rgba(4,180,117,0.10)" }}
      >
        <span className="text-2xl" aria-hidden>✅</span>
        <div className="min-w-0">
          <div className="font-black text-[#04713f]">Verbrauchsmaterial: diese Woche erledigt</div>
          <div className="text-sm text-gray-700 dark:text-gray-200">Alle {aktiveGesamt} Artikel gezählt.</div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border-2 px-4 py-3"
      style={{ borderColor: "#BA7517", background: "rgba(186,117,23,0.10)" }}
    >
      <span className="text-2xl flex-shrink-0" aria-hidden>📋</span>
      <div className="min-w-0 flex-1">
        <div className="font-black" style={{ color: "#BA7517" }}>Verbrauchsmaterial erfassen (Montags-Zählung)</div>
        <div className="text-sm text-gray-700 dark:text-gray-200">
          Diese Woche <strong>{anzahl}</strong> von <strong>{aktiveGesamt}</strong> Artikeln gezählt.
        </div>
        <div
          className="h-2 w-full max-w-md rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden mt-1.5"
          role="progressbar" aria-valuenow={anzahl} aria-valuemin={0} aria-valuemax={aktiveGesamt}
        >
          <div className="h-full rounded-full" style={{ width: `${prozent}%`, background: "#BA7517" }} />
        </div>
      </div>
      <Link
        href="/admin/verbrauchsmaterial/zaehlen"
        className="inline-flex items-center justify-center gap-2 px-5 rounded-lg text-white font-bold transition-colors min-h-[44px] flex-shrink-0"
        style={{ background: "#04B475" }}
      >
        📲 Jetzt zählen
      </Link>
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

      <VerbrauchsmaterialToDo />

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

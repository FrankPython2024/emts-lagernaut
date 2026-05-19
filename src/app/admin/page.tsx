"use client";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatsWidget }                from "@/components/dashboard/widgets/StatsWidget";
import { AnfragenStatusWidget }       from "@/components/dashboard/widgets/AnfragenStatusWidget";
import { AuslagerungsTrendWidget }    from "@/components/dashboard/widgets/AuslagerungsTrendWidget";
import { TopTeiltypenWidget }         from "@/components/dashboard/widgets/TopTeiltypenWidget";
import { TechnikerAktivitaetWidget }  from "@/components/dashboard/widgets/TechnikerAktivitaetWidget";
import { LetzteAnfragenWidget }       from "@/components/dashboard/widgets/LetzteAnfragenWidget";
import { LetzteBuchungenWidget }      from "@/components/dashboard/widgets/LetzteBuchungenWidget";
import { LagerplatzHeatmapWidget }    from "@/components/dashboard/widgets/LagerplatzHeatmapWidget";
import { MindestbestandWidget }       from "@/components/dashboard/widgets/MindestbestandWidget";
import { QuickActionsWidget }         from "@/components/dashboard/widgets/QuickActionsWidget";
import { AktivitaetWidget }           from "@/components/dashboard/widgets/AktivitaetWidget";
import { SystemStatusWidget }         from "@/components/dashboard/widgets/SystemStatusWidget";

// Phase 2: Drag & Drop wird hier integriert (react-beautiful-dnd o.ä.)
// Phase 3: Widget-Sichtbarkeit via User-Preferences persistiert

export default function DashboardPage() {
  const now = new Date().toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dashboard"
        subtitle={`Stand: ${now} · Widgets aktualisieren sich automatisch`}
      />

      {/* Statisches 12-Spalten-Grid — Phase 1 */}
      <div className="grid grid-cols-12 gap-4">

        {/* Row 1: KPI-Karten (full-width) */}
        <div className="col-span-12">
          <StatsWidget />
        </div>

        {/* Row 2: Status-Donut + Trend-Chart */}
        <div className="col-span-12 lg:col-span-6">
          <AnfragenStatusWidget />
        </div>
        <div className="col-span-12 lg:col-span-6">
          <AuslagerungsTrendWidget />
        </div>

        {/* Row 3: Top Teile + Techniker */}
        <div className="col-span-12 lg:col-span-6">
          <TopTeiltypenWidget />
        </div>
        <div className="col-span-12 lg:col-span-6">
          <TechnikerAktivitaetWidget />
        </div>

        {/* Row 4: 3 Listen-Widgets */}
        <div className="col-span-12 md:col-span-6 xl:col-span-4">
          <LetzteAnfragenWidget />
        </div>
        <div className="col-span-12 md:col-span-6 xl:col-span-4">
          <LetzteBuchungenWidget />
        </div>
        <div className="col-span-12 md:col-span-12 xl:col-span-4">
          <AktivitaetWidget />
        </div>

        {/* Row 5: Heatmap + Mindestbestand */}
        <div className="col-span-12 lg:col-span-8">
          <LagerplatzHeatmapWidget />
        </div>
        <div className="col-span-12 lg:col-span-4">
          <MindestbestandWidget />
        </div>

        {/* Row 6: Quick-Actions + System-Status */}
        <div className="col-span-12 md:col-span-8">
          <QuickActionsWidget />
        </div>
        <div className="col-span-12 md:col-span-4">
          <SystemStatusWidget />
        </div>
      </div>
    </div>
  );
}

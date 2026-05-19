"use client";
// CSS für react-grid-layout und react-resizable
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { useState, useEffect, useRef, useCallback } from "react";
// react-grid-layout v3: kein WidthProvider — stattdessen manuelle Breitenmessung
import { Responsive } from "react-grid-layout";

import { useDashboardConfig }        from "@/lib/dashboard/useDashboardConfig";
import { WIDGET_META, type LayoutsMap } from "@/lib/dashboard/defaultLayout";
import { WidgetEditContextProvider }  from "@/lib/dashboard/widgetContext";

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

// Widget-ID → Komponente
const WIDGET_COMPONENTS: Record<string, React.ComponentType> = {
  stats:           StatsWidget,
  status:          AnfragenStatusWidget,
  trend:           AuslagerungsTrendWidget,
  topTeile:        TopTeiltypenWidget,
  techniker:       TechnikerAktivitaetWidget,
  letzteAnfragen:  LetzteAnfragenWidget,
  letzteBuchungen: LetzteBuchungenWidget,
  aktivitaet:      AktivitaetWidget,
  heatmap:         LagerplatzHeatmapWidget,
  mindestbestand:  MindestbestandWidget,
  quickActions:    QuickActionsWidget,
  systemStatus:    SystemStatusWidget,
};

interface DashboardGridProps {
  editMode: boolean;
}

export function DashboardGrid({ editMode }: DashboardGridProps) {
  const { layouts, visibility, updateLayout, toggleWidget } = useDashboardConfig();
  const [mounted, setMounted]     = useState(false);
  const [gridWidth, setGridWidth] = useState(1200);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    if (!containerRef.current) return;
    const obs = new ResizeObserver(([entry]) => {
      if (entry) setGridWidth(entry.contentRect.width);
    });
    obs.observe(containerRef.current);
    setGridWidth(containerRef.current.getBoundingClientRect().width);
    return () => obs.disconnect();
  }, []);

  const hiddenWidgets  = WIDGET_META.filter(w => !visibility[w.id]);
  const visibleWidgets = WIDGET_META.filter(w =>  visibility[w.id]);

  function filterLayouts(all: LayoutsMap): LayoutsMap {
    const visible = new Set(visibleWidgets.map(w => w.id));
    return Object.fromEntries(
      Object.entries(all).map(([bp, items]) => [
        bp,
        (items ?? []).filter(l => visible.has(l.i)),
      ])
    );
  }

  if (!mounted) {
    return (
      <div ref={containerRef} className="grid grid-cols-12 gap-4">
        {visibleWidgets.map(w => (
          <div key={w.id} className="col-span-12 lg:col-span-6 animate-pulse bg-gray-100 dark:bg-gray-800 rounded-xl" style={{ height: 200 }} />
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* ── Hidden-Widgets-Panel ── */}
      {editMode && hiddenWidgets.length > 0 && (
        <div className="mb-4 p-4 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-xl">
          <div className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-2">
            Ausgeblendete Widgets ({hiddenWidgets.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {hiddenWidgets.map(w => (
              <button
                key={w.id}
                onClick={() => toggleWidget(w.id)}
                className="px-3 py-1.5 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-cyan-50 dark:hover:bg-cyan-900/20 hover:border-cyan-300 dark:hover:border-cyan-700 transition-colors min-h-[36px]"
                type="button"
              >
                ➕ {w.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Grid-Container mit gemessener Breite ── */}
      <div ref={containerRef}>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Responsive {...({
          width:       gridWidth,
          className:   "dashboard-grid",
          layouts:     filterLayouts(layouts),
          breakpoints: { lg: 1280, md: 996, sm: 768, xs: 480, xxs: 0 },
          cols:        { lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 },
          rowHeight:   80,
          margin:          [16, 16] as [number, number],
          containerPadding:[0, 0]  as [number, number],
          draggableHandle: ".widget-drag-handle",
          isDraggable:  editMode,
          isResizable:  editMode,
          useCSSTransforms: true,
          onLayoutChange: (_: unknown, allLayouts: unknown) => {
            if (editMode) updateLayout(allLayouts as LayoutsMap);
          },
        } as any)}>
          {visibleWidgets.map(w => {
            const WidgetComponent = WIDGET_COMPONENTS[w.id];
            if (!WidgetComponent) return null;
            return (
              <div key={w.id}>
                <WidgetEditContextProvider value={{ editMode, widgetId: w.id, onHide: toggleWidget }}>
                  <WidgetComponent />
                </WidgetEditContextProvider>
              </div>
            );
          })}
        </Responsive>
      </div>
    </div>
  );
}

// react-grid-layout v3 hat kein benanntes Layouts-Export — lokaler Typ
type LayoutItem = {
  i: string; x: number; y: number; w: number; h: number;
  minW?: number; minH?: number; maxW?: number; maxH?: number;
};
export type LayoutsMap = Record<string, LayoutItem[]>;

// ── Widget-Definitionen (id ↔ Label-Mapping) ─────────────────────────────────
// WICHTIG: Reihenfolge bestimmt die Render-Reihenfolge und Menu-Sortierung.
export const WIDGET_META: { id: string; label: string }[] = [
  // KPI-Widgets. "Offene Anfragen" (NEU+BEDARF) ersetzt die früheren zwei
  // Karten "Aktive Anfragen" + "Offene BEDARF".
  { id: "kpiOffeneAnfragen", label: "KPI: Offene Anfragen"    },
  { id: "kpiBestand",        label: "KPI: Artikel im Bestand" },
  { id: "kpiAuslagerungen",  label: "KPI: Auslagerungen heute" },
  // Überfällige Anfragen (offen + > 1h)
  { id: "ueberfaellig",      label: "Überfällige Anfragen"    },
  // Charts + Listen
  { id: "status",           label: "Anfragen nach Status"    },
  { id: "trend",            label: "Auslagerungs-Trend"      },
  { id: "topTeile",         label: "Top Teiltypen"           },
  { id: "techniker",        label: "Techniker-Aktivität"     },
  { id: "letzteAnfragen",   label: "Letzte Anfragen"         },
  { id: "letzteBuchungen",  label: "Letzte Buchungen"        },
  { id: "aktivitaet",       label: "Letzte Aktivitäten"      },
  { id: "heatmap",          label: "Lagerplatz-Auslastung"   },
  { id: "mindestbestand",   label: "Mindestbestand-Alarm"    },
  { id: "quickActions",     label: "Schnellzugriff"          },
  { id: "systemStatus",     label: "System-Status"           },
];

// ── Default Visibility ─────────────────────────────────────────────────────────
export const DEFAULT_VISIBILITY: Record<string, boolean> = Object.fromEntries(
  WIDGET_META.map(w => [w.id, true])
);

// ── Default Layouts ────────────────────────────────────────────────────────────
// rowHeight=80, margin=[16,16]
// h=2 ≈ 176px (KPIs), h=4 ≈ 352px (Charts), h=5 ≈ 448px (Listen)
// Die 4 KPIs ersetzen das alte 'stats'-Widget (h=3 war, jetzt h=2 je KPI)

export const DEFAULT_LAYOUT: LayoutsMap = {
  // ── Desktop (≥1280px) — 12 cols ──────────────────────────────────────────
  // y=0:  4 KPIs (h=2)
  // y=2:  Charts (h=4)
  // y=6:  Top+Techniker (h=4)
  // y=10: Listen (h=5)
  // y=15: Heatmap+Mindest (h=5)
  // y=20: Footer (h=2/3)
  lg: [
    { i: "kpiOffeneAnfragen", x: 0,  y: 0,  w: 4,  h: 2,  minW: 2,  minH: 2  },
    { i: "kpiBestand",        x: 4,  y: 0,  w: 4,  h: 2,  minW: 2,  minH: 2  },
    { i: "kpiAuslagerungen",  x: 8,  y: 0,  w: 4,  h: 2,  minW: 2,  minH: 2  },
    { i: "ueberfaellig",      x: 0,  y: 2,  w: 6,  h: 4,  minW: 3,  minH: 3  },
    { i: "status",            x: 6,  y: 2,  w: 6,  h: 4,  minW: 3,  minH: 3  },
    { i: "trend",             x: 0,  y: 6,  w: 6,  h: 4,  minW: 3,  minH: 3  },
    { i: "topTeile",          x: 6,  y: 6,  w: 6,  h: 4,  minW: 3,  minH: 3  },
    { i: "techniker",         x: 0,  y: 10, w: 6,  h: 4,  minW: 3,  minH: 3  },
    { i: "letzteAnfragen",    x: 6,  y: 10, w: 6,  h: 4,  minW: 3,  minH: 3  },
    { i: "letzteBuchungen",   x: 0,  y: 14, w: 6,  h: 5,  minW: 3,  minH: 3  },
    { i: "aktivitaet",        x: 6,  y: 14, w: 6,  h: 5,  minW: 3,  minH: 3  },
    { i: "heatmap",           x: 0,  y: 19, w: 8,  h: 5,  minW: 4,  minH: 3  },
    { i: "mindestbestand",    x: 8,  y: 19, w: 4,  h: 5,  minW: 3,  minH: 3  },
    { i: "quickActions",      x: 0,  y: 24, w: 8,  h: 2,  minW: 4,  minH: 2  },
    { i: "systemStatus",      x: 8,  y: 24, w: 4,  h: 3,  minW: 3,  minH: 2  },
  ],
  // ── Tablet (996–1279px) — 12 cols ────────────────────────────────────────
  // KPIs 2×2 Raster
  md: [
    { i: "kpiOffeneAnfragen", x: 0,  y: 0,  w: 4,  h: 2,  minW: 3,  minH: 2  },
    { i: "kpiBestand",        x: 4,  y: 0,  w: 4,  h: 2,  minW: 3,  minH: 2  },
    { i: "kpiAuslagerungen",  x: 8,  y: 0,  w: 4,  h: 2,  minW: 3,  minH: 2  },
    { i: "ueberfaellig",      x: 0,  y: 2,  w: 6,  h: 4,  minW: 3,  minH: 3  },
    { i: "status",            x: 6,  y: 2,  w: 6,  h: 4,  minW: 3,  minH: 3  },
    { i: "trend",             x: 0,  y: 6,  w: 6,  h: 4,  minW: 3,  minH: 3  },
    { i: "topTeile",          x: 6,  y: 6,  w: 6,  h: 4,  minW: 3,  minH: 3  },
    { i: "techniker",         x: 0,  y: 10, w: 6,  h: 4,  minW: 3,  minH: 3  },
    { i: "letzteAnfragen",    x: 6,  y: 10, w: 6,  h: 4,  minW: 3,  minH: 3  },
    { i: "letzteBuchungen",   x: 0,  y: 14, w: 6,  h: 5,  minW: 3,  minH: 3  },
    { i: "aktivitaet",        x: 6,  y: 14, w: 6,  h: 5,  minW: 3,  minH: 3  },
    { i: "heatmap",           x: 0,  y: 19, w: 12, h: 5,  minW: 4,  minH: 3  },
    { i: "mindestbestand",    x: 0,  y: 24, w: 6,  h: 5,  minW: 3,  minH: 3  },
    { i: "quickActions",      x: 0,  y: 29, w: 8,  h: 2,  minW: 4,  minH: 2  },
    { i: "systemStatus",      x: 8,  y: 29, w: 4,  h: 3,  minW: 3,  minH: 2  },
  ],
  // ── Mobile (≤768px) — 6 cols, stacked ────────────────────────────────────
  sm: [
    { i: "kpiOffeneAnfragen", x: 0, y: 0,  w: 3,  h: 2,  minW: 2,  minH: 2  },
    { i: "kpiBestand",        x: 3, y: 0,  w: 3,  h: 2,  minW: 2,  minH: 2  },
    { i: "kpiAuslagerungen",  x: 0, y: 2,  w: 6,  h: 2,  minW: 2,  minH: 2  },
    { i: "ueberfaellig",      x: 0, y: 4,  w: 6,  h: 4,  minW: 4,  minH: 3  },
    { i: "status",            x: 0, y: 8,  w: 6,  h: 4,  minW: 4,  minH: 3  },
    { i: "trend",             x: 0, y: 12, w: 6,  h: 4,  minW: 4,  minH: 3  },
    { i: "topTeile",          x: 0, y: 16, w: 6,  h: 4,  minW: 4,  minH: 3  },
    { i: "techniker",         x: 0, y: 20, w: 6,  h: 4,  minW: 4,  minH: 3  },
    { i: "letzteAnfragen",    x: 0, y: 24, w: 6,  h: 5,  minW: 4,  minH: 3  },
    { i: "letzteBuchungen",   x: 0, y: 29, w: 6,  h: 5,  minW: 4,  minH: 3  },
    { i: "aktivitaet",        x: 0, y: 34, w: 6,  h: 5,  minW: 4,  minH: 3  },
    { i: "heatmap",           x: 0, y: 39, w: 6,  h: 5,  minW: 4,  minH: 3  },
    { i: "mindestbestand",    x: 0, y: 44, w: 6,  h: 5,  minW: 4,  minH: 3  },
    { i: "quickActions",      x: 0, y: 49, w: 6,  h: 2,  minW: 4,  minH: 2  },
    { i: "systemStatus",      x: 0, y: 51, w: 6,  h: 3,  minW: 4,  minH: 2  },
  ],
};

// react-grid-layout v3 hat kein benanntes Layouts-Export — lokaler Typ
type LayoutItem = {
  i: string; x: number; y: number; w: number; h: number;
  minW?: number; minH?: number; maxW?: number; maxH?: number;
};
export type LayoutsMap = Record<string, LayoutItem[]>;

// ── Widget-Definitionen (id ↔ Label-Mapping) ─────────────────────────────────
export const WIDGET_META: { id: string; label: string }[] = [
  { id: "stats",           label: "KPI-Statistiken"       },
  { id: "status",          label: "Anfragen nach Status"  },
  { id: "trend",           label: "Auslagerungs-Trend"    },
  { id: "topTeile",        label: "Top Teiltypen"         },
  { id: "techniker",       label: "Techniker-Aktivität"   },
  { id: "letzteAnfragen",  label: "Letzte Anfragen"       },
  { id: "letzteBuchungen", label: "Letzte Buchungen"      },
  { id: "aktivitaet",      label: "Letzte Aktivitäten"    },
  { id: "heatmap",         label: "Lagerplatz-Auslastung" },
  { id: "mindestbestand",  label: "Mindestbestand-Alarm"  },
  { id: "quickActions",    label: "Schnellzugriff"        },
  { id: "systemStatus",    label: "System-Status"         },
];

// ── Default Visibility ─────────────────────────────────────────────────────────
export const DEFAULT_VISIBILITY: Record<string, boolean> = Object.fromEntries(
  WIDGET_META.map(w => [w.id, true])
);

// ── Default Layouts ────────────────────────────────────────────────────────────
// rowHeight=80, margin=[16,16] → h=3≈256px, h=4≈352px, h=5≈448px
// minW/minH verhindern unbenutzbar kleine Widgets

export const DEFAULT_LAYOUT: LayoutsMap = {
  // ── Desktop (≥1280px) — 12 cols ──────────────────────────────────────────
  lg: [
    { i: "stats",           x: 0,  y: 0,  w: 12, h: 3,  minW: 6,  minH: 2 },
    { i: "status",          x: 0,  y: 3,  w: 6,  h: 4,  minW: 3,  minH: 3 },
    { i: "trend",           x: 6,  y: 3,  w: 6,  h: 4,  minW: 3,  minH: 3 },
    { i: "topTeile",        x: 0,  y: 7,  w: 6,  h: 4,  minW: 3,  minH: 3 },
    { i: "techniker",       x: 6,  y: 7,  w: 6,  h: 4,  minW: 3,  minH: 3 },
    { i: "letzteAnfragen",  x: 0,  y: 11, w: 4,  h: 5,  minW: 3,  minH: 3 },
    { i: "letzteBuchungen", x: 4,  y: 11, w: 4,  h: 5,  minW: 3,  minH: 3 },
    { i: "aktivitaet",      x: 8,  y: 11, w: 4,  h: 5,  minW: 3,  minH: 3 },
    { i: "heatmap",         x: 0,  y: 16, w: 8,  h: 5,  minW: 4,  minH: 3 },
    { i: "mindestbestand",  x: 8,  y: 16, w: 4,  h: 5,  minW: 3,  minH: 3 },
    { i: "quickActions",    x: 0,  y: 21, w: 8,  h: 2,  minW: 4,  minH: 2 },
    { i: "systemStatus",    x: 8,  y: 21, w: 4,  h: 3,  minW: 3,  minH: 2 },
  ],
  // ── Tablet (996–1279px) — 12 cols ────────────────────────────────────────
  md: [
    { i: "stats",           x: 0,  y: 0,  w: 12, h: 3,  minW: 6,  minH: 2 },
    { i: "status",          x: 0,  y: 3,  w: 6,  h: 4,  minW: 3,  minH: 3 },
    { i: "trend",           x: 6,  y: 3,  w: 6,  h: 4,  minW: 3,  minH: 3 },
    { i: "topTeile",        x: 0,  y: 7,  w: 6,  h: 4,  minW: 3,  minH: 3 },
    { i: "techniker",       x: 6,  y: 7,  w: 6,  h: 4,  minW: 3,  minH: 3 },
    { i: "letzteAnfragen",  x: 0,  y: 11, w: 6,  h: 5,  minW: 3,  minH: 3 },
    { i: "letzteBuchungen", x: 6,  y: 11, w: 6,  h: 5,  minW: 3,  minH: 3 },
    { i: "aktivitaet",      x: 0,  y: 16, w: 12, h: 5,  minW: 4,  minH: 3 },
    { i: "heatmap",         x: 0,  y: 21, w: 12, h: 5,  minW: 4,  minH: 3 },
    { i: "mindestbestand",  x: 0,  y: 26, w: 6,  h: 5,  minW: 3,  minH: 3 },
    { i: "quickActions",    x: 0,  y: 31, w: 8,  h: 2,  minW: 4,  minH: 2 },
    { i: "systemStatus",    x: 8,  y: 31, w: 4,  h: 3,  minW: 3,  minH: 2 },
  ],
  // ── Mobile (≤768px) — 6 cols stacked ─────────────────────────────────────
  sm: [
    { i: "stats",           x: 0, y: 0,  w: 6, h: 4,  minW: 4, minH: 3 },
    { i: "status",          x: 0, y: 4,  w: 6, h: 4,  minW: 4, minH: 3 },
    { i: "trend",           x: 0, y: 8,  w: 6, h: 4,  minW: 4, minH: 3 },
    { i: "topTeile",        x: 0, y: 12, w: 6, h: 4,  minW: 4, minH: 3 },
    { i: "techniker",       x: 0, y: 16, w: 6, h: 4,  minW: 4, minH: 3 },
    { i: "letzteAnfragen",  x: 0, y: 20, w: 6, h: 5,  minW: 4, minH: 3 },
    { i: "letzteBuchungen", x: 0, y: 25, w: 6, h: 5,  minW: 4, minH: 3 },
    { i: "aktivitaet",      x: 0, y: 30, w: 6, h: 5,  minW: 4, minH: 3 },
    { i: "heatmap",         x: 0, y: 35, w: 6, h: 5,  minW: 4, minH: 3 },
    { i: "mindestbestand",  x: 0, y: 40, w: 6, h: 5,  minW: 4, minH: 3 },
    { i: "quickActions",    x: 0, y: 45, w: 6, h: 2,  minW: 4, minH: 2 },
    { i: "systemStatus",    x: 0, y: 47, w: 6, h: 3,  minW: 4, minH: 2 },
  ],
};

// ── Einlager-Assistent: Shared Constants ─────────────────────────────────────
// STANDARD_TEILE wird aus der zentralen Quelle abgeleitet.
// Quelle der Wahrheit: src/lib/constants/teiltypen.ts

import { STANDARD_TEILTYPEN, VERSCHIEDENES_TEILTYP } from "@/lib/constants/teiltypen";

// Abgeleitete UI-Liste: {id, label, icon, beschreibung, istVerschiedenes} — shape für Wizard
// id = name (teiltyp-String in der DB)
// Verschiedenes wird ans Ende angehängt (Sammel-Kategorie mit Freitext, kein
// echter Standard-Teiltyp — siehe lib/constants/teiltypen.ts).
export const STANDARD_TEILE = [
  ...STANDARD_TEILTYPEN.map((t) => ({
    id:               t.name,
    label:            t.label,
    icon:             t.icon,
    beschreibung:     t.beschreibung,
    istVerschiedenes: false,
  })),
  {
    id:               VERSCHIEDENES_TEILTYP,
    label:            "Verschiedenes",
    icon:             "📦",
    beschreibung:     "Sammel-Kategorie — z.B. Schraubenset, Abdeckungen (Freitext)",
    istVerschiedenes: true,
  },
];

export type StandardTeilId = (typeof STANDARD_TEILTYPEN)[number]["name"];

export { STANDARD_TEILTYPEN };

export const GRADING_OPTIONS = [
  { value: "A+", label: "Sehr gut",   icon: "🟢", beschreibung: "Wie neu — keine Kratzer" },
  { value: "A",  label: "Gut",        icon: "🟡", beschreibung: "Leichte Gebrauchsspuren" },
  { value: "B",  label: "Okay",       icon: "🟠", beschreibung: "Sichtbare Kratzer, funktioniert" },
  { value: "C",  label: "Schlecht",   icon: "🔴", beschreibung: "Nur noch als Ersatzteil" },
] as const;

export type GradingValue = typeof GRADING_OPTIONS[number]["value"];

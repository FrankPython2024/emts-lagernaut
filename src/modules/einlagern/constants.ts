// ── Einlager-Assistent: Shared Constants ─────────────────────────────────────
// STANDARD_TEILE wird aus der zentralen Quelle abgeleitet.
// Quelle der Wahrheit: src/lib/constants/teiltypen.ts

import { STANDARD_TEILTYPEN } from "@/lib/constants/teiltypen";

// Abgeleitete UI-Liste: {id, label, icon, beschreibung} — shape für Wizard
// id = name (teiltyp-String in der DB)
export const STANDARD_TEILE = STANDARD_TEILTYPEN.map((t) => ({
  id:           t.name,
  label:        t.label,
  icon:         t.icon,
  beschreibung: t.beschreibung,
}));

export type StandardTeilId = (typeof STANDARD_TEILTYPEN)[number]["name"];

export { STANDARD_TEILTYPEN };

export const GRADING_OPTIONS = [
  { value: "A+", label: "Sehr gut",   icon: "🟢", beschreibung: "Wie neu — keine Kratzer" },
  { value: "A",  label: "Gut",        icon: "🟡", beschreibung: "Leichte Gebrauchsspuren" },
  { value: "B",  label: "Okay",       icon: "🟠", beschreibung: "Sichtbare Kratzer, funktioniert" },
  { value: "C",  label: "Schlecht",   icon: "🔴", beschreibung: "Nur noch als Ersatzteil" },
] as const;

export type GradingValue = typeof GRADING_OPTIONS[number]["value"];

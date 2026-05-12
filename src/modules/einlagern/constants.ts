// ── Einlager-Assistent: Shared Constants ─────────────────────────────────────
// Diese Datei hat KEINE Server-Imports — sicher für Client und Server.
//
// WICHTIG: Die `id`-Werte in STANDARD_TEILE müssen EXAKT mit den teiltyp-
// Strings in der Kompatibilitaet-Tabelle übereinstimmen (STANDARD_TEILE_ENUM
// in kompatibilitaet/service.ts), damit Techniker die Teile finden können!

export const STANDARD_TEILE = [
  { id: "Displaymodul",  label: "Display",       icon: "🖥️",  beschreibung: "Der Bildschirm des Geräts" },
  { id: "Tastatur",      label: "Tastatur",       icon: "⌨️",  beschreibung: "Die Tipp-Tastatur" },
  { id: "Touchpad",      label: "Touchpad",       icon: "🖱️",  beschreibung: "Das Touchpad (Mausfläche)" },
  { id: "Füße vorne",    label: "Füße vorne",     icon: "🦶",  beschreibung: "Vordere Gummifüße" },
  { id: "Füße hinten",   label: "Füße hinten",    icon: "🦶",  beschreibung: "Hintere Gummifüße" },
  { id: "D Cover",       label: "D-Cover",        icon: "🔲",  beschreibung: "Unterseite / Bodenabdeckung" },
  { id: "USB Board",     label: "USB-Board",      icon: "🔌",  beschreibung: "Platine mit USB-Anschlüssen" },
  { id: "Power Button",  label: "Power-Taste",    icon: "🔘",  beschreibung: "Ein-/Ausschalter" },
  { id: "Lautsprecher",  label: "Lautsprecher",   icon: "🔊",  beschreibung: "Lautsprecher" },
  { id: "Lüfter",        label: "Lüfter",         icon: "💨",  beschreibung: "Lüfter / Ventilator" },
  { id: "Thermalmodul",  label: "Kühlsystem",     icon: "🌡️",  beschreibung: "Kühlkörper und Wärmeleitung" },
  { id: "BIOS Batterie", label: "BIOS-Batterie",  icon: "🔋",  beschreibung: "Kleine BIOS-Knopfzelle (CR2032)" },
  { id: "Akku",          label: "Akku",           icon: "⚡",  beschreibung: "Hauptakku / Batterie" },
] as const;

export type StandardTeilId = typeof STANDARD_TEILE[number]["id"];

export const GRADING_OPTIONS = [
  { value: "A+", label: "Sehr gut",   icon: "🟢", beschreibung: "Wie neu — keine Kratzer" },
  { value: "A",  label: "Gut",        icon: "🟡", beschreibung: "Leichte Gebrauchsspuren" },
  { value: "B",  label: "Okay",       icon: "🟠", beschreibung: "Sichtbare Kratzer, funktioniert" },
  { value: "C",  label: "Schlecht",   icon: "🔴", beschreibung: "Nur noch als Ersatzteil" },
] as const;

export type GradingValue = typeof GRADING_OPTIONS[number]["value"];

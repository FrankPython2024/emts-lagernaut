// ── Zentrale Teiltypen-Definition — EINE Quelle der Wahrheit ─────────────────
//
// WICHTIG: Die `name`-Werte müssen exakt mit den teiltyp-Strings in der
// Kompatibilitaet-Tabelle übereinstimmen.
//
// Abweichungen bewusst dokumentiert:
//   "D Cover"  (mit Leerzeichen) — nicht "D-Cover"
//   "USB Board" (mit Leerzeichen) — nicht "USB-Board"

export const STANDARD_TEILTYPEN = [
  { name: "Mainboard",        label: "Mainboard",       icon: "🖥️",  pflicht: true,  beschreibung: "Hauptplatine" },
  { name: "Display",          label: "Display",         icon: "📺",  pflicht: true,  beschreibung: "LCD/OLED-Panel ohne Rahmen" },
  { name: "Displaymodul",     label: "Displaymodul",    icon: "🔲",  pflicht: true,  beschreibung: "Display mit Rahmen komplett" },
  { name: "Touchpad",         label: "Touchpad",        icon: "🟦",  pflicht: true,  beschreibung: "Das Touchpad (Mausfläche)" },
  { name: "Touchpad Buttons", label: "Touchpad-Tasten", icon: "🔘",  pflicht: false, beschreibung: "Separate Touchpad-Tasten" },
  { name: "Tastatur",         label: "Tastatur",        icon: "⌨️",  pflicht: true,  beschreibung: "Die Tipp-Tastatur" },
  { name: "Lautsprecher",     label: "Lautsprecher",    icon: "🔊",  pflicht: true,  beschreibung: "Lautsprecher" },
  { name: "Füße hinten",      label: "Füße hinten",     icon: "🦶",  pflicht: true,  beschreibung: "Hintere Gummifüße" },
  { name: "Füße vorne",       label: "Füße vorne",      icon: "🦶",  pflicht: true,  beschreibung: "Vordere Gummifüße" },
  { name: "Power Button",     label: "Power-Taste",     icon: "🔴",  pflicht: true,  beschreibung: "Ein-/Ausschalter" },
  { name: "USB Board",        label: "USB-Board",       icon: "🔌",  pflicht: true,  beschreibung: "Platine mit USB-Anschlüssen" },
  { name: "LAN Board",        label: "LAN-Board",       icon: "🌐",  pflicht: false, beschreibung: "LAN-Port Platine" },
  { name: "WLAN Karte",       label: "WLAN-Karte",      icon: "📡",  pflicht: true,  beschreibung: "WLAN-Modul" },
  { name: "UMTS Karte",       label: "UMTS-Karte",      icon: "📶",  pflicht: false, beschreibung: "Mobilfunk-Modul" },
  { name: "Akku",             label: "Akku",            icon: "🔋",  pflicht: true,  beschreibung: "Hauptakku / Batterie" },
  { name: "D Cover",          label: "D-Cover",         icon: "🧱",  pflicht: true,  beschreibung: "Unterseite / Bodenabdeckung" },
  { name: "DC IN",            label: "DC-IN",           icon: "⚡",  pflicht: false, beschreibung: "Lade-Buchse / Power-Jack" },
] as const;

export type StandardTeiltyp = typeof STANDARD_TEILTYPEN[number];
export type TeilName         = StandardTeiltyp["name"];

// Pflicht-Teile (immer vorhanden, egal welches Gerät)
export const PFLICHT_TEILTYPEN = STANDARD_TEILTYPEN.filter((t) => t.pflicht);

// Für Service-Layer: reines String-Array der Namen
export const STANDARD_TEILNAMEN = STANDARD_TEILTYPEN.map((t) => t.name);

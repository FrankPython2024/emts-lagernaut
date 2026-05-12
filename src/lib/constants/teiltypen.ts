// ── Zentrale Teiltypen-Definition ────────────────────────────────────────────
//
// EINE Quelle der Wahrheit für alle Standard-Teile.
//
// WICHTIG: Die `name`-Werte müssen exakt mit den teiltyp-Strings in der
// Kompatibilitaet-Tabelle und mit STANDARD_TEILE_ENUM in
// kompatibilitaet/service.ts übereinstimmen — sonst findet der Techniker
// die Teile nicht im Portal!
//
// Abweichungen bewusst dokumentiert:
//   "D Cover"  (mit Leerzeichen) — nicht "D-Cover" — wegen STANDARD_TEILE_ENUM
//   "USB Board" (mit Leerzeichen) — nicht "USB-Board"

export const STANDARD_TEILTYPEN = [
  { name: "Mainboard",        icon: "🖥️",  pflicht: true  },
  { name: "Display",          icon: "📺",  pflicht: true  },
  { name: "Displaymodul",     icon: "🔲",  pflicht: true  },
  { name: "Touchpad",         icon: "🟦",  pflicht: true  },
  { name: "Touchpad Buttons", icon: "🔘",  pflicht: false },
  { name: "Tastatur",         icon: "⌨️",  pflicht: true  },
  { name: "Lautsprecher",     icon: "🔊",  pflicht: true  },
  { name: "Füße hinten",      icon: "🦶",  pflicht: true  },
  { name: "Füße vorne",       icon: "🦶",  pflicht: true  },
  { name: "Power Button",     icon: "🔴",  pflicht: true  },
  { name: "USB Board",        icon: "🔌",  pflicht: true  },
  { name: "LAN Board",        icon: "🌐",  pflicht: false },
  { name: "WLAN Karte",       icon: "📡",  pflicht: true  },
  { name: "UMTS Karte",       icon: "📶",  pflicht: false },
  { name: "Akku",             icon: "🔋",  pflicht: true  },
  { name: "D Cover",          icon: "🧱",  pflicht: true  },
  { name: "DC IN",            icon: "⚡",  pflicht: false },
] as const;

export type StandardTeiltyp = typeof STANDARD_TEILTYPEN[number];
export type TeilName         = StandardTeiltyp["name"];

// Pflicht-Teile (immer vorhanden, egal welches Gerät)
export const PFLICHT_TEILTYPEN = STANDARD_TEILTYPEN.filter((t) => t.pflicht);

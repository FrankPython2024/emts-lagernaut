// ── Was macht der Drucker gerade? (Druckerkarte, 30.09.2026) ─────────────────
//
// Der P2S meldet über MQTT u. a. `stg_cur` (aktueller Arbeitsschritt), `stg`
// (die für diesen Druck geplanten Schritte), `spd_lvl` (Tempo-Stufe) und
// `wifi_signal`. Hier werden die Zahlen zu Klartext.
//
// Die Schritt-Nummern sind nicht offiziell dokumentiert; die Liste folgt der
// Community-Zuordnung (ha-bambulab, „CURRENT_STAGE_IDS"). Am 30.09.2026 meldete
// der P2S für einen Füße-Druck die Schritte 29, 2, 13, 11, 4, 8, 14, 3, 54, 1, 51
// und beim eigentlichen Drucken 0. Unbekannte Nummern werden NICHT geraten,
// sondern als „Vorbereitung (Schritt N)" angezeigt.
//
// Reine Logik — Test in tests/druck.test.ts.

export const SCHRITT_TEXT: Readonly<Record<number, string>> = {
  0:  "Druckt",
  1:  "Druckbett wird vermessen",
  2:  "Druckbett heizt auf",
  3:  "Schwingungen werden kalibriert",
  4:  "Filament wird gewechselt",
  5:  "Pause",
  6:  "Pause: Filament ist leer",
  7:  "Düse heizt auf",
  8:  "Extrusion wird kalibriert",
  9:  "Druckbett wird abgetastet",
  10: "Erste Schicht wird geprüft",
  11: "Druckplatte wird erkannt",
  12: "Lidar wird kalibriert",
  13: "Druckkopf fährt in Grundstellung",
  14: "Düse wird gereinigt",
  15: "Düsentemperatur wird geprüft",
  16: "Angehalten",
  17: "Pause: Frontabdeckung abgefallen",
  18: "Lidar wird kalibriert",
  19: "Materialfluss wird kalibriert",
  20: "Pause: Fehler Düsentemperatur",
  21: "Pause: Fehler Betttemperatur",
  22: "Filament wird entladen",
  23: "Pause: Schrittverlust",
  24: "Filament wird geladen",
  25: "Motorgeräusch wird kalibriert",
  26: "Pause: AMS getrennt",
  27: "Pause: Hotend-Lüfter zu langsam",
  28: "Pause: Fehler Kammertemperatur",
  29: "Bauraum kühlt ab",
  30: "Pause (aus der Druckdatei)",
  32: "Pause: Düse mit Filament verklebt",
  33: "Pause: Fehler Filamentschneider",
  34: "Pause: Fehler in der ersten Schicht",
  35: "Pause: Düse verstopft",
  40: "Druckbett wird heiß vermessen",
  49: "Bauraum heizt auf",
  50: "Druckbett kühlt ab",
  51: "Kalibrierlinien werden gedruckt",
  52: "Material wird geprüft",
  54: "Warten auf Betttemperatur",
  57: "Oberfläche wird vermessen",
};

/** Kein Arbeitsschritt (Leerlauf). */
const LEERLAUF = new Set([-1, 255]);

export type Phase = {
  /** Klartext, z. B. „Druckbett heizt auf". */
  text: string;
  /** Vorbereitung: Schritt x von y der geplanten Schritte, sonst null. */
  schritt: { nr: number; von: number } | null;
  /** Druckt tatsächlich (Schicht läuft). */
  druckt: boolean;
  /** Angehalten / Pause-Zustand. */
  pause: boolean;
};

/** Phase aus Druckerzustand (gcode_state), aktuellem und geplanten Schritten. */
export function phaseVon(
  zustand: string | null | undefined,
  zustandText: string | null | undefined,
  stufe: number | null | undefined,
  stufen: readonly number[] | null | undefined,
): Phase {
  const z = (zustand ?? "").toUpperCase();
  const aktiv = z === "RUNNING" || z === "PREPARE" || z === "PAUSE" || z === "SLICING";
  if (!aktiv || stufe == null || LEERLAUF.has(stufe)) {
    return { text: zustandText || "unbekannt", schritt: null, druckt: z === "RUNNING", pause: z === "PAUSE" };
  }
  const text = SCHRITT_TEXT[stufe] ?? `Vorbereitung (Schritt ${stufe})`;
  const liste = (stufen ?? []).filter((n) => Number.isFinite(n));
  const i = liste.indexOf(stufe);
  return {
    text: z === "PAUSE" && stufe === 0 ? "Angehalten" : text,
    schritt: stufe !== 0 && i >= 0 ? { nr: i + 1, von: liste.length } : null,
    druckt: stufe === 0 && z === "RUNNING",
    pause: z === "PAUSE" || text.startsWith("Pause") || stufe === 16,
  };
}

export const TEMPO_TEXT: Readonly<Record<number, string>> = { 1: "Leise", 2: "Standard", 3: "Sport", 4: "Turbo" };

export function tempoText(stufe: number | null | undefined): string | null {
  return stufe != null ? (TEMPO_TEXT[stufe] ?? null) : null;
}

/** WLAN-Signal (dBm) in Worten. */
export function wlanText(dbm: number | null | undefined): string | null {
  if (dbm == null || !Number.isFinite(dbm) || dbm >= 0) return null;
  if (dbm >= -55) return "sehr gut";
  if (dbm >= -67) return "gut";
  if (dbm >= -75) return "mäßig";
  return "schwach";
}

/** Restzeit in Worten: „25 min", „1 h 05 min". */
export function restText(minuten: number | null | undefined): string | null {
  if (minuten == null || !Number.isFinite(minuten) || minuten <= 0) return null;
  const h = Math.floor(minuten / 60);
  const m = Math.round(minuten % 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

const uhrBerlin = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
const tagBerlin = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });

/** Voraussichtliches Ende: „11:52", „morgen 07:10" oder „03.10. 14:00" (deutsche Zeit). */
export function fertigUm(minuten: number | null | undefined, jetzt: Date = new Date()): string | null {
  if (minuten == null || !Number.isFinite(minuten) || minuten <= 0) return null;
  const ende = new Date(jetzt.getTime() + minuten * 60_000);
  const heute = tagBerlin.format(jetzt);
  const morgen = tagBerlin.format(new Date(jetzt.getTime() + 86_400_000));
  const tag = tagBerlin.format(ende);
  const uhr = uhrBerlin.format(ende);
  if (tag === heute) return uhr;
  if (tag === morgen) return `morgen ${uhr}`;
  return `${tag.slice(0, 6)} ${uhr}`;
}

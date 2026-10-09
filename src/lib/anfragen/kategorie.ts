// ── Anfragen nach Teil-Art unterteilen (Frank, 09.10.2026) ────────────────────
//
// Erst Akku · Gehäuseteile · Füße, am selben Tag erweitert auf ALLE Arten
// („Display, Tastaturen usw."). Die LogID-Gruppe bleibt dabei immer GANZ: Ein
// Gerät, das Akku und Füße braucht, steht unter beiden Knöpfen mit allen seinen
// Teilen, damit es für Ausgabe und Etikett zusammenbleibt (Wunsch „immer in
// Betracht auf die LogID").
//
// Sonderanfragen tragen Freitext („B-Cover Single CAM", „Blende SimSchacht") —
// deshalb Wortmuster statt fester Liste. Geprüft an allen Anfragen der letzten
// 90 Tage (09.10.2026).
//
// ⚠️ Die REIHENFOLGE der Prüfung ist Teil der Regel:
//   • Füße zuerst: „Fuß vorn oder c Cover" sind Füße.
//   • Stift vor Display: „displaystift" ist ein Stift, kein Display.
//   • Gehäuse vor Display und Kamera: „LCD Rahmen Dual Cam", „lcd-bezel",
//     „Displayscharnierabdeckung" sind Gehäuseteile.
//   • BIOS-/CMOS-Batterie ist kein Akku.
//   • Touchpad vor Tastatur und Boards: „Touchpad Tastenboard", „TP Tasten Board".
//
// Reine Logik — Test: `npm run test:gleicheteile`.

export type TeilKategorie =
  | "AKKU" | "DISPLAY" | "TASTATUR" | "TOUCHPAD" | "GEHAEUSE" | "FUESSE"
  | "BOARDS" | "KUEHLUNG" | "LAUTSPRECHER" | "SPEICHER" | "KAMERA" | "WEITERE";

/** Anzeige-Reihenfolge der Knöpfe. */
export const TEIL_KATEGORIEN: readonly { key: TeilKategorie; label: string }[] = [
  { key: "AKKU",         label: "🔋 Akku" },
  { key: "DISPLAY",      label: "🖥️ Display" },
  { key: "TASTATUR",     label: "⌨️ Tastatur" },
  { key: "TOUCHPAD",     label: "🖱️ Touchpad" },
  { key: "GEHAEUSE",     label: "🧱 Gehäuseteile" },
  { key: "FUESSE",       label: "🦶 Füße" },
  { key: "BOARDS",       label: "🔌 Boards & Anschlüsse" },
  { key: "KUEHLUNG",     label: "🌀 Kühlung" },
  { key: "LAUTSPRECHER", label: "🔊 Lautsprecher" },
  { key: "SPEICHER",     label: "💾 Speicher" },
  { key: "KAMERA",       label: "📷 Kamera" },
  { key: "WEITERE",      label: "🔧 Weitere" },
];

const re = (teile: string[]) => new RegExp(teile.join("|"));

/** Geprüft wird von oben nach unten, der erste Treffer gewinnt (siehe Kopf). */
const REGELN: readonly [TeilKategorie, RegExp][] = [
  ["FUESSE",       re(["\\bf(ü|ue|u)(ß|ss)e?\\b", "\\bfuß", "\\bfüße", "standfu"])],
  ["WEITERE",      re(["stift", "bios", "cmos"])],
  ["GEHAEUSE",     re([
    "\\b[abcd][ -]?cover\\b", "gehäuse", "gehaeuse", "blende", "abdeckung", "rahmen", "bezel",
    "door", "scharnier", "schanier", "sim[- ]*tray", "sim[- ]*dummy", "sd[- ]*dummy", "klappe", "deckel",
  ])],
  ["AKKU",         re(["akku", "batterie", "\\bbatt\\b", "battery"])],
  ["DISPLAY",      re(["display", "\\blcd\\b", "panel", "digitizer", "bildschirm"])],
  ["TOUCHPAD",     re(["touchpad", "trackpad", "track ?point", "\\btp\\b"])],
  ["TASTATUR",     re(["tastatur", "keyboard"])],
  ["KUEHLUNG",     re(["lüfter", "luefter", "\\bfan\\b", "thermal", "heatpipe", "heatsink", "kühl"])],
  ["LAUTSPRECHER", re(["lautsprecher", "speaker"])],
  ["SPEICHER",     re(["\\bssd\\b", "ssd", "nvme", "datenträger", "festplatte", "\\bhdd\\b", "\\bram\\b", "\\d+ ?gb"])],
  ["KAMERA",       re(["kamera", "webcam", "\\bcam\\b"])],
  ["BOARDS",       re(["board", "dc ?in", "power ?button", "wlan", "umts", "\\blan\\b", "\\busb\\b", "anschlu", "karte"])],
];

/** Zu welcher Art gehört ein angefragtes Teil? `teil` ist der Teiltyp bzw. bei Sonderanfragen der Freitext. */
export function teilKategorie(teil: string | null | undefined, beschreibung?: string | null): TeilKategorie {
  const t = `${teil ?? ""} ${beschreibung ?? ""}`.toLowerCase();
  for (const [k, muster] of REGELN) if (muster.test(t)) return k;
  return "WEITERE";
}

/**
 * Füße kommen aus dem 3D-Druck, nicht aus Spendergeräten (Frank, 09.10.2026):
 * Für sie gibt es weder „Spender suchen" noch Verwertungsgeräte-Hinweise.
 */
export function ohneSpenderSuche(teil: string | null | undefined, beschreibung?: string | null): boolean {
  return teilKategorie(teil, beschreibung) === "FUESSE";
}

/** Gehört eine LogID-Gruppe unter diesen Knopf? Ja, sobald EIN Teil passt. */
export function gruppeHatKategorie(
  anfragen: readonly { teil: string; beschreibung?: string | null }[],
  k: TeilKategorie,
): boolean {
  return anfragen.some((a) => teilKategorie(a.teil, a.beschreibung) === k);
}

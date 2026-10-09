// ── Anfragen nach Teil-Art unterteilen (Frank, 09.10.2026) ────────────────────
//
// Akku · Gehäuseteile · Füße · Weitere — für eine bessere Übersicht in der
// Admin-Anfragenliste. Die LogID-Gruppe bleibt dabei immer GANZ: Ein Gerät, das
// Akku und Füße braucht, steht unter beiden Reitern mit allen seinen Teilen, damit
// es für Ausgabe und Etikett zusammenbleibt (Wunsch „immer in Betracht auf die LogID").
//
// Sonderanfragen tragen Freitext („B-Cover Single CAM", „Blende SimSchacht") —
// deshalb Wortmuster statt fester Liste. Gemessen an den Anfragen der letzten
// 90 Tagen (09.10.2026). Reihenfolge ist Absicht: „Fuß vorn oder c Cover" sind
// Füße, „Bios Batterie" ist kein Akku.
//
// Reine Logik — Test: `npm run test:gleicheteile`.

export type TeilKategorie = "AKKU" | "GEHAEUSE" | "FUESSE" | "WEITERE";

export const TEIL_KATEGORIEN: readonly { key: TeilKategorie; label: string }[] = [
  { key: "AKKU",     label: "🔋 Akku" },
  { key: "GEHAEUSE", label: "🧱 Gehäuseteile" },
  { key: "FUESSE",   label: "🦶 Füße" },
  { key: "WEITERE",  label: "🔧 Weitere" },
];

const FUESSE   = /\bf(ü|ue|u)(ß|ss)(e)?\b|\bfuß|\bfüße|standfu/;
const BIOS     = /bios|cmos/;
const AKKU     = /akku|batterie|\bbatt\b|\bbattery\b/;
const GEHAEUSE = new RegExp([
  "\\b[abcd][ -]?cover\\b", "gehäuse", "gehaeuse", "blende", "abdeckung", "rahmen", "bezel",
  "door", "scharnier", "schanier", "sim[- ]?tray", "simtray", "sim[- ]?dummy", "sd[- ]?dummy",
  "sim[- ]?blende", "klappe", "deckel",
].join("|"));

/** Zu welcher Art gehört ein angefragtes Teil? `teil` ist der Teiltyp bzw. bei Sonderanfragen der Freitext. */
export function teilKategorie(teil: string | null | undefined, beschreibung?: string | null): TeilKategorie {
  const t = `${teil ?? ""} ${beschreibung ?? ""}`.toLowerCase();
  if (FUESSE.test(t)) return "FUESSE";
  if (AKKU.test(t) && !BIOS.test(t)) return "AKKU";
  if (GEHAEUSE.test(t)) return "GEHAEUSE";
  return "WEITERE";
}

/** Gehört eine LogID-Gruppe unter diesen Reiter? Ja, sobald EIN Teil passt. */
export function gruppeHatKategorie(
  anfragen: readonly { teil: string; beschreibung?: string | null }[],
  k: TeilKategorie,
): boolean {
  return anfragen.some((a) => teilKategorie(a.teil, a.beschreibung) === k);
}

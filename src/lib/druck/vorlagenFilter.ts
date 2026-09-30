// ── Vorlagen-Liste: Hersteller, Suche, Gruppen (3D-Druck, 30.09.2026) ────────
//
// Wunsch Frank: „Sortierung nach Hersteller, eine Suchfunktion und die
// Vorschaubilder". Der Hersteller steht in keiner Spalte — er kommt aus den
// zugeordneten Geräten bzw. dem Vorlagennamen: erst ein ausdrücklicher Name
// („HP", „Dell"), sonst die Serie („EliteBook" → HP, „ThinkPad" → Lenovo).
// Reine Logik — Test in tests/druck.test.ts.

export const HERSTELLER_REIHENFOLGE = ["Dell", "HP", "Lenovo", "Fujitsu", "Microsoft"] as const;
export const SONSTIGE = "Sonstige";

/** Wort → Hersteller. Serien nur, wo sie eindeutig sind. */
const ERKENNUNG: [RegExp, string][] = [
  [/\bdell\b/i, "Dell"],
  [/\b(hp|hewlett)\b/i, "HP"],
  [/\blenovo\b/i, "Lenovo"],
  [/\bfujitsu\b/i, "Fujitsu"],
  [/\b(microsoft|surface)\b/i, "Microsoft"],
  [/\b(latitude|precision|inspiron|vostro|xps)\b/i, "Dell"],
  [/\b(elitebook|probook|zbook|elite\s?x2|dragonfly)\b/i, "HP"],
  [/\b(thinkpad|ideapad|thinkbook|yoga)\b/i, "Lenovo"],
  [/\b(lifebook|celsius)\b/i, "Fujitsu"],
];

/** Hersteller aus Gerätenamen und Vorlagennamen; unbekannt → „Sonstige". */
export function herstellerVon(texte: readonly (string | null | undefined)[]): string {
  const alle = texte.filter(Boolean).join(" \u0000 ");
  for (const [muster, name] of ERKENNUNG) if (muster.test(alle)) return name;
  return SONSTIGE;
}

type Durchsuchbar = { name: string; teiltypen: readonly string[]; modelle: readonly { anzeige: string }[] };

const norm = (s: string) => s.toLowerCase().replace(/ß/g, "ss").replace(/[^a-z0-9äöü]+/g, " ").trim();

/**
 * Passt die Vorlage zur Suche? Jedes Suchwort muss irgendwo vorkommen (Name,
 * Geräte, Teiltypen) — „830 hinten" findet „EliteBook x360 830 G6 Füße hinten".
 */
export function passtSuche(v: Durchsuchbar, suche: string): boolean {
  const woerter = norm(suche).split(" ").filter(Boolean);
  if (woerter.length === 0) return true;
  const text = ` ${norm([v.name, ...v.teiltypen, ...v.modelle.map((m) => m.anzeige)].join(" "))} `;
  return woerter.every((w) => text.includes(w));
}

/** Nach Hersteller gruppieren — feste Reihenfolge, „Sonstige" zuletzt, innen nach Name. */
export function gruppiereNachHersteller<T extends Durchsuchbar>(liste: readonly T[]): { hersteller: string; vorlagen: T[] }[] {
  const gruppen = new Map<string, T[]>();
  for (const v of liste) {
    const h = herstellerVon([...v.modelle.map((m) => m.anzeige), v.name]);
    gruppen.set(h, [...(gruppen.get(h) ?? []), v]);
  }
  const rang = (h: string) => {
    const i = (HERSTELLER_REIHENFOLGE as readonly string[]).indexOf(h);
    return i >= 0 ? i : h === SONSTIGE ? 999 : 500;
  };
  return [...gruppen.entries()]
    .sort((a, b) => rang(a[0]) - rang(b[0]) || a[0].localeCompare(b[0], "de"))
    .map(([hersteller, vorlagen]) => ({ hersteller, vorlagen: [...vorlagen].sort((x, y) => x.name.localeCompare(y.name, "de", { numeric: true })) }));
}

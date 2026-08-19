// ── Gefahrgut-Hinweis für Lithium-Akkus ─────────────────────────────────────
//
// Anlass: Akkus, die einzeln verschickt werden (also nicht in einem Gerät
// verbaut), sind Gefahrgut. Der Sendung muss der Aufkleber UN 3480 beiliegen.
// Beim Zusammenstellen einer Abgabe fällt das erfahrungsgemäß niemandem ein,
// deshalb erinnert Lagernaut von sich aus daran.
//
// ⚠️ Die Erkennung steht AUSSCHLIESSLICH hier. Sie wird an drei Stellen
// gebraucht (Auswahl, Bestätigung, Auslagerbeleg) — an drei Stellen gebaut
// würde eine davon irgendwann abweichen, und ausgerechnet der Beleg, der beim
// Paket liegt, wäre der falsche.
//
// Abgrenzung, bewusst NICHT automatisiert: UN 3480 gilt für einzeln versandte
// Lithium-Ionen-Akkus. Für Akkus IN einem Gerät gilt UN 3481, für Knopfzellen
// (Lithium-Metall, z. B. CMOS) UN 3090. Lagernaut gibt hier nur den Hinweis für
// den Regelfall der Abgabe: lose Akkus. Wer die anderen Fälle abdecken will,
// muss das bewusst ergänzen — raten wäre bei Gefahrgut die schlechtere Wahl.

/** Kennzeichnung, die auf die Sendung gehört. */
export const UN_NUMMER = "UN 3480";

export const GEFAHRGUT_HINWEIS =
  `Enthält Lithium-Ionen-Akkus. Aufkleber ${UN_NUMMER} beilegen und außen anbringen.`;

// Wortstämme, die einen Akku kennzeichnen. Bewusst kurz gehalten und in
// Kleinschreibung verglichen; „akku" trifft auch Akkupack und Zusatzakku.
const AKKU_WORTE = ["akku", "batterie", "battery"] as const;

/**
 * Ist dieser Artikel ein Lithium-Akku?
 *
 * Geprüft werden Kategorie UND Bezeichnung: Bei Laptop-Ersatzteilen ist die
 * Kategorie der Teiltyp (also „Akku"), bei frei erfassten Artikeln steht es
 * dagegen oft nur im Namen.
 */
export function istLithiumAkku(artikel: { bezeichnung?: string | null; kategorie?: string | null }): boolean {
  const text = `${artikel.kategorie ?? ""} ${artikel.bezeichnung ?? ""}`.toLowerCase();
  return AKKU_WORTE.some((w) => text.includes(w));
}

/** Enthält die Zusammenstellung mindestens einen Akku? */
export function enthaeltLithiumAkku(
  positionen: Array<{ bezeichnung?: string | null; kategorie?: string | null }>,
): boolean {
  return positionen.some(istLithiumAkku);
}

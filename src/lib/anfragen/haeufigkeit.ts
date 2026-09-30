// ── Teile je Gerätetyp nach Häufigkeit (Techniker-Portal, 30.09.2026) ─────────
//
// Wunsch Frank: „nach Scan der LogID pro Gerätetyp das Ersatzteil zuerst, das für
// diesen Typ am häufigsten angefragt wird — z. B. beim Dell 7490 der Akku, dann die
// anderen absteigend." Gemessen am selben Tag (1.574 Anfragen, 181 Modelle):
// 7490 Akku 20 von 26, E14 Gen 4 Füße vorne 51 von 66, X1 Yoga Gen 6 Akku 23 von 38.
//
// Regel: Anzahl absteigend; gleich viele (auch 0) behalten die gewohnte Reihenfolge
// aus `Teiltyp.sortierung` — ein Modell ohne Anfragen sieht aus wie immer.
// „Oft angefragt" markiert nur die vorderen Teile mit echtem Gewicht, damit sich die
// Techniker erklären können, warum die Kacheln woanders stehen.
//
// Reine Logik — Test: `npm run test:gleicheteile`.

/** Wie oft muss ein Teil mindestens angefragt sein, um als „oft angefragt" zu gelten. */
export const OFT_MIN_ANFRAGEN = 3;
/** Höchstens so viele Kacheln tragen die Markierung. */
export const OFT_MAX_TEILE = 3;

/** Teilname vergleichbar machen: „D-Cover" = „D Cover" = „d cover". */
export function teilNorm(teil: string): string {
  return teil.trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
}

export type Haeufigkeit = { teil: string; anzahl: number }[];

/**
 * Teile nach Häufigkeit sortieren (stabil). Liefert die Teile in neuer Reihenfolge,
 * je mit `anfragen` (Anzahl) und `oft` (Markierung).
 */
export function sortiereNachHaeufigkeit<T extends { teiltyp: string }>(
  teile: readonly T[],
  haeufigkeit: Haeufigkeit | null | undefined,
): (T & { anfragen: number; oft: boolean })[] {
  const zahl = new Map<string, number>();
  for (const h of haeufigkeit ?? []) zahl.set(teilNorm(h.teil), (zahl.get(teilNorm(h.teil)) ?? 0) + h.anzahl);
  const mit = teile.map((t, i) => ({ t, i, n: zahl.get(teilNorm(t.teiltyp)) ?? 0 }));
  mit.sort((a, b) => b.n - a.n || a.i - b.i);
  return mit.map(({ t, n }, pos) => ({
    ...t,
    anfragen: n,
    oft: pos < OFT_MAX_TEILE && n >= OFT_MIN_ANFRAGEN,
  }));
}

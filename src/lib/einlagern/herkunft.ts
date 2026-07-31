// ── Herkunft eingelagerter Teile ─────────────────────────────────────────────
// Genau zwei Fälle, bewusst nicht mehr:
//   SPENDER — aus einem Altgerät ausgebaut (das ist die Bauteil-Ernte)
//   DRUCK   — selbst hergestellt am 3D-Drucker
//
// Warum die Trennung nötig ist: 3D-Druck läuft in großen Chargen (280 Füße in
// EINER Buchung sind real vorgekommen). Ohne Unterscheidung landen diese Stück-
// zahlen in der Ernte-Auswertung und lassen es so aussehen, als kämen aus einem
// Altgerät hunderte Teile — die Kennzahl „Teile je Gerät" wird dadurch wertlos.
//
// Altdaten haben NULL: dort ist beides nicht mehr trennbar (siehe Ernte-Panel).

export const HERKUNFT_ARTEN = ["SPENDER", "DRUCK"] as const;
export type HerkunftArt = (typeof HERKUNFT_ARTEN)[number];

export const HERKUNFT_LABEL: Record<HerkunftArt, string> = {
  SPENDER: "Aus Spender-Gerät",
  DRUCK:   "3D-gedruckt",
};

export const HERKUNFT_ICON: Record<HerkunftArt, string> = {
  SPENDER: "🔧",
  DRUCK:   "🖨️",
};

/** Kurze Erklärung in einfacher Sprache — wird im Assistenten angezeigt. */
export const HERKUNFT_HILFE: Record<HerkunftArt, string> = {
  SPENDER: "Das Teil wurde aus einem alten Gerät ausgebaut.",
  DRUCK:   "Das Teil wurde selbst gedruckt. Es zählt nicht als Ernte.",
};

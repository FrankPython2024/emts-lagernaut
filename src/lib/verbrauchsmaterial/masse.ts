/**
 * Maße eines Verbrauchsmaterial-Artikels als lesbare Zeile.
 *
 * Gemeinsame Quelle für Oberfläche und Druck — die Schreibweise soll auf dem
 * Bildschirm und auf dem A5-Schild dieselbe sein.
 *
 * Gespeichert wird in **Millimetern als ganze Zahl** (siehe schema.prisma):
 * 30 cm sind 300, ein Etikett mit 1,5 cm ist 15. Damit gibt es keine
 * Rundungsfragen und beide Größenordnungen passen in dieselbe Spalte.
 */

export type Masse = {
  laengeMm: number | null;
  breiteMm: number | null;
  hoeheMm:  number | null;
};

/**
 * „300 × 200 × 150 mm", oder null wenn gar nichts gepflegt ist.
 *
 * ⚠️ Fehlende Kanten erscheinen als „?" statt wegzufallen. Sonst läse sich
 * „300 × 150 mm" wie Länge und Breite, obwohl Länge und Höhe gemeint sind —
 * und wer danach einen Karton bestellt, bestellt den falschen.
 */
export function masseText(m: Masse): string | null {
  const werte = [m.laengeMm, m.breiteMm, m.hoeheMm];
  if (werte.every((v) => v == null)) return null;
  return `${werte.map((v) => (v == null ? "?" : v.toLocaleString("de-DE"))).join(" × ")} mm`;
}

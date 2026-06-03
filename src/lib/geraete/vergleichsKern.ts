// ── Vergleichs-Kern ───────────────────────────────────────────────────────────
//
// Erzeugt einen aggressiv normalisierten "Kern" eines Modell-/Bezeichnungs-Strings,
// der NUR für den Abgleich (Input ↔ Katalog) gedacht ist und NIE gespeichert wird.
// Deshalb darf hier großzügig abgeräumt werden: Specs, Bildschirmgrößen, Maschinen-
// und Varianten-Codes sowie generische Wörter fliegen raus, damit nur die wirklich
// modell-unterscheidenden Bestandteile übrig bleiben.
//
// Single Source of Truth: wird hier für die Import-Sandbox-Vorschau genutzt und
// kann später unverändert vom echten Abgleich verwendet werden.

/**
 * Normalisierter Vergleichs-Kern (lowercase, ohne Specs/Codes/Füllwörter).
 * Reine Berechnung, ohne Seiteneffekte.
 */
export function vergleichsKern(text: string): string {
  if (!text) return "";

  let s = ` ${text.toLowerCase()} `;

  // ── CPUs ────────────────────────────────────────────────────────────────
  // Intel-Core-Kürzel: i7-8650U, i5 8250u, i3-1115g4 …
  s = s.replace(/\bi[3-9][-\s]?\d{3,5}[a-z]*\b/g, " ");
  // Marken-/Serien-Wörter
  s = s.replace(/\b(ryzen|celeron|pentium|core|xeon|athlon)\b/g, " ");

  // ── Speicher-Technik ──────────────────────────────────────────────────────
  s = s.replace(/\b(ssd|hdd|nvme|emmc)\b/g, " ");

  // ── Kapazität + RAM ───────────────────────────────────────────────────────
  s = s.replace(/\b\d+\s?(gb|tb)\b/g, " ");
  s = s.replace(/\b(ram|arbeitsspeicher)\b/g, " ");

  // ── Bildschirmgröße ───────────────────────────────────────────────────────
  // 14", 15.6 zoll, 13.3inch
  s = s.replace(/\b\d+(?:\.\d+)?\s?(?:inch|zoll|")/g, " ");

  // ── 2-in-1 / 2in1 ─────────────────────────────────────────────────────────
  s = s.replace(/\b2[\s-]?in[\s-]?1\b/g, " ");

  // ── Maschinen-/Varianten-Codes ────────────────────────────────────────────
  // Lenovo-Stil "20XX-XXXXXX" MIT und OHNE Bindestrich (z.B. 20W1S06V00, 20XX-XXXXXX)
  s = s.replace(/\b20[a-z0-9]{2}-?[a-z0-9]{4,}\b/g, " ");
  // Lenovo kurzer Maschinentyp (z.B. 81W0, 82K1) — 8x + Buchstabe + Alnum
  s = s.replace(/\b8[0-9][a-z][a-z0-9]\b/g, " ");
  // HP-Stil "15-eh0xxx" (z.B. 15-eh0034ng)
  s = s.replace(/\b\d{2}-[a-z]{1,2}\d[a-z0-9]*\b/g, " ");

  // ── Generische Wörter ─────────────────────────────────────────────────────
  s = s.replace(/\b(business-nb|laptop|notebook|pc|system)\b/g, " ");

  // ── Aufräumen: nur Alphanumerisches behalten, Leerzeichen normalisieren ────
  s = s.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

  return s;
}

/** Eindeutige Tokens des Vergleichs-Kerns. */
export function kernTokens(text: string): string[] {
  const kern = vergleichsKern(text);
  if (!kern) return [];
  return [...new Set(kern.split(" ").filter(Boolean))];
}

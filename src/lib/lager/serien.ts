/**
 * Extrahiert Serie + Familie aus einer Modell-Bezeichnung.
 *
 * "ThinkPad T480"    → { familie: "ThinkPad T", serie: "ThinkPad T480" }
 * "ProBook 650 G5"   → { familie: "ProBook",    serie: "ProBook 650"  }
 * "EliteBook 840 G7" → { familie: "EliteBook",  serie: "EliteBook 840" }
 */
export function extractSerie(modell: string): { familie: string | null; serie: string | null } {
  if (!modell) return { familie: null, serie: null };

  // Familie = alles vor der ersten Zahl (z.B. "ProBook", "ThinkPad T")
  const familieMatch = modell.match(/^([A-Za-zäöüÄÖÜß]+(?:\s[A-Z])?)\s*\d/);
  const familie = familieMatch ? familieMatch[1].trim() : null;

  // Serie = Familie + erste Zahl (z.B. "ProBook 650", "ThinkPad T480")
  const serieMatch = modell.match(/^([A-Za-zäöüÄÖÜß]+(?:\s[A-Z])?\s*\d+)/);
  const serie = serieMatch ? serieMatch[1].trim().replace(/\s+/g, " ") : null;

  return { familie, serie };
}

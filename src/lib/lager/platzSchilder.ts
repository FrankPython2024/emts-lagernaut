// ── Platz-Schilder für ORGATEX ET300 (02.10.2026) ─────────────────────────────
//
// Wunsch Frank: „für die ET300-Vorlage von Orgatex ein Menüpunkt, über den wir
// Stellplätze eintragen können, samt QR-Code je Lagerplatz" — Plätze selbst als
// Liste eingeben. Der QR-Code enthält GENAU den eingegebenen Platznamen.
//
// ET300 laut Orgatex: DIN A4, Karton 160 g, mikroperforiert, 14 Einsteckschilder
// je 38 × 100 mm → 2 Spalten × 7 Reihen (200 × 266 mm), links/rechts je 5 mm.
// ⚠️ Oben 9 mm, NICHT mittig: Zuerst aus den Maßen abgeleitet (15,5 mm oben/unten),
// beim ersten Probedruck passte es erst mit −6,5 mm (Frank, 02.10.2026) — für eine
// Druckerabweichung zu viel, also liegt das Raster auf dem Bogen höher. Feinjustierung
// je PC bleibt für die Eigenheiten einzelner Drucker.
//
// Reine Logik — Test: `npm run test:schild`.

export const ET300 = {
  spalten: 2, reihen: 7, breiteMm: 100, hoeheMm: 38, randLinksMm: 5, randObenMm: 9,
} as const;
export const ET300_JE_BOGEN = ET300.spalten * ET300.reihen;

/** Höchstzahl Plätze aus EINEM Bereich („HL-07-01 bis HL-07-30") — gegen Tippfehler wie „bis 9999". */
export const MAX_BEREICH = 500;
export const MAX_CODE = 60;
export const MAX_BESCHREIBUNG = 60;

export type PlatzEingabe = { code: string; beschreibung: string | null };

/**
 * Bereich aufklappen: „HL-07-01 bis HL-07-30" → HL-07-01 … HL-07-30. Gleicher Vorspann,
 * Zahl am Ende; führende Nullen bleiben (01 … 30). null = kein gültiger Bereich.
 */
export function klappeBereichAuf(von: string, bis: string): string[] | null {
  const a = /^(.*?)(\d+)$/.exec(von.trim());
  const b = /^(.*?)(\d+)$/.exec(bis.trim());
  if (!a || !b || a[1] !== b[1]) return null;
  const start = Number(a[2]), ende = Number(b[2]);
  if (ende < start || ende - start + 1 > MAX_BEREICH) return null;
  const breite = Math.max(a[2]!.length, b[2]!.length);
  const fuehrendeNull = a[2]!.startsWith("0") || b[2]!.startsWith("0");
  const raus: string[] = [];
  for (let n = start; n <= ende; n++) raus.push(a[1] + (fuehrendeNull ? String(n).padStart(breite, "0") : String(n)));
  return raus;
}

/**
 * Eingabe-Liste lesen: je Zeile ein Platz, optional Beschreibung nach „;" oder Tab
 * (so kommt es aus Excel), Bereiche mit „bis". Doppelte in der Eingabe fallen weg.
 */
export function lesePlatzListe(text: string): { plaetze: PlatzEingabe[]; fehler: string[] } {
  const plaetze: PlatzEingabe[] = [];
  const fehler: string[] = [];
  const gesehen = new Set<string>();
  const nimm = (code: string, beschreibung: string | null) => {
    const c = code.trim().replace(/\s+/g, " ");
    if (!c) return;
    if (c.length > MAX_CODE) { fehler.push(`„${c.slice(0, 20)}…" ist zu lang (max. ${MAX_CODE} Zeichen)`); return; }
    const k = c.toUpperCase();
    if (gesehen.has(k)) return;
    gesehen.add(k);
    plaetze.push({ code: c, beschreibung: beschreibung?.trim().slice(0, MAX_BESCHREIBUNG) || null });
  };
  for (const zeile of text.replace(/\r/g, "").split("\n")) {
    if (!zeile.trim()) continue;
    const [teil1, ...rest] = zeile.split(/[;\t]/);
    const beschreibung = rest.join(" ").trim() || null;
    const bereich = /^(.+?)\s+bis\s+(.+)$/i.exec(teil1!.trim());
    if (bereich) {
      const liste = klappeBereichAuf(bereich[1]!, bereich[2]!);
      if (!liste) { fehler.push(`Bereich „${teil1!.trim()}" nicht lesbar — beide Enden brauchen denselben Anfang und eine Zahl am Ende (höchstens ${MAX_BEREICH} Plätze)`); continue; }
      for (const c of liste) nimm(c, beschreibung);
    } else {
      nimm(teil1!, beschreibung);
    }
  }
  return { plaetze, fehler };
}

/** Wie viele Bögen braucht ein Druck, wenn auf dem ersten Bogen ab Feld `start` (1–14) begonnen wird? */
export function boegenFuer(anzahl: number, start = 1): number {
  if (anzahl <= 0) return 0;
  const s = Math.min(Math.max(1, Math.floor(start)), ET300_JE_BOGEN);
  return Math.ceil((anzahl + s - 1) / ET300_JE_BOGEN);
}

/** Lage eines Feldes (0-basiert über alle Bögen, inkl. freigelassener) auf dem Bogen. */
export function feldLage(index: number): { bogen: number; spalte: number; reihe: number; linksMm: number; obenMm: number } {
  const bogen = Math.floor(index / ET300_JE_BOGEN);
  const feld = index % ET300_JE_BOGEN;
  const reihe = Math.floor(feld / ET300.spalten);
  const spalte = feld % ET300.spalten;
  return {
    bogen, spalte, reihe,
    linksMm: ET300.randLinksMm + spalte * ET300.breiteMm,
    obenMm: ET300.randObenMm + reihe * ET300.hoeheMm,
  };
}

/**
 * Schriftgröße des Platznamens (pt): so groß, dass er neben dem QR-Code in EINE Zeile
 * passt (Textbreite 57 mm, fette Arial ≈ 0,62 em je Zeichen, 1 pt = 0,3528 mm),
 * höchstens 36 pt, mindestens 9 pt (darunter bricht er um).
 */
export function codeSchriftPt(code: string): number {
  const n = Math.max(1, code.length);
  const pt = 57 / (n * 0.62 * 0.3528);
  return Math.max(9, Math.min(36, Math.floor(pt * 2) / 2));
}

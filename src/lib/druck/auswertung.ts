// ── 3D-Druck-Auswertung: was bringt der Druck ein? (30.09.2026) ───────────────
//
// Wunsch Frank: „Wert der produzierten Füße, rein der Materialpreis, und im
// Gegenzug die verbrauchten Füße — Technik oder andere Filiale — gegenüberstellen."
//
// Kosten  = Filament der gedruckten Stücke (Gramm laut Druckdatei × €/kg).
// Nutzen  = ausgegebene Stücke × Stückpreis (Artikel.preis, sonst Kategoriepreis —
//           dieselbe Regel wie „Wert ausgegeben" und Abgaben).
//
// ⚠️ Nicht jeder ausgegebene Fuß ist gedruckt: Es gibt auch Füße ohne Kennzeichen
// (785 „Füße vorne" im Eingang) und geerntete (230 „Füße hinten" aus Spendern).
// Im Karton sind sie nicht mehr unterscheidbar. „Aus dem 3D-Druck" ist deshalb
// RECHNERISCH: Ausgabe eines Artikels × Anteil des Drucks an seinem Eingang.
// Das UI sagt das dazu — wer es zu „gedruckt und ausgegeben" glättet, behauptet
// mehr, als die Buchungen hergeben.
//
// Reine Logik — Test in tests/druck.test.ts.

/** Ersatzwert, wenn keine einzige Vorlage Gramm und Stück je Platte kennt. */
export const GRAMM_JE_STUECK_ERSATZ = 2;
/** Startwert Filamentpreis (PLA, 1 kg). Änderbar auf der Seite. */
export const FILAMENT_EURO_KG_STANDARD = 20;

export type ArtikelInfo = {
  id:            number;
  teiltyp:       string;
  /** Stückpreis in € (Artikel.preis, sonst Kategoriepreis), null = keiner hinterlegt. */
  preis:         number | null;
  /** Eingang über alle Zeit — für den Anteil des Drucks. */
  eingangGesamt: number;
  eingangDruck:  number;
  bestand:       number;
};

/**
 * ausLager = AUSGANG (aus dem Bestand). DIREKT-Buchungen laufen am Lager vorbei
 * (Pass-Through) — sie zählen als ausgegeben, können aber kein gedrucktes Stück
 * aus dem Lager sein und bekommen deshalb keinen Druck-Anteil.
 */
export type Ausgabe   = { artikelId: number; menge: number; anNiederlassung: boolean; ausLager: boolean; monat: string };
/** gramm = Filament laut Druckdatei, null = unbekannt (ältere Einlagerung ohne Vorlage). */
export type DruckPost = { artikelId: number; menge: number; gramm: number | null; monat: string };

export type Summe = { stueck: number; wert: number };

export type TeiltypZeile = {
  teiltyp:          string;
  gedruckt:         number;
  material:         number;
  ausgegeben:       number;
  ausDruck:         number;
  wertAusDruck:     number;
  lagerAusDruck:    number;
};

export type Monat = { monat: string; gedruckt: number; ausgegeben: number; ausDruck: number };

export type Auswertung = {
  gedruckt: {
    stueck: number;
    wert: number;
    gramm: number;
    material: number;
    /** Stück, deren Filament geschätzt ist (keine Vorlage / keine Grammangabe). */
    geschaetztStueck: number;
  };
  ausgegeben: { technik: Summe; niederlassungen: Summe; gesamt: Summe };
  /** Rechnerischer Anteil des Drucks an der Ausgabe. */
  ausDruck: { technik: Summe; niederlassungen: Summe; gesamt: Summe };
  /** Nutzen aus dem Druck minus Material. */
  ergebnis: number;
  /** Heute noch auf Lager, rechnerisch aus dem Druck (unabhängig vom Zeitraum). */
  lagerAusDruck: Summe;
  /** Ausgegebene Stück ohne hinterlegten Preis (fehlen im Wert). */
  ohnePreisStueck: number;
  teiltypen: TeiltypZeile[];
  monate: Monat[];
};

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Anteil des Drucks am Eingang eines Artikels, 0…1. */
export function anteilDruck(a: Pick<ArtikelInfo, "eingangGesamt" | "eingangDruck">): number {
  if (a.eingangGesamt <= 0 || a.eingangDruck <= 0) return 0;
  return Math.min(1, a.eingangDruck / a.eingangGesamt);
}

/**
 * Gramm Filament für einen Druck-Eingang aus Vorlage und Protokoll.
 * Plattenzahl bekannt → exakt wie der Slicer; sonst über Stück je Platte.
 */
export function grammFuerDruck(p: {
  grammJePlatte: number | null; stueckProPlatte: number | null; platten: number | null; stueck: number;
}): number | null {
  if (p.grammJePlatte == null || p.grammJePlatte <= 0) return null;
  if (p.platten != null && p.platten > 0) return p.platten * p.grammJePlatte;
  if (p.stueckProPlatte != null && p.stueckProPlatte > 0) return (p.stueck / p.stueckProPlatte) * p.grammJePlatte;
  return null;
}

/** Ø Gramm je Stück über die Vorlagen, die beides kennen; sonst Ersatzwert. */
export function grammJeStueckSchaetzung(vorlagen: { grammJePlatte: number | null; stueckProPlatte: number | null }[]): number {
  const werte = vorlagen
    .filter((v) => v.grammJePlatte != null && v.grammJePlatte > 0 && v.stueckProPlatte != null && v.stueckProPlatte > 0)
    .map((v) => v.grammJePlatte! / v.stueckProPlatte!);
  if (werte.length === 0) return GRAMM_JE_STUECK_ERSATZ;
  return r2(werte.reduce((s, x) => s + x, 0) / werte.length);
}

/** Monate „JJJJ-MM" von–bis lückenlos (für den Verlauf). */
export function monateZwischen(von: string, bis: string): string[] {
  const out: string[] = [];
  let [j, m] = von.split("-").map(Number) as [number, number];
  const [jb, mb] = bis.split("-").map(Number) as [number, number];
  while (j < jb || (j === jb && m <= mb)) {
    out.push(`${j}-${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; j++; }
    if (out.length > 240) break;
  }
  return out;
}

export function werteAus(e: {
  artikel:          ArtikelInfo[];
  ausgaben:         Ausgabe[];
  drucke:           DruckPost[];
  grammSchaetzung:  number;
  euroProKg:        number;
  /** Erster Monat des Verlaufs (sonst ab dem ersten Datensatz). */
  vonMonat?:        string | null;
  bisMonat:         string;
}): Auswertung {
  const art = new Map(e.artikel.map((a) => [a.id, a]));
  const leer = (): Summe => ({ stueck: 0, wert: 0 });
  const add = (s: Summe, stueck: number, wert: number) => { s.stueck += stueck; s.wert += wert; };

  const zeilen = new Map<string, TeiltypZeile>();
  const zeile = (t: string) => {
    let z = zeilen.get(t);
    if (!z) { z = { teiltyp: t, gedruckt: 0, material: 0, ausgegeben: 0, ausDruck: 0, wertAusDruck: 0, lagerAusDruck: 0 }; zeilen.set(t, z); }
    return z;
  };
  const monate = new Map<string, Monat>();
  const monat = (m: string) => {
    let x = monate.get(m);
    if (!x) { x = { monat: m, gedruckt: 0, ausgegeben: 0, ausDruck: 0 }; monate.set(m, x); }
    return x;
  };

  // Kosten: gedruckte Stücke
  let dStueck = 0, dWert = 0, dGramm = 0, geschaetzt = 0;
  for (const d of e.drucke) {
    const a = art.get(d.artikelId);
    const gramm = d.gramm ?? d.menge * e.grammSchaetzung;
    if (d.gramm == null) geschaetzt += d.menge;
    dStueck += d.menge;
    dGramm += gramm;
    dWert += d.menge * (a?.preis ?? 0);
    if (a) { const z = zeile(a.teiltyp); z.gedruckt += d.menge; z.material += (gramm / 1000) * e.euroProKg; }
    monat(d.monat).gedruckt += d.menge;
  }

  // Nutzen: ausgegebene Stücke, davon rechnerisch aus dem Druck
  const aus = { technik: leer(), niederlassungen: leer() };
  const ausD = { technik: leer(), niederlassungen: leer() };
  let ohnePreis = 0;
  for (const x of e.ausgaben) {
    const a = art.get(x.artikelId);
    if (!a) continue;
    const preis = a.preis ?? 0;
    if (a.preis == null) ohnePreis += x.menge;
    const anteil = x.ausLager ? anteilDruck(a) : 0;
    const ziel = x.anNiederlassung ? "niederlassungen" : "technik";
    add(aus[ziel], x.menge, x.menge * preis);
    add(ausD[ziel], x.menge * anteil, x.menge * anteil * preis);
    const z = zeile(a.teiltyp);
    z.ausgegeben += x.menge;
    z.ausDruck += x.menge * anteil;
    z.wertAusDruck += x.menge * anteil * preis;
    const mo = monat(x.monat);
    mo.ausgegeben += x.menge;
    mo.ausDruck += x.menge * anteil;
  }

  // Heute noch auf Lager aus dem Druck
  const lager = leer();
  for (const a of e.artikel) {
    const anteil = anteilDruck(a);
    if (anteil <= 0 || a.bestand <= 0) continue;
    add(lager, a.bestand * anteil, a.bestand * anteil * (a.preis ?? 0));
    zeile(a.teiltyp).lagerAusDruck += a.bestand * anteil;
  }

  const material = (dGramm / 1000) * e.euroProKg;
  const gesamtD: Summe = { stueck: ausD.technik.stueck + ausD.niederlassungen.stueck, wert: ausD.technik.wert + ausD.niederlassungen.wert };
  const rundS = (s: Summe): Summe => ({ stueck: Math.round(s.stueck), wert: r2(s.wert) });

  const schluessel = [...monate.keys()].sort();
  const erster = e.vonMonat ?? schluessel[0] ?? e.bisMonat;
  const verlauf = monateZwischen(erster, e.bisMonat).map((m) => {
    const x = monate.get(m) ?? { monat: m, gedruckt: 0, ausgegeben: 0, ausDruck: 0 };
    return { ...x, ausDruck: Math.round(x.ausDruck) };
  });

  return {
    gedruckt: { stueck: dStueck, wert: r2(dWert), gramm: Math.round(dGramm), material: r2(material), geschaetztStueck: geschaetzt },
    ausgegeben: {
      technik: rundS(aus.technik), niederlassungen: rundS(aus.niederlassungen),
      gesamt: rundS({ stueck: aus.technik.stueck + aus.niederlassungen.stueck, wert: aus.technik.wert + aus.niederlassungen.wert }),
    },
    ausDruck: { technik: rundS(ausD.technik), niederlassungen: rundS(ausD.niederlassungen), gesamt: rundS(gesamtD) },
    ergebnis: r2(gesamtD.wert - material),
    lagerAusDruck: rundS(lager),
    ohnePreisStueck: ohnePreis,
    teiltypen: [...zeilen.values()]
      .sort((a, b) => a.teiltyp.localeCompare(b.teiltyp, "de"))
      .map((z) => ({ ...z, material: r2(z.material), ausDruck: Math.round(z.ausDruck), wertAusDruck: r2(z.wertAusDruck), lagerAusDruck: Math.round(z.lagerAusDruck) })),
    monate: verlauf,
  };
}

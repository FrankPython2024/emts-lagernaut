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
// RECHNERISCH — Modell „gemischter Karton": Je Artikel wird mitgeführt, wie viele
// gedruckte und wie viele andere Stücke im Lager liegen. Eine Ausgabe nimmt aus
// beiden im Verhältnis DIESES Augenblicks.
// ⚠️ Audit 30.09.2026: Die erste Fassung nahm den Anteil über ALLE Zeit — auch
// Ausgaben von vor dem ersten Druck bekamen einen Druck-Anteil.
// DIREKT-Buchungen laufen am Lager vorbei und sind nie ein gedrucktes Lagerstück.
//
// Reine Logik — Test in tests/druck.test.ts.

/** Ersatzwert, wenn keine einzige Vorlage Gramm und Stück je Platte kennt. */
export const GRAMM_JE_STUECK_ERSATZ = 2;
/** Startwert Filamentpreis (PLA, 1 kg). Änderbar auf der Seite. */
export const FILAMENT_EURO_KG_STANDARD = 20;

export type ArtikelInfo = {
  id:      number;
  teiltyp: string;
  /** Stückpreis in € (Artikel.preis, sonst Kategoriepreis), null = keiner hinterlegt. */
  preis:   number | null;
  bestand: number;
};

/**
 * Eine Buchung (ohne Umlagerungen), ALLE Zeit — der Zeitraum steckt in `imZeitraum`.
 * Die Reihenfolge je Artikel ergibt `zeit` (dann `id`).
 */
export type Bewegung = {
  id:              number;
  artikelId:       number;
  zeit:            number;
  typ:             "EINGANG" | "AUSGANG" | "DIREKT";
  menge:           number;
  /** Nur EINGANG: 3D-gedruckt (herkunftArt DRUCK). */
  druck?:          boolean;
  /** Nur Druck-EINGANG: Filament laut Druckdatei, null = unbekannt (geschätzt). */
  gramm?:          number | null;
  anNiederlassung?: boolean;
  monat:           string;
  imZeitraum:      boolean;
};

export type Summe = { stueck: number; wert: number };

export type TeiltypZeile = {
  teiltyp:       string;
  gedruckt:      number;
  material:      number;
  ausgegeben:    number;
  ausDruck:      number;
  wertAusDruck:  number;
  lagerAusDruck: number;
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

/**
 * Gramm Filament für einen Druck-Eingang. Stück je Platte bekannt → über die
 * eingebuchte Stückzahl (die ist verlässlich; die Plattenzahl bleibt im Dialog
 * leicht auf 1 stehen, wenn jemand die Stückzahl von Hand ändert — Audit
 * 30.09.2026). Sonst über die Plattenzahl.
 */
export function grammFuerDruck(p: {
  grammJePlatte: number | null; stueckProPlatte: number | null; platten: number | null; stueck: number;
}): number | null {
  if (p.grammJePlatte == null || p.grammJePlatte <= 0) return null;
  if (p.stueckProPlatte != null && p.stueckProPlatte > 0) return r2((p.stueck / p.stueckProPlatte) * p.grammJePlatte);
  if (p.platten != null && p.platten > 0) return r2(p.platten * p.grammJePlatte);
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
  artikel:         ArtikelInfo[];
  bewegungen:      Bewegung[];
  grammSchaetzung: number;
  euroProKg:       number;
  /** Erster Monat des Verlaufs (sonst ab der ersten Bewegung im Zeitraum). */
  vonMonat?:       string | null;
  bisMonat:        string;
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

  let dStueck = 0, dWert = 0, dGramm = 0, geschaetzt = 0, ohnePreis = 0;
  const aus = { technik: leer(), niederlassungen: leer() };
  const ausD = { technik: leer(), niederlassungen: leer() };
  const lager = leer();

  // Je Artikel der Reihe nach: Wie viele gedruckte / andere Stücke liegen im Lager?
  const jeArtikel = new Map<number, Bewegung[]>();
  for (const b of e.bewegungen) {
    if (!art.has(b.artikelId)) continue;
    const l = jeArtikel.get(b.artikelId);
    if (l) l.push(b); else jeArtikel.set(b.artikelId, [b]);
  }

  for (const a of e.artikel) {
    const preis = a.preis ?? 0;
    const z = zeile(a.teiltyp);
    let druckRest = 0, andereRest = 0;
    const liste = (jeArtikel.get(a.id) ?? []).sort((x, y) => x.zeit - y.zeit || x.id - y.id);
    for (const b of liste) {
      if (b.typ === "EINGANG") {
        if (b.druck) {
          druckRest += b.menge;
          if (b.imZeitraum) {
            const gramm = b.gramm ?? b.menge * e.grammSchaetzung;
            if (b.gramm == null) geschaetzt += b.menge;
            dStueck += b.menge;
            dGramm += gramm;
            dWert += b.menge * preis;
            z.gedruckt += b.menge;
            z.material += (gramm / 1000) * e.euroProKg;
            monat(b.monat).gedruckt += b.menge;
          }
        } else {
          andereRest += b.menge;
        }
        continue;
      }
      // Ausgabe: aus dem Lager (AUSGANG) im Verhältnis dieses Augenblicks; DIREKT nie gedruckt.
      let ausDruck = 0;
      if (b.typ === "AUSGANG") {
        const gesamt = druckRest + andereRest;
        ausDruck = gesamt > 0 ? Math.min(b.menge, b.menge * (druckRest / gesamt)) : 0;
        druckRest = Math.max(0, druckRest - ausDruck);
        andereRest = Math.max(0, andereRest - (b.menge - ausDruck));
      }
      if (!b.imZeitraum) continue;
      if (a.preis == null) ohnePreis += b.menge;
      const ziel = b.anNiederlassung ? "niederlassungen" : "technik";
      add(aus[ziel], b.menge, b.menge * preis);
      add(ausD[ziel], ausDruck, ausDruck * preis);
      z.ausgegeben += b.menge;
      z.ausDruck += ausDruck;
      z.wertAusDruck += ausDruck * preis;
      const mo = monat(b.monat);
      mo.ausgegeben += b.menge;
      mo.ausDruck += ausDruck;
    }
    // Heute auf Lager: der echte Bestand im Verhältnis des Kartons.
    const gesamt = druckRest + andereRest;
    if (gesamt > 0 && druckRest > 0 && a.bestand > 0) {
      const stueck = a.bestand * (druckRest / gesamt);
      add(lager, stueck, stueck * preis);
      z.lagerAusDruck += stueck;
    }
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
      .filter((z) => z.gedruckt || z.ausgegeben || z.lagerAusDruck)
      .sort((a, b) => a.teiltyp.localeCompare(b.teiltyp, "de"))
      .map((z) => ({ ...z, material: r2(z.material), ausDruck: Math.round(z.ausDruck), wertAusDruck: r2(z.wertAusDruck), lagerAusDruck: Math.round(z.lagerAusDruck) })),
    monate: verlauf,
  };
}

import { AnfrageStatus } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { prisma } from "@/core/db/prisma";

/**
 * Bestell-Empfehlungs-System.
 *
 * Auswertung der NICHT_VERFUEGBAR-Anfragen gegen die manuell erfassten externen
 * Bestellungen. Gruppiert wird über (Modellname, Teiltyp) — Anfrage trägt kein
 * modellId-FK, sondern das Modell als String (geraeteName). Genau dieser String
 * wird auch in ExterneBestellung gespeichert, daher matchen beide Seiten exakt.
 *
 * offen = max(0, anzahlAnfragen − anzahlBestellt)
 */

export type BestellempfehlungZeile = {
  key:                   string;
  modellId:              number | null;
  modellName:            string;
  hersteller:            string | null;
  teiltyp:               string;
  anzahlAnfragen:        number;
  anzahlBestellt:        number;
  anzahlOffen:           number;
  letzteAnfrageDatum:    Date | null;
  letzteBestellungDatum: Date | null;
};

function komboKey(modellName: string, teiltyp: string): string {
  return `${modellName.trim().toLowerCase()}|||${teiltyp.trim().toLowerCase()}`;
}

// Best-effort Modell-Auflösung (geraeteName-String → GeraeteModell) nur für die
// Anzeige von Hersteller/modellId. Matcht "Modell" oder "Hersteller Modell".
async function modellResolver(): Promise<(name: string) => { id: number; hersteller: string } | null> {
  const modelle = await prisma.geraeteModell.findMany({
    select: { id: true, hersteller: true, modell: true },
  });
  const byModell = new Map<string, { id: number; hersteller: string }>();
  const byFull   = new Map<string, { id: number; hersteller: string }>();
  for (const m of modelle) {
    const entry = { id: m.id, hersteller: m.hersteller };
    byModell.set(m.modell.trim().toLowerCase(), entry);
    byFull.set(`${m.hersteller} ${m.modell}`.trim().toLowerCase(), entry);
  }
  return (name: string) => {
    const lc = name.trim().toLowerCase();
    return byFull.get(lc) ?? byModell.get(lc) ?? null;
  };
}

/**
 * Haupt-Auswertung. `nurOffen` filtert auf anzahlOffen > 0.
 * Default-Sortierung: anzahlOffen DESC, dann letzteAnfrageDatum DESC.
 */
export async function getBestellempfehlung(opts?: { nurOffen?: boolean }): Promise<BestellempfehlungZeile[]> {
  // 1) NICHT_VERFUEGBAR-Anfragen — Menge überschaubar, Aggregation in JS
  //    (erlaubt Fallback geraeteName ?? geraet als Modell-Schlüssel).
  const anfragen = await prisma.anfrage.findMany({
    where:  { status: AnfrageStatus.NICHT_VERFUEGBAR },
    select: { geraeteName: true, geraet: true, teil: true, datum: true },
  });

  // 2) Externe Bestellungen — Summe + letztes Datum je Kombination
  const bestellGrouped = await prisma.externeBestellung.groupBy({
    by:    ["modellName", "teiltyp"],
    _sum:  { anzahl: true },
    _max:  { bestelltAm: true },
  });

  type Acc = {
    modellName: string; teiltyp: string;
    anzahlAnfragen: number; anzahlBestellt: number;
    letzteAnfrageDatum: Date | null; letzteBestellungDatum: Date | null;
  };
  const map = new Map<string, Acc>();

  for (const a of anfragen) {
    const modellName = (a.geraeteName ?? a.geraet ?? "").trim();
    if (!modellName) continue;
    const teiltyp = a.teil.trim();
    const k = komboKey(modellName, teiltyp);
    const cur = map.get(k) ?? { modellName, teiltyp, anzahlAnfragen: 0, anzahlBestellt: 0, letzteAnfrageDatum: null, letzteBestellungDatum: null };
    cur.anzahlAnfragen += 1;
    if (!cur.letzteAnfrageDatum || a.datum > cur.letzteAnfrageDatum) cur.letzteAnfrageDatum = a.datum;
    map.set(k, cur);
  }

  for (const b of bestellGrouped) {
    const k = komboKey(b.modellName, b.teiltyp);
    const cur = map.get(k) ?? { modellName: b.modellName, teiltyp: b.teiltyp, anzahlAnfragen: 0, anzahlBestellt: 0, letzteAnfrageDatum: null, letzteBestellungDatum: null };
    cur.anzahlBestellt        = b._sum.anzahl ?? 0;
    cur.letzteBestellungDatum = b._max.bestelltAm ?? null;
    map.set(k, cur);
  }

  const resolve = await modellResolver();

  let zeilen: BestellempfehlungZeile[] = Array.from(map.entries()).map(([key, c]) => {
    const m = resolve(c.modellName);
    return {
      key,
      modellId:              m?.id ?? null,
      modellName:            c.modellName,
      hersteller:            m?.hersteller ?? null,
      teiltyp:               c.teiltyp,
      anzahlAnfragen:        c.anzahlAnfragen,
      anzahlBestellt:        c.anzahlBestellt,
      anzahlOffen:           Math.max(0, c.anzahlAnfragen - c.anzahlBestellt),
      letzteAnfrageDatum:    c.letzteAnfrageDatum,
      letzteBestellungDatum: c.letzteBestellungDatum,
    };
  });

  if (opts?.nurOffen) zeilen = zeilen.filter(z => z.anzahlOffen > 0);

  zeilen.sort((a, b) =>
    b.anzahlOffen - a.anzahlOffen ||
    (b.letzteAnfrageDatum?.getTime() ?? 0) - (a.letzteAnfrageDatum?.getTime() ?? 0),
  );

  return zeilen;
}

export async function getTop5Bestellempfehlung(): Promise<BestellempfehlungZeile[]> {
  const alle = await getBestellempfehlung({ nurOffen: true });
  return alle.slice(0, 5);
}

export async function getBestellungenZuKombination(modellName: string, teiltyp: string) {
  return prisma.externeBestellung.findMany({
    where:   { modellName: modellName.trim(), teiltyp: teiltyp.trim() },
    orderBy: { bestelltAm: "desc" },
    include: { user: { select: { name: true, kuerzel: true } } },
  });
}

function pruefeEingabe(anzahl: number, bestelltAm: Date): void {
  if (!Number.isInteger(anzahl) || anzahl <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Anzahl muss größer als 0 sein." });
  }
  // Vergleich am Tagesende, damit „heute" gültig bleibt
  const endeHeute = new Date(); endeHeute.setHours(23, 59, 59, 999);
  if (bestelltAm.getTime() > endeHeute.getTime()) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Bestelldatum darf nicht in der Zukunft liegen." });
  }
}

export async function erfasseBestellung(data: {
  modellName:  string;
  hersteller?: string | null;
  teiltyp:     string;
  anzahl:      number;
  bestelltAm:  Date;
  notiz?:      string;
  erstelltVon: string;
}) {
  pruefeEingabe(data.anzahl, data.bestelltAm);
  return prisma.externeBestellung.create({
    data: {
      modellName:  data.modellName.trim(),
      hersteller:  data.hersteller?.trim() || null,
      teiltyp:     data.teiltyp.trim(),
      anzahl:      data.anzahl,
      bestelltAm:  data.bestelltAm,
      notiz:       data.notiz?.trim() || null,
      erstelltVon: data.erstelltVon,
    },
  });
}

export async function aktualisiereBestellung(data: {
  id:         number;
  anzahl:     number;
  bestelltAm: Date;
  notiz?:     string;
}) {
  pruefeEingabe(data.anzahl, data.bestelltAm);
  const vorhanden = await prisma.externeBestellung.findUnique({ where: { id: data.id } });
  if (!vorhanden) throw new TRPCError({ code: "NOT_FOUND", message: "Bestellung nicht gefunden." });

  return prisma.externeBestellung.update({
    where: { id: data.id },
    data: {
      anzahl:     data.anzahl,
      bestelltAm: data.bestelltAm,
      notiz:      data.notiz?.trim() || null,
    },
  });
}

export async function loescheBestellung(id: number) {
  const vorhanden = await prisma.externeBestellung.findUnique({ where: { id } });
  if (!vorhanden) throw new TRPCError({ code: "NOT_FOUND", message: "Bestellung nicht gefunden." });
  await prisma.externeBestellung.delete({ where: { id } });
  return vorhanden;
}

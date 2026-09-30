import { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/prisma";
import { berlinMonat, zeitraum } from "@/lib/zeit/berlin";
import { NICHT_UMLAGERUNG } from "@/lib/buchungen/umlagerung";
import { DRUCK_TEILTYPEN_STANDARD } from "@/lib/druck/druckliste";
import {
  FILAMENT_EURO_KG_STANDARD, grammFuerDruck, grammJeStueckSchaetzung, werteAus,
  type ArtikelInfo, type Ausgabe, type DruckPost,
} from "@/lib/druck/auswertung";
import { druckdateiInfo, waehlePlatte } from "@/modules/druck/vorschau";

// ── 3D-Druck-Auswertung: Daten laden (30.09.2026) ────────────────────────────
// Rechnen: src/lib/druck/auswertung.ts. Hier nur Buchungen, Preise, Gramm holen.
//
// Zeitraum über `zeitraum(tage)` und `Buchung.datum` wie jede Statistik
// (CLAUDE.md, Statistik-Grundregel 1). Ausgaben ohne Umlagerungen, wie
// AUSGABE_AN_TECHNIK — hier aber MIT Abgaben an Niederlassungen (Frank: „sei es
// von der Technik oder wenn sie in eine andere Filiale gehen").

const EINSTELLUNG_ID = 1;

export async function filamentPreis(): Promise<number> {
  const e = await prisma.druckEinstellung.findUnique({ where: { id: EINSTELLUNG_ID } });
  return e ? Number(e.filamentEuroProKg) : FILAMENT_EURO_KG_STANDARD;
}

export async function setzeFilamentPreis(euroProKg: number, von: string): Promise<void> {
  const daten = { filamentEuroProKg: new Prisma.Decimal(euroProKg.toFixed(2)), geaendertVon: von };
  await prisma.druckEinstellung.upsert({ where: { id: EINSTELLUNG_ID }, create: { id: EINSTELLUNG_ID, ...daten }, update: daten });
}

const monatVon = (d: Date) => { const m = berlinMonat(d); return `${m.jahr}-${String(m.monat).padStart(2, "0")}`; };

/** Gramm je Platte der neuesten Druckdatei jeder Vorlage (aus slice_info, zwischengespeichert). */
async function grammJeVorlage(): Promise<Map<number, { grammJePlatte: number | null; stueckProPlatte: number | null }>> {
  const vorlagen = await prisma.druckvorlage.findMany({
    select: {
      id: true, stueckProPlatte: true,
      dateien: { where: { art: "DRUCK" }, select: { id: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  const out = new Map<number, { grammJePlatte: number | null; stueckProPlatte: number | null }>();
  for (const v of vorlagen) {
    let gramm: number | null = null;
    const datei = v.dateien[0];
    // try je Datei: Eine kaputte Datei darf die Auswertung nicht mitreißen.
    if (datei) {
      try {
        const info = await druckdateiInfo(datei.id);
        gramm = info ? (waehlePlatte(info, null)?.gramm ?? null) : null;
      } catch { gramm = null; }
    }
    out.set(v.id, { grammJePlatte: gramm, stueckProPlatte: v.stueckProPlatte });
  }
  return out;
}

export async function ladeAuswertung(tage: number | null, artikelFilter: Prisma.ArtikelWhereInput) {
  const jetzt = new Date();
  const von = tage ? zeitraum(tage, jetzt).von : null;
  const datum = von ? { datum: { gte: von } } : {};

  // Teiltypen = alles, was schon mal gedruckt wurde, plus die Füße.
  const gedruckteTypen = await prisma.artikel.findMany({
    where: { ...artikelFilter, buchungen: { some: { herkunftArt: "DRUCK" } } },
    select: { kategorie: true }, distinct: ["kategorie"],
  });
  const teiltypen = [...new Set<string>([...DRUCK_TEILTYPEN_STANDARD, ...gedruckteTypen.map((a) => a.kategorie)])];
  const artikelWo: Prisma.ArtikelWhereInput = { ...artikelFilter, kategorie: { in: teiltypen } };

  const [artikel, kategoriePreise, eingaenge, ausgaben, drucke, euroProKg, vorlagen] = await Promise.all([
    prisma.artikel.findMany({ where: artikelWo, select: { id: true, kategorie: true, preis: true, bestand: true } }),
    prisma.kategoriePreis.findMany({ where: { kategorie: { in: teiltypen } }, select: { kategorie: true, preis: true } }),
    prisma.buchung.groupBy({
      by: ["artikelId", "herkunftArt"],
      where: { typ: "EINGANG", AND: [NICHT_UMLAGERUNG], artikel: artikelWo },
      _sum: { menge: true },
    }),
    prisma.buchung.findMany({
      where: { typ: { in: ["AUSGANG", "DIREKT"] }, AND: [NICHT_UMLAGERUNG], artikel: artikelWo, ...datum },
      select: { artikelId: true, menge: true, typ: true, niederlassungId: true, datum: true },
    }),
    prisma.buchung.findMany({
      where: { typ: "EINGANG", herkunftArt: "DRUCK", artikel: artikelWo, ...datum },
      select: { id: true, artikelId: true, menge: true, datum: true },
    }),
    filamentPreis(),
    grammJeVorlage(),
  ]);

  const protokolle = drucke.length === 0 ? [] : await prisma.druckProtokoll.findMany({
    where: { buchungId: { in: drucke.map((d) => d.id) } },
    select: { buchungId: true, vorlageId: true, platten: true, stueck: true },
  });
  const protokollZu = new Map(protokolle.map((p) => [p.buchungId, p]));

  const katPreis = new Map(kategoriePreise.map((k) => [k.kategorie, Number(k.preis)]));
  const eingang = new Map<number, { gesamt: number; druck: number }>();
  for (const g of eingaenge) {
    if (g.artikelId == null) continue;
    const e = eingang.get(g.artikelId) ?? { gesamt: 0, druck: 0 };
    const menge = g._sum.menge ?? 0;
    e.gesamt += menge;
    if (g.herkunftArt === "DRUCK") e.druck += menge;
    eingang.set(g.artikelId, e);
  }

  const info: ArtikelInfo[] = artikel.map((a) => ({
    id: a.id,
    teiltyp: a.kategorie,
    // Stückpreis wie „Wert ausgegeben": Einzelpreis schlägt Kategoriepreis.
    preis: a.preis != null ? Number(a.preis) : (katPreis.get(a.kategorie) ?? null),
    eingangGesamt: eingang.get(a.id)?.gesamt ?? 0,
    eingangDruck:  eingang.get(a.id)?.druck ?? 0,
    bestand: a.bestand,
  }));

  const posten: Ausgabe[] = ausgaben.filter((b) => b.artikelId != null).map((b) => ({
    artikelId: b.artikelId!, menge: b.menge, anNiederlassung: b.niederlassungId != null,
    ausLager: b.typ === "AUSGANG", monat: monatVon(b.datum),
  }));

  const grammSchaetzung = grammJeStueckSchaetzung([...vorlagen.values()]);
  const druckPosten: DruckPost[] = drucke.filter((d) => d.artikelId != null).map((d) => {
    const p = protokollZu.get(d.id);
    const v = p?.vorlageId != null ? vorlagen.get(p.vorlageId) : undefined;
    const gramm = p && v
      ? grammFuerDruck({ grammJePlatte: v.grammJePlatte, stueckProPlatte: v.stueckProPlatte, platten: p.platten, stueck: d.menge })
      : null;
    return { artikelId: d.artikelId!, menge: d.menge, gramm, monat: monatVon(d.datum) };
  });

  const ergebnis = werteAus({
    artikel: info, ausgaben: posten, drucke: druckPosten, grammSchaetzung, euroProKg,
    vonMonat: von ? monatVon(von) : null, bisMonat: monatVon(jetzt),
  });
  return { ...ergebnis, tage, von, teiltypenListe: teiltypen, grammSchaetzung, euroProKg };
}

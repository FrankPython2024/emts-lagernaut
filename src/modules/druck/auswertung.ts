import { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/prisma";
import { berlinMonat, zeitraum } from "@/lib/zeit/berlin";
import { NICHT_UMLAGERUNG } from "@/lib/buchungen/umlagerung";
import { DRUCK_TEILTYPEN_STANDARD } from "@/lib/druck/druckliste";
import {
  FILAMENT_EURO_KG_STANDARD, grammFuerDruck, grammJeStueckSchaetzung, werteAus,
  type ArtikelInfo, type Bewegung,
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

  // Teiltypen = alles, was schon mal gedruckt wurde, plus die Füße.
  const gedruckteTypen = await prisma.artikel.findMany({
    where: { ...artikelFilter, buchungen: { some: { herkunftArt: "DRUCK" } } },
    select: { kategorie: true }, distinct: ["kategorie"],
  });
  const teiltypen = [...new Set<string>([...DRUCK_TEILTYPEN_STANDARD, ...gedruckteTypen.map((a) => a.kategorie)])];
  const artikelWo: Prisma.ArtikelWhereInput = { ...artikelFilter, kategorie: { in: teiltypen } };

  // ALLE Bewegungen (ohne Umlagerungen): Der Druck-Anteil im Lager hängt an der
  // ganzen Geschichte des Artikels, nicht nur am Zeitraum (src/lib/druck/auswertung.ts).
  const [artikel, kategoriePreise, buchungen, euroProKg, vorlagen] = await Promise.all([
    prisma.artikel.findMany({ where: artikelWo, select: { id: true, kategorie: true, preis: true, bestand: true } }),
    prisma.kategoriePreis.findMany({ where: { kategorie: { in: teiltypen } }, select: { kategorie: true, preis: true } }),
    prisma.buchung.findMany({
      where: { typ: { in: ["EINGANG", "AUSGANG", "DIREKT"] }, AND: [NICHT_UMLAGERUNG], artikel: artikelWo },
      select: { id: true, artikelId: true, menge: true, typ: true, herkunftArt: true, niederlassungId: true, datum: true },
    }),
    filamentPreis(),
    grammJeVorlage(),
  ]);

  const druckIds = buchungen.filter((b) => b.typ === "EINGANG" && b.herkunftArt === "DRUCK").map((b) => b.id);
  const protokolle = druckIds.length === 0 ? [] : await prisma.druckProtokoll.findMany({
    where: { buchungId: { in: druckIds } },
    select: { buchungId: true, vorlageId: true, platten: true, stueck: true },
  });
  const protokollZu = new Map(protokolle.map((p) => [p.buchungId, p]));
  const katPreis = new Map(kategoriePreise.map((k) => [k.kategorie, Number(k.preis)]));

  const info: ArtikelInfo[] = artikel.map((a) => ({
    id: a.id,
    teiltyp: a.kategorie,
    // Stückpreis wie „Wert ausgegeben": Einzelpreis schlägt Kategoriepreis.
    preis: a.preis != null ? Number(a.preis) : (katPreis.get(a.kategorie) ?? null),
    bestand: a.bestand,
  }));

  const grammSchaetzung = grammJeStueckSchaetzung([...vorlagen.values()]);
  const bewegungen: Bewegung[] = buchungen.map((b) => {
    const druck = b.typ === "EINGANG" && b.herkunftArt === "DRUCK";
    let gramm: number | null = null;
    if (druck) {
      const p = protokollZu.get(b.id);
      const v = p?.vorlageId != null ? vorlagen.get(p.vorlageId) : undefined;
      gramm = p && v
        ? grammFuerDruck({ grammJePlatte: v.grammJePlatte, stueckProPlatte: v.stueckProPlatte, platten: p.platten, stueck: b.menge })
        : null;
    }
    return {
      id: b.id, artikelId: b.artikelId, zeit: b.datum.getTime(), typ: b.typ as Bewegung["typ"], menge: b.menge,
      druck, gramm, anNiederlassung: b.niederlassungId != null,
      monat: monatVon(b.datum), imZeitraum: !von || b.datum >= von,
    };
  });

  const ergebnis = werteAus({
    artikel: info, bewegungen, grammSchaetzung, euroProKg,
    vonMonat: von ? monatVon(von) : null, bisMonat: monatVon(jetzt),
  });
  return { ...ergebnis, tage, von, teiltypenListe: teiltypen, grammSchaetzung, euroProKg };
}

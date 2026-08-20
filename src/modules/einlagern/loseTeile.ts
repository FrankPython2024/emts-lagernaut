import { BuchungsTyp } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { prisma } from "@/core/db/prisma";
import { bucheLager } from "@/modules/buchungen/service";
import {
  findeOderLegeAn, artikelZuNummer, verknuepfeArtikel, normalisiere,
  speichereFoto as speichereTeilFoto,
} from "@/modules/teilenummern/service";

// ── Einlagern ohne Spendergerät ──────────────────────────────────────────────
//
// Der zweite Weg in den Assistenten: Es liegt nur das Teil da. Keine LogID,
// kein Gerät, oft nicht einmal ein Name. Das passiert bei Teilen aus einer
// Kiste, aus einer Lieferung oder aus einem Gerät, das längst verschrottet ist.
//
// Anker ist hier die Teilenummer statt der LogID. Was auf Weg A das
// Spendergerät leistet — eine gesicherte Aussage, wo das Teil hineinpasst —
// fehlt hier. Deshalb wird auf diesem Weg KEINE Kompatibilität geraten.
// Übernommen werden nur Modelle, die an der Nummer bereits bestätigt sind.
//
// ⚠️ Ohne Teilenummer UND ohne Bezeichnung ginge es nicht: Zwei lose Touchpads
// wären sonst derselbe Artikel wie alle anderen losen Touchpads. Eins von
// beidem muss da sein, sonst lehnt der Server ab.

export type LosesTeilInput = {
  teilenummer?: string | null;
  bezeichnung?: string | null;  // Freitext, wenn keine Nummer lesbar ist
  teiltyp:      string;
  menge:        number;
  grading?:     string | null;
  lagerplatz?:  string | null;
  notiz?:       string | null;
  /**
   * Foto aus der Erkennung. Bleibt als Vergleichsbild an der Teilenummer
   * hängen — und ist zugleich ein beschriftetes Trainingsbeispiel für ein
   * späteres eigenes Erkennungsmodell.
   */
  fotoBase64?:  string | null;
  mitarbeiter:  string;
  standortId:   number;
};

export type LosesTeilErgebnis = {
  artikelId:    number;
  bezeichnung:  string;
  kategorie:    string;
  menge:        number;
  neuerBestand: number;
  neuAngelegt:  boolean;
  teilenummer:  string | null;
  /** Modelle, die aus der bereits bestätigten Nummer übernommen wurden. */
  modelle:      string[];
  hinweis:      string | null;
};

export async function erfasseLosesTeil(input: LosesTeilInput): Promise<LosesTeilErgebnis> {
  const nummerRoh   = input.teilenummer?.trim() || "";
  const freitext    = input.bezeichnung?.trim() || "";
  const teiltyp     = input.teiltyp.trim();

  if (!nummerRoh && !freitext) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Ohne Teilenummer brauche ich wenigstens eine Bezeichnung, sonst lässt sich das Teil später nicht wiederfinden.",
    });
  }
  if (input.menge < 1) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Menge muss mindestens 1 sein." });
  }

  let teilenummerId: number | null = null;
  let nummer: string | null = null;
  let hinweis: string | null = null;

  if (nummerRoh) {
    const tn = await findeOderLegeAn(prisma, nummerRoh, { teiltyp });
    nummer = tn.nummer;
    if (tn.istSeriennummer) {
      // Als Seriennummer gekennzeichnet: taugt nicht als Identität, sonst
      // entsteht je Stück ein eigener Artikel. Ohne Freitext geht es dann nicht.
      hinweis = `${tn.nummer} ist als Seriennummer gekennzeichnet und wird nicht zur Zuordnung genutzt.`;
      if (!freitext) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${hinweis} Bitte zusätzlich eine Bezeichnung angeben.`,
        });
      }
    } else {
      teilenummerId = tn.id;

      // Foto an der Nummer ablegen. Nur beim ERSTEN Mal — ein späteres Foto
      // desselben Teils bringt nichts Neues, kostet aber Platz.
      if (input.fotoBase64 && tn.neu) {
        await speichereTeilFoto(tn.id, input.fotoBase64);
      }
    }
  }

  // ── Artikel bestimmen ─────────────────────────────────────────────────────
  // Reihenfolge ist die Identitätsregel: Nummer schlägt Bezeichnung.
  let artikel = teilenummerId != null
    ? await artikelZuNummer(prisma, teilenummerId, input.standortId)
    : null;

  const bezeichnung = artikel?.bezeichnung
    ?? (freitext
      ? (nummer ? `${freitext} ${nummer}` : freitext)
      : `${teiltyp} ${nummer}`);

  let neuAngelegt = false;
  if (!artikel) {
    const vorhanden = await prisma.artikel.findFirst({
      where:  { bezeichnung, kategorie: teiltyp, standortId: input.standortId },
      select: { id: true, bezeichnung: true, kategorie: true, lagerplatz: true, bestand: true },
    });
    if (vorhanden) {
      artikel = vorhanden;
    } else {
      const neu = await prisma.artikel.create({
        data: {
          bezeichnung,
          kategorie:  teiltyp,
          bestand:    0,
          lagerplatz: input.lagerplatz?.trim() || null,
          standortId: input.standortId,
        },
        select: { id: true, bezeichnung: true, kategorie: true, lagerplatz: true, bestand: true },
      });
      artikel = neu;
      neuAngelegt = true;
    }
  }

  if (teilenummerId != null) {
    const v = await verknuepfeArtikel(prisma, artikel.id, teilenummerId);
    if (!v.gesetzt && v.grund) hinweis = [hinweis, v.grund].filter(Boolean).join(" ");
  }

  // Lagerplatz nachziehen, wenn einer angegeben wurde und der Artikel noch
  // keinen oder einen anderen hat.
  const platz = input.lagerplatz?.trim() || null;
  if (platz && artikel.lagerplatz !== platz) {
    await prisma.artikel.update({ where: { id: artikel.id }, data: { lagerplatz: platz } });
  }

  // ── Buchen ────────────────────────────────────────────────────────────────
  // Kein herkunftLogId: Es gab kein Spendergerät. Die Ernte-Auswertung darf
  // dieses Teil nicht als geerntet zählen.
  const notiz = [
    input.grading ? `Grading: ${input.grading}` : null,
    "Ohne Spendergerät erfasst",
    nummer ? `Teilenummer: ${nummer}` : null,
    input.notiz?.trim() || null,
  ].filter(Boolean).join(" | ");

  await bucheLager({
    artikelId:   artikel.id,
    menge:       input.menge,
    typ:         BuchungsTyp.EINGANG,
    mitarbeiter: input.mitarbeiter,
    notiz,
  });

  const nachher = await prisma.artikel.findUnique({
    where: { id: artikel.id }, select: { bestand: true },
  });

  // ── Kompatibilität nur aus BESTÄTIGTEN Modellen ───────────────────────────
  // Hier wird nichts geraten. Was an der Nummer schon bestätigt ist, wird auf
  // den Artikel übertragen, damit das Teil im Techniker-Portal auftaucht.
  const modelle: string[] = [];
  if (teilenummerId != null) {
    const zeilen = await prisma.teilenummerModell.findMany({
      where:   { teilenummerId, bestaetigt: true },
      include: { modell: { select: { hersteller: true, modell: true } } },
    });
    for (const z of zeilen) {
      const geraet = `${z.modell.hersteller} ${z.modell.modell}`.trim();
      await prisma.kompatibilitaet.upsert({
        where:  { geraet_teiltyp_artikelId: { geraet, teiltyp, artikelId: artikel.id } },
        create: { geraet, teiltyp, artikelId: artikel.id },
        update: {},
      });
      modelle.push(geraet);
    }
  }

  return {
    artikelId:    artikel.id,
    bezeichnung:  artikel.bezeichnung,
    kategorie:    teiltyp,
    menge:        input.menge,
    neuerBestand: nachher?.bestand ?? 0,
    neuAngelegt,
    teilenummer:  nummer ? normalisiere(nummer) : null,
    modelle,
    hinweis,
  };
}

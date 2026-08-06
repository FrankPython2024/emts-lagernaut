import { BuchungsTyp } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { prisma } from "@/core/db/prisma";
import { bucheLager } from "@/modules/buchungen/service";
import {
  KATEGORIE_DATENTRAEGER, KATEGORIE_ARBEITSSPEICHER,
  bezeichnungDatentraeger, bezeichnungRam,
} from "@/lib/einlagern/komponenten";

// ── Bestandserfassung für Datenträger und Arbeitsspeicher ────────────────────
//
// Anders als beim Ernten aus einem Spendergerät wird hier keine LogID erfasst:
// Diese Teile kommen kartonweise zusammen, die Herkunft des einzelnen Riegels
// ist weder bekannt noch relevant. Erfasst wird, was tatsächlich im Regal liegt.
//
// Ablauf je Zeile: Bezeichnung aus den Merkmalen bauen, Artikel suchen, bei
// Bedarf anlegen, EINGANG buchen. Der Artikel wird über Bezeichnung + Kategorie
// + Standort gesucht, also genau über den Unique-Schlüssel der Tabelle — damit
// kann kein zweiter Artikel gleichen Namens entstehen.

export type KomponentenZeile =
  | { art: "DATENTRAEGER"; groesse: string; schnittstelle: string; bauform: string; typ: string; menge: number; preis?: number | null; lagerplatz?: string | null }
  | { art: "RAM";          groesse: string; generation: string;    bauform: string;                menge: number; preis?: number | null; lagerplatz?: string | null };

export type ErfassungsErgebnis = {
  bezeichnung:  string;
  kategorie:    string;
  menge:        number;
  neuerBestand: number;
  neuAngelegt:  boolean;
  lagerplatz:   string | null;
};

export async function erfasseKomponenten(input: {
  zeilen:      KomponentenZeile[];
  mitarbeiter: string;
  standortId:  number;
}): Promise<ErfassungsErgebnis[]> {
  if (input.zeilen.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Keine Zeilen zum Erfassen." });
  }

  const ergebnisse: ErfassungsErgebnis[] = [];

  for (const z of input.zeilen) {
    const bezeichnung = z.art === "DATENTRAEGER"
      ? bezeichnungDatentraeger({ art: z.typ, groesse: z.groesse, schnittstelle: z.schnittstelle, bauform: z.bauform })
      : bezeichnungRam({ groesse: z.groesse, generation: z.generation, bauform: z.bauform });

    const kategorie = z.art === "DATENTRAEGER" ? KATEGORIE_DATENTRAEGER : KATEGORIE_ARBEITSSPEICHER;

    // Suche über den Unique-Schlüssel (bezeichnung, kategorie, standortId).
    // Dadurch wird ein bestehender Artikel zuverlässig gefunden statt dupliziert.
    let artikel = await prisma.artikel.findFirst({
      where:  { bezeichnung, kategorie, standortId: input.standortId },
      select: { id: true, lagerplatz: true, preis: true },
    });

    const neuAngelegt = !artikel;

    if (!artikel) {
      artikel = await prisma.artikel.create({
        data: {
          bezeichnung, kategorie,
          standortId: input.standortId,
          bestand:    0,
          lagerplatz: z.lagerplatz?.trim() || null,
          preis:      z.preis ?? null,
        },
        select: { id: true, lagerplatz: true, preis: true },
      });
    } else {
      // Bestehenden Artikel nur dort ergänzen, wo bisher nichts stand — ein
      // gepflegter Preis oder Lagerplatz wird nicht überschrieben.
      const nachtrag: { lagerplatz?: string; preis?: number } = {};
      if (!artikel.lagerplatz && z.lagerplatz?.trim()) nachtrag.lagerplatz = z.lagerplatz.trim();
      if (artikel.preis == null && z.preis != null)    nachtrag.preis      = z.preis;
      if (Object.keys(nachtrag).length > 0) {
        artikel = await prisma.artikel.update({
          where: { id: artikel.id }, data: nachtrag,
          select: { id: true, lagerplatz: true, preis: true },
        });
      }
    }

    await bucheLager({
      artikelId:   artikel.id,
      menge:       z.menge,
      typ:         BuchungsTyp.EINGANG,
      mitarbeiter: input.mitarbeiter,
      notiz:       `Bestandserfassung ${kategorie}`,
      // herkunftArt bleibt bewusst leer: Die Riegel und Platten kommen karton-
      // weise zusammen, aus welchem Gerät der einzelne stammt, weiß niemand mehr.
      // „SPENDER" zu behaupten wäre geraten, und ein dritter Wert soll es nicht
      // geben (siehe HERKUNFT_ARTEN). Ohne LogID zählen sie ohnehin nicht in die
      // Ernte-Auswertung, die Kennzahl bleibt dadurch sauber.
    });

    const nachher = await prisma.artikel.findUnique({
      where: { id: artikel.id }, select: { bestand: true },
    });

    ergebnisse.push({
      bezeichnung, kategorie,
      menge:        z.menge,
      neuerBestand: nachher?.bestand ?? 0,
      neuAngelegt,
      lagerplatz:   artikel.lagerplatz,
    });
  }

  return ergebnisse;
}

/**
 * Wie ein Artikel / eine Buchung im Suchindex aussieht — EINE Stelle für den
 * Worker (Einzel- und Sammel-Sync) und `npm run reindex`.
 *
 * ⚠️ Vorher standen die Dokumente an drei Stellen je einmal ausformuliert und
 * waren auseinandergelaufen: `sync-buchung` schrieb kein `standortId`, der
 * Reindex schon. Die globale Suche filtert Buchungen nach `standortId` — eine
 * nach dem Reindex nachträglich synchronisierte Buchung fiel damit für jeden
 * Nutzer mit Standortbindung aus der Suche.
 */

export const ARTIKEL_SUCH_SELECT = {
  id: true, bezeichnung: true, kategorie: true, bestand: true, lagerplatz: true, standortId: true,
} as const;

export function artikelDokument(a: {
  id: number; bezeichnung: string; kategorie: string; bestand: number;
  lagerplatz: string | null; standortId: number;
}) {
  const teile = a.bezeichnung.trim().split(/\s+/);
  return {
    id:            a.id,
    bezeichnung:   a.bezeichnung,
    kategorie:     a.kategorie,
    bestand:       a.bestand,
    lagerplatz:    a.lagerplatz ?? null,
    standortId:    a.standortId,
    modell:        teile.length > 1 ? teile.slice(0, -1).join(" ") : a.bezeichnung,
    bestandStatus: a.bestand > 0 ? "vorhanden" : "leer",
  };
}

export const BUCHUNG_SUCH_SELECT = {
  id: true, typ: true, bezeichnung: true, menge: true, notiz: true, mitarbeiter: true, datum: true,
  artikel: { select: { kategorie: true, standortId: true } },
} as const;

export function buchungDokument(b: {
  id: number; typ: string; bezeichnung: string; menge: number; notiz: string | null;
  mitarbeiter: string; datum: Date;
  artikel: { kategorie: string; standortId: number } | null;
}) {
  return {
    id:                 b.id,
    typ:                b.typ,
    artikelBezeichnung: b.bezeichnung,
    menge:              b.menge,
    notiz:              b.notiz ?? null,
    ausgefuehrtVon:     b.mitarbeiter,
    artikelKategorie:   b.artikel?.kategorie ?? null,
    standortId:         b.artikel?.standortId ?? null,
    datum:              b.datum.getTime(),
  };
}

/** Die vier Indizes, die Lagernaut pflegt. */
export const SUCH_INDIZES = ["artikel", "modelle", "anfragen", "buchungen"] as const;
export type SuchIndex = (typeof SUCH_INDIZES)[number];

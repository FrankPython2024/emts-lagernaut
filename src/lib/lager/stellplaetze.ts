/**
 * Besondere Stellplätze im EMTS — was bedeutet der Platz?
 *
 * Übernommen aus Franks Übersicht vom 30.09.2026 (Stellplatz-Aushang). Die
 * Bedeutung erscheint überall, wo ein Stellplatz steht (Teilespender, Pickup,
 * Sortierhilfe), damit niemand „ETL-0-4-0" im Kopf übersetzen muss.
 *
 * ⚠️ ReForm zeigt die Plätze MIT Lagernummer („120-ETL-0-4-0", „123-Broker"),
 * Exporte und Lagernaut OHNE („ETL-0-4-0", „Broker") — gemessen am 30.09.2026 in
 * Verwertung, Lagerfuchs und Pickup. `normStellplatz` wirft die Lagernummer weg.
 *
 * Bewusst NICHT drin: „ETL-0-0-0" (2.668 Geräte im Lagerfuchs, 36 Spender) —
 * steht nicht auf dem Aushang. Erst eintragen, wenn geklärt ist, was er ist.
 * Ersatzteile mit LogID haben ihren Regalplatz → keine Sonderbedeutung.
 *
 * Reine Logik — Test in tests/ort.test.ts (`npm run test:ort`).
 */

export type StellplatzBedeutung = {
  /** Normalisierte Kennung ohne Lagernummer, z. B. „ETL-0-4-0" oder „BROKER". */
  code: string;
  /** Kurzform für enge Stellen (Knöpfe, Zeilen am Handgerät). */
  kurz: string;
  /** Wortlaut des Aushangs. */
  text: string;
  /** Liegt außerhalb des EMTS — Weg einplanen. */
  ausserhalb?: boolean;
};

export const BESONDERE_STELLPLAETZE: readonly StellplatzBedeutung[] = [
  { code: "ETL-0-1-0", kurz: "Gitterboxen",        text: "Gitterboxen (zerlegte Geräte, Headsets usw.)" },
  { code: "ETL-0-2-0", kurz: "Recycler i. B.",     text: "Notebook Recycler in Bearbeitung (Collis)" },
  { code: "ETL-0-3-0", kurz: "Broker i. B.",       text: "Notebook Broker in Bearbeitung (Collis)" },
  { code: "ETL-0-4-0", kurz: "Abholwagen / QS",    text: "EMTS-Abholwagen, Unterlagenschrank (Schrank 8) und QS Colli" },
  { code: "ETL-0-5-0", kurz: "Warentransfer",      text: "Warentransfer" },
  { code: "ETL-0-6-0", kurz: "Mobile H",           text: "Mobile H (Recycler)" },
  { code: "ETL-0-7-0", kurz: "Mobile R-B",         text: "Mobile R-B (Broker)" },
  { code: "ETL-0-8-0", kurz: "Wareneingang",       text: "Wareneingänge mit LogID (E-Mail an Wareneingang schreiben)" },
  { code: "ETL-0-9-0", kurz: "außerhalb EMTS",     text: "Lagerplätze außerhalb EMTS", ausserhalb: true },
  { code: "BROKER",    kurz: "Broker fertig",      text: "Broker-Geräte abgeschlossen (Collis)" },
  { code: "RECYCLER",  kurz: "Recycler fertig",    text: "Recycler-Geräte abgeschlossen (Collis)" },
];

const NACH_CODE = new Map(BESONDERE_STELLPLAETZE.map((b) => [b.code, b]));

/** „120-ETL-0-4-0" / „ etl-0-4-0 " / „123-Broker" → „ETL-0-4-0" / „BROKER". */
export function normStellplatz(stellplatz: string | null | undefined): string {
  return (stellplatz ?? "").trim().toUpperCase().replace(/\s+/g, "").replace(/^\d+-(?=[A-Z])/, "");
}

/** Bedeutung eines Stellplatzes laut Aushang, sonst null (normaler Regalplatz). */
export function stellplatzBedeutung(stellplatz: string | null | undefined): StellplatzBedeutung | null {
  return NACH_CODE.get(normStellplatz(stellplatz)) ?? null;
}

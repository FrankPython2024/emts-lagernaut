/**
 * Besondere Stellplätze im EMTS — was bedeutet der Platz?
 *
 * Die Liste liegt in der Datenbank (`StellplatzBedeutung`) und wird unter
 * /admin/stellplaetze gepflegt (Frank, 30.09.2026: „bei Bedarf ändern").
 * `STANDARD_STELLPLAETZE` ist nur die Erstbefüllung — übernommen aus Franks
 * Stellplatz-Aushang vom 30.09.2026. Die Bedeutung erscheint überall, wo ein
 * Stellplatz steht (Teilespender, Pickup, Sortierhilfe, Lagerfuchs), damit
 * niemand „ETL-0-4-0" im Kopf übersetzen muss.
 *
 * ⚠️ ReForm zeigt die Plätze MIT Lagernummer („120-ETL-0-4-0", „123-Broker"),
 * Exporte und Lagernaut OHNE („ETL-0-4-0", „Broker") — gemessen am 30.09.2026 in
 * Verwertung, Lagerfuchs und Pickup. `normStellplatz` wirft die Lagernummer weg;
 * gespeichert wird nur die normalisierte Form.
 *
 * „ETL-0-0-0" steht nicht auf dem Aushang: Altbestand aus der Zeit vor Lagernaut,
 * ohne feste Ordnung (Frank, 30.09.2026: „Freiwild") — 2.668 Geräte im Lagerfuchs.
 *
 * Reine Logik — Test in tests/ort.test.ts (`npm run test:ort`).
 */

export type StellplatzBedeutung = {
  /** Normalisierte Kennung ohne Lagernummer, z. B. „ETL-0-4-0" oder „BROKER". */
  code: string;
  /** Kurzform für enge Stellen (Knöpfe, Zeilen am Handgerät). */
  kurz: string;
  /** Beschreibung wie auf dem Aushang. */
  text: string;
  /** Liegt außerhalb des EMTS — wird hervorgehoben, Weg einplanen. */
  ausserhalb: boolean;
};

export const STANDARD_STELLPLAETZE: readonly StellplatzBedeutung[] = [
  { code: "ETL-0-0-0", kurz: "Altbestand",      text: "Altbestand aus der Zeit vor Lagernaut, ohne feste Ordnung (Freiwild)", ausserhalb: false },
  { code: "ETL-0-1-0", kurz: "Gitterboxen",     text: "Gitterboxen (zerlegte Geräte, Headsets usw.)", ausserhalb: false },
  { code: "ETL-0-2-0", kurz: "Recycler i. B.",  text: "Notebook Recycler in Bearbeitung (Collis)", ausserhalb: false },
  { code: "ETL-0-3-0", kurz: "Broker i. B.",    text: "Notebook Broker in Bearbeitung (Collis)", ausserhalb: false },
  { code: "ETL-0-4-0", kurz: "Abholwagen / QS", text: "EMTS-Abholwagen, Unterlagenschrank (Schrank 8) und QS Colli", ausserhalb: false },
  { code: "ETL-0-5-0", kurz: "Warentransfer",   text: "Warentransfer", ausserhalb: false },
  { code: "ETL-0-6-0", kurz: "Mobile H",        text: "Mobile H (Recycler)", ausserhalb: false },
  { code: "ETL-0-7-0", kurz: "Mobile R-B",      text: "Mobile R-B (Broker)", ausserhalb: false },
  { code: "ETL-0-8-0", kurz: "Wareneingang",    text: "Wareneingänge mit LogID (E-Mail an Wareneingang schreiben)", ausserhalb: false },
  { code: "ETL-0-9-0", kurz: "außerhalb EMTS",  text: "Lagerplätze außerhalb EMTS", ausserhalb: true },
  { code: "BROKER",    kurz: "Broker fertig",   text: "Broker-Geräte abgeschlossen (Collis)", ausserhalb: false },
  { code: "RECYCLER",  kurz: "Recycler fertig", text: "Recycler-Geräte abgeschlossen (Collis)", ausserhalb: false },
];

/** „120-ETL-0-4-0" / „ etl-0-4-0 " / „123-Broker" → „ETL-0-4-0" / „BROKER". */
export function normStellplatz(stellplatz: string | null | undefined): string {
  return (stellplatz ?? "").trim().toUpperCase().replace(/\s+/g, "").replace(/^\d+-(?=[A-Z])/, "");
}

/** Bedeutung eines Stellplatzes aus der gepflegten Liste, sonst null (normaler Regalplatz). */
export function findeBedeutung<T extends { code: string }>(
  liste: readonly T[] | null | undefined,
  stellplatz: string | null | undefined,
): T | null {
  const code = normStellplatz(stellplatz);
  if (!code || !liste) return null;
  return liste.find((b) => b.code === code) ?? null;
}

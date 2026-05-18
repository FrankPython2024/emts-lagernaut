import { BuchungsTyp } from "@prisma/client";

/**
 * HEILIGE REGEL: DIREKT-Buchungen dürfen NIEMALS den Bestand verändern.
 *
 * Sicherheitsgurt für alle Code-Pfade, die den Artikel-Bestand updaten.
 * Wirft einen Fehler wenn `typ === DIREKT` — macht versehentliche Bestand-Updates
 * für DIREKT-Buchungen unmöglich, auch bei zukünftigen Refactorings.
 *
 * Typische Nutzung:
 *   assertKeinBestandEffekt(buchungsTyp, "auslagern.teile");
 *   await tx.artikel.update({ data: { bestand: neuerBestand } });
 */
export function assertKeinBestandEffekt(typ: BuchungsTyp, kontext: string): void {
  if (typ === BuchungsTyp.DIREKT) {
    throw new Error(
      `HEILIGE REGEL VERLETZT: DIREKT-Buchung darf keinen Bestand-Effekt haben (${kontext})`,
    );
  }
}

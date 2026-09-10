// Teilespender-Suche — „Wo steckt mein Teil noch drin?"
//
// Beantwortet die Frage, für die bisher jemand durchs Lager gelaufen ist:
// Welches Verwertungsgerät hat das gesuchte Teil vermutlich noch, und wo steht
// es? Ergebnis ist eine Liste in Laufreihenfolge, aus der direkt ein
// Pickup-Auftrag entstehen kann.
//
// ⚠️ KEIN Bestandseffekt. Die Geräte hier zählen auf keinen Artikel ein.

import { prisma } from "@/core/db/prisma";
import { zerlegeGeraetename, schildSchluessel } from "@/lib/geraete/schildName";
import { normalizeLogId, formatLogId } from "@/lib/pickup/logId";
import {
  zerlegeDefekte,
  bewerte,
  zustandFuerTeiltyp,
  type TeilZustand,
} from "@/lib/teilespender/defekte";

/** Wie sicher ist der Treffer? Bewusst zwei Stufen statt einer Zusage. */
export type Sicherheit =
  /** Kein Defekt an diesem Teil vermerkt. Kandidat, keine Garantie. */
  | "KEIN_DEFEKT_VERMERKT"
  /** Teil funktioniert vermutlich, hat aber Gebrauchsspuren. */
  | "GEBRAUCHTSPUREN";

export type SpenderTreffer = {
  logId: string;
  bezeichnung: string | null;
  hersteller: string | null;
  zustand: string | null;
  stellplatz: string | null;
  colli: string | null;
  lager: string | null;
  /** Alle in ReForm vermerkten Defekte des Geräts, im Original-Wortlaut. */
  defekte: string[];
  /** Defekt-Begriffe, die unsere Zuordnungstabelle nicht kennt. */
  unbekannteDefekte: string[];
  sicherheit: Sicherheit;
  verweildauerTage: number | null;
};

export type SpenderSuchErgebnis = {
  modellKey: string;
  teiltyp: string;
  treffer: SpenderTreffer[];
  /** Wie sich die Liste zusammensetzt — damit die Zahl nachvollziehbar bleibt. */
  aussortiert: {
    /** Modell stimmt, aber das Gerät ist nicht zur Verwertung freigegeben. */
    nichtFreigegeben: number;
    /** Genau dieses Teil ist laut ReForm defekt oder fehlt. */
    teilDefekt: number;
    /** Ganzes Gerät ist Totalschaden / ausgeschlachtet. */
    totalschaden: number;
    /** Teil wurde bereits entnommen (gebucht oder von Hand abgehakt). */
    bereitsEntnommen: number;
  };
};

/** Normalisiert einen Gerätenamen zum Suchschlüssel. */
export function modellSchluessel(geraeteName: string, hersteller?: string | null): string {
  return schildSchluessel(zerlegeGeraetename(geraeteName ?? "", hersteller));
}

/**
 * Welche Teiltypen sind aus diesen Geräten bereits heraus?
 *
 * Zwei Quellen, bewusst zusammengeführt:
 *
 *  1. **Automatisch** aus `Buchung`: Wer ein Teil über den Einlager-Assistenten
 *     bucht, setzt `herkunftLogId` + `herkunftArt = "SPENDER"`; der Teiltyp ist
 *     `Artikel.kategorie`. Niemand muss zusätzlich etwas abhaken — und genau
 *     deshalb stimmt es auch. In der Produktion am 09.09.2026 gemessen: 77
 *     Ernte-Buchungen, alle Kategorien exakt Teiltyp-Namen.
 *
 *  2. **Von Hand** aus `VerwertungsEntnahme`: für alles, was dort nicht
 *     ankommt — Karton auf und das Teil war schon weg, oder vor Lagernaut
 *     ausgebaut.
 *
 * Ergebnis: logId → Menge der Teiltypen, die nicht mehr zu holen sind.
 */
export async function entnommeneTeile(logIds: string[]): Promise<Map<string, Set<string>>> {
  const raus = new Map<string, Set<string>>();
  if (logIds.length === 0) return raus;

  function merke(logId: string, teiltyp: string): void {
    const s = raus.get(logId) ?? new Set<string>();
    s.add(teiltyp);
    raus.set(logId, s);
  }

  // ⚠️ Beide Schreibweisen abfragen. Der Export schreibt „213.215.911", ein
  // Scanner kann „213215911" liefern. Gemessen am 09.09.2026 sind alle 77
  // vorhandenen Ernte-Buchungen punktiert — aber wenn sich das je ändert, würde
  // die Entnahme-Erkennung still aufhören zu greifen, und jemand liefe ein
  // zweites Mal zu einem Karton, aus dem das Teil längst heraus ist.
  const nurZiffern = new Map<string, string>();
  for (const id of logIds) nurZiffern.set(id.replace(/\D/g, ""), id);
  const suchIds = [...new Set([...logIds, ...nurZiffern.keys()])];

  const [gebucht, handisch] = await Promise.all([
    prisma.buchung.findMany({
      where: { herkunftLogId: { in: suchIds }, herkunftArt: "SPENDER" },
      select: { herkunftLogId: true, artikel: { select: { kategorie: true } } },
    }),
    prisma.verwertungsEntnahme.findMany({
      where: { logId: { in: logIds } },
      select: { logId: true, teiltyp: true },
    }),
  ]);

  for (const b of gebucht) {
    if (!b.herkunftLogId || !b.artikel?.kategorie) continue;
    // Auf die Schreibweise der Verwertungstabelle zurückführen.
    const treffer = nurZiffern.get(b.herkunftLogId.replace(/\D/g, "")) ?? b.herkunftLogId;
    merke(treffer, b.artikel.kategorie);
  }
  for (const h of handisch) merke(h.logId, h.teiltyp);

  return raus;
}

/** Laufreihenfolge: erst das Regal, dann der Karton, dann die LogID. */
function nachLaufweg(a: SpenderTreffer, b: SpenderTreffer): number {
  const s = (a.stellplatz ?? "").localeCompare(b.stellplatz ?? "", "de", { numeric: true });
  if (s !== 0) return s;
  const c = (a.colli ?? "").localeCompare(b.colli ?? "", "de", { numeric: true });
  return c !== 0 ? c : a.logId.localeCompare(b.logId, "de", { numeric: true });
}

/**
 * Sucht Spendergeräte für ein Modell und einen Teiltyp.
 *
 * ⚠️ „Kein Defekt vermerkt" ist ein Negativbeleg, keine Prüfung. Die Liste
 * grenzt den Suchraum von tausenden Geräten auf eine Handvoll mit Fundort ein —
 * sie ersetzt nicht das Nachsehen. Die Oberfläche muss das genauso sagen.
 */
export async function sucheSpender(args: {
  geraeteName?: string;
  modellKey?: string;
  hersteller?: string | null;
  teiltyp: string;
  limit?: number;
}): Promise<SpenderSuchErgebnis> {
  const key = args.modellKey ?? modellSchluessel(args.geraeteName ?? "", args.hersteller);
  const leer: SpenderSuchErgebnis = {
    modellKey: key,
    teiltyp: args.teiltyp,
    treffer: [],
    aussortiert: { nichtFreigegeben: 0, teilDefekt: 0, totalschaden: 0, bereitsEntnommen: 0 },
  };
  if (!key) return leer;

  // Bewusst OHNE verwertungFrei-Filter laden, damit die Oberfläche sagen kann,
  // wie viele Geräte des Modells es gäbe — und warum sie nicht dabei sind.
  const geraete = await prisma.verwertungsGeraet.findMany({
    where: { modellKey: key, ausgeschieden: false },
    select: {
      logId: true, bezeichnung: true, hersteller: true, zustand: true,
      stellplatz: true, colli: true, lager: true, defekteRoh: true,
      verwertungFrei: true, verweildauerTage: true,
    },
  });
  if (geraete.length === 0) return leer;

  const entnommen = await entnommeneTeile(geraete.map((g) => g.logId));

  const aussortiert = { nichtFreigegeben: 0, teilDefekt: 0, totalschaden: 0, bereitsEntnommen: 0 };
  const treffer: SpenderTreffer[] = [];

  for (const g of geraete) {
    const defekte = zerlegeDefekte(g.defekteRoh);
    const zustand: TeilZustand = zustandFuerTeiltyp(defekte, args.teiltyp);

    // Reihenfolge der Prüfungen bestimmt, was in der Aufschlüsselung steht.
    // Totalschaden zuerst, weil er die eindeutigste Aussage ist.
    if (zustand === "TOTAL") { aussortiert.totalschaden++; continue; }
    if (zustand === "DEFEKT") { aussortiert.teilDefekt++; continue; }
    if (!g.verwertungFrei) { aussortiert.nichtFreigegeben++; continue; }
    if (entnommen.get(g.logId)?.has(args.teiltyp)) { aussortiert.bereitsEntnommen++; continue; }

    treffer.push({
      logId: g.logId,
      bezeichnung: g.bezeichnung,
      hersteller: g.hersteller,
      zustand: g.zustand,
      stellplatz: g.stellplatz,
      colli: g.colli,
      lager: g.lager,
      defekte,
      unbekannteDefekte: defekte.filter((d) => bewerte(d).unbekannt),
      sicherheit: zustand === "KOSMETISCH" ? "GEBRAUCHTSPUREN" : "KEIN_DEFEKT_VERMERKT",
      verweildauerTage: g.verweildauerTage,
    });
  }

  treffer.sort(nachLaufweg);
  return {
    modellKey: key,
    teiltyp: args.teiltyp,
    treffer: args.limit ? treffer.slice(0, args.limit) : treffer,
    aussortiert,
  };
}

/**
 * Welche Modelle gibt es überhaupt als Spender? Für die Auswahl auf der Seite.
 *
 * Liefert je Modell einen lesbaren Namen und die Anzahl freigegebener Geräte.
 */
export async function spenderModelle(suche?: string): Promise<
  { modellKey: string; name: string; hersteller: string | null; anzahl: number }[]
> {
  const gruppen = await prisma.verwertungsGeraet.groupBy({
    by: ["modellKey"],
    where: { ausgeschieden: false, verwertungFrei: true },
    _count: { _all: true },
  });
  const keys = gruppen.map((g) => g.modellKey);
  if (keys.length === 0) return [];

  // Je Schlüssel einen Beispielnamen holen (der Schlüssel selbst ist unlesbar).
  const beispiele = await prisma.verwertungsGeraet.findMany({
    where: { modellKey: { in: keys }, ausgeschieden: false, verwertungFrei: true },
    select: { modellKey: true, bezeichnung: true, hersteller: true },
    distinct: ["modellKey"],
  });
  const nameFuer = new Map(beispiele.map((b) => [b.modellKey, b]));

  const begriff = (suche ?? "").trim().toLowerCase();
  return gruppen
    .map((g) => {
      const b = nameFuer.get(g.modellKey);
      const zerlegt = zerlegeGeraetename(b?.bezeichnung ?? "", b?.hersteller);
      const name = [zerlegt.hersteller, zerlegt.serie, zerlegt.modell, zerlegt.zusatz]
        .filter((t) => t && t.length > 0)
        .join(" ");
      return {
        modellKey: g.modellKey,
        name: name || (b?.bezeichnung ?? g.modellKey),
        hersteller: b?.hersteller ?? null,
        anzahl: g._count._all,
      };
    })
    .filter((m) => begriff === "" || m.name.toLowerCase().includes(begriff))
    .sort((a, b) => b.anzahl - a.anzahl || a.name.localeCompare(b.name, "de"));
}

/**
 * Was steckt in DIESEM Gerät noch drin? Rückwärtssuche über die LogID.
 *
 * Nützlich, wenn jemand ein Gerät in der Hand hat und wissen will, was sich
 * lohnt auszubauen.
 */
export async function geraeteAkte(logIdRoh: string): Promise<{
  geraet: {
    logId: string; bezeichnung: string | null; hersteller: string | null;
    zustand: string | null; stellplatz: string | null; colli: string | null;
    verwertungFrei: boolean; defekte: string[]; bemerkung: string | null;
  };
  teile: { teiltyp: string; zustand: TeilZustand; entnommen: boolean }[];
} | null> {
  const eingabe = logIdRoh.trim();
  if (!eingabe) return null;

  // Der Schlüssel steht punktiert in der Tabelle (so kommt er aus ReForm), im
  // Lager wird aber auch ohne Punkte getippt und gescannt. Beides muss finden.
  const ziffern = normalizeLogId(eingabe);
  const g =
    (await prisma.verwertungsGeraet.findUnique({ where: { logId: eingabe } })) ??
    (ziffern ? await prisma.verwertungsGeraet.findUnique({ where: { logId: formatLogId(ziffern) } }) : null);
  if (!g) return null;
  const logId = g.logId;

  const defekte = zerlegeDefekte(g.defekteRoh);
  const raus = (await entnommeneTeile([logId])).get(logId) ?? new Set<string>();

  const teiltypen = await prisma.teiltyp.findMany({
    where: { aktiv: true },
    select: { name: true },
    orderBy: { sortierung: "asc" },
  });

  return {
    geraet: {
      logId: g.logId,
      bezeichnung: g.bezeichnung,
      hersteller: g.hersteller,
      zustand: g.zustand,
      stellplatz: g.stellplatz,
      colli: g.colli,
      verwertungFrei: g.verwertungFrei,
      defekte,
      bemerkung: g.bemerkung,
    },
    teile: teiltypen.map((t) => ({
      teiltyp: t.name,
      zustand: zustandFuerTeiltyp(defekte, t.name),
      entnommen: raus.has(t.name),
    })),
  };
}

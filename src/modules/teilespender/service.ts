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

/** Ein Spender-Kurzhinweis, wie er neben einer Anfrage steht. */
export type SpenderHinweis = {
  /** Wie viele Geräte kämen in Frage? */
  anzahl: number;
  /** Die ersten paar davon, in Laufreihenfolge — für die Vorschau in der Liste. */
  vorschau: {
    logId: string;
    stellplatz: string | null;
    colli: string | null;
    sicherheit: Sicherheit;
  }[];
  /** Der aufgelöste Gerätename, mit dem gesucht wurde (für den Link). */
  geraeteName: string;
  teiltyp: string;
};

/**
 * Für mehrere Anfragen auf einmal: Steckt das gesuchte Teil noch in einem
 * Verwertungsgerät?
 *
 * ⚠️ Bewusst als EIN Zug über alle Anfragen gebaut, nicht als Schleife über
 * `sucheSpender`. Die Anfragenliste zeigt regelmäßig 50+ Zeilen; je Zeile eine
 * eigene Abfrage wären hunderte Rundreisen zur Datenbank, und die Seite lädt
 * ohnehin alle fünf Sekunden neu.
 */
export async function hinweiseFuerAnfragen(
  anfrageIds: number[],
): Promise<Record<number, SpenderHinweis>> {
  if (anfrageIds.length === 0) return {};

  const anfragen = await prisma.anfrage.findMany({
    where: { id: { in: anfrageIds }, istSonderAnfrage: false },
    select: { id: true, geraeteName: true, geraet: true, teil: true },
  });
  if (anfragen.length === 0) return {};

  // Name → Schlüssel einmal je verschiedenem Namen berechnen.
  const nameFuer = new Map<number, string>();
  const keyFuer = new Map<number, string>();
  const keyCache = new Map<string, string>();
  for (const a of anfragen) {
    const name = (a.geraeteName ?? a.geraet ?? "").trim();
    if (!name) continue;
    let key = keyCache.get(name);
    if (key === undefined) {
      key = modellSchluessel(name);
      keyCache.set(name, key);
    }
    if (!key) continue;
    nameFuer.set(a.id, name);
    keyFuer.set(a.id, key);
  }

  const keys = [...new Set(keyFuer.values())];
  if (keys.length === 0) return {};

  const geraete = await prisma.verwertungsGeraet.findMany({
    where: { modellKey: { in: keys }, ausgeschieden: false, verwertungFrei: true },
    select: {
      logId: true, modellKey: true, stellplatz: true, colli: true, defekteRoh: true,
    },
  });
  if (geraete.length === 0) return {};

  const entnommen = await entnommeneTeile(geraete.map((g) => g.logId));

  // Nach Modellschlüssel bündeln, damit je Anfrage nur noch gefiltert wird.
  const proKey = new Map<string, typeof geraete>();
  for (const g of geraete) {
    const a = proKey.get(g.modellKey) ?? [];
    a.push(g);
    proKey.set(g.modellKey, a);
  }

  const raus: Record<number, SpenderHinweis> = {};
  for (const a of anfragen) {
    const key = keyFuer.get(a.id);
    const name = nameFuer.get(a.id);
    if (!key || !name) continue;

    const passend: SpenderTreffer[] = [];
    for (const g of proKey.get(key) ?? []) {
      const defekte = zerlegeDefekte(g.defekteRoh);
      const zustand = zustandFuerTeiltyp(defekte, a.teil);
      if (zustand !== "FREI" && zustand !== "KOSMETISCH") continue;
      if (entnommen.get(g.logId)?.has(a.teil)) continue;
      passend.push({
        logId: g.logId,
        bezeichnung: null,
        hersteller: null,
        zustand: null,
        stellplatz: g.stellplatz,
        colli: g.colli,
        lager: null,
        defekte,
        unbekannteDefekte: [],
        sicherheit: zustand === "KOSMETISCH" ? "GEBRAUCHTSPUREN" : "KEIN_DEFEKT_VERMERKT",
        verweildauerTage: null,
      });
    }
    if (passend.length === 0) continue;

    passend.sort(nachLaufweg);
    raus[a.id] = {
      anzahl: passend.length,
      vorschau: passend.slice(0, 3).map((t) => ({
        logId: t.logId,
        stellplatz: t.stellplatz,
        colli: t.colli,
        sicherheit: t.sicherheit,
      })),
      geraeteName: name,
      teiltyp: a.teil,
    };
  }
  return raus;
}

export type GruppenSpender = {
  logId: string;
  bezeichnung: string | null;
  stellplatz: string | null;
  colli: string | null;
  zustand: string | null;
  /** Welche der angefragten Teiltypen dieses Gerät vermutlich noch hat. */
  deckt: string[];
  /** Davon die, bei denen Gebrauchsspuren vermerkt sind. */
  mitSpuren: string[];
  /** Alle vermerkten Defekte des Geräts, im Original-Wortlaut. */
  defekte: string[];
};

export type GruppenErgebnis = {
  geraeteName: string;
  /** Die angefragten Teiltypen, in der Reihenfolge der Anfrage. */
  teiltypen: string[];
  /** Wie viele Spender es je Teiltyp gibt — auch 0, damit Lücken sichtbar sind. */
  proTeiltyp: { teiltyp: string; anzahl: number }[];
  /** Geräte, nach Abdeckung sortiert: das ergiebigste zuerst. */
  geraete: GruppenSpender[];
};

/**
 * Alle Teile EINER Anfrage-Gruppe auf einmal.
 *
 * Der eigentliche Zeitgewinn steckt hier: Ein Techniker fragt für dasselbe
 * Notebook oft Tastatur, Touchpad und D-Cover zusammen an — und ein einziges
 * Spendergerät desselben Modells hat meist alle drei. Wer stattdessen je Teil
 * sucht, läuft dreimal los.
 *
 * Deshalb ist die Liste nach **Abdeckung** sortiert, nicht nach Laufweg: Das
 * Gerät, das die meisten offenen Teile erschlägt, steht oben. Bei gleicher
 * Abdeckung entscheidet der Laufweg.
 */
export async function spenderFuerGruppe(args: {
  geraeteName: string;
  teiltypen: string[];
}): Promise<GruppenErgebnis> {
  const teiltypen = [...new Set(args.teiltypen.filter((t) => t.trim().length > 0))];
  const leer: GruppenErgebnis = {
    geraeteName: args.geraeteName,
    teiltypen,
    proTeiltyp: teiltypen.map((t) => ({ teiltyp: t, anzahl: 0 })),
    geraete: [],
  };

  const key = modellSchluessel(args.geraeteName);
  if (!key || teiltypen.length === 0) return leer;

  const geraete = await prisma.verwertungsGeraet.findMany({
    where: { modellKey: key, ausgeschieden: false, verwertungFrei: true },
    select: {
      logId: true, bezeichnung: true, stellplatz: true, colli: true,
      zustand: true, defekteRoh: true,
    },
  });
  if (geraete.length === 0) return leer;

  const entnommen = await entnommeneTeile(geraete.map((g) => g.logId));

  const treffer: GruppenSpender[] = [];
  const zaehler = new Map<string, number>(teiltypen.map((t) => [t, 0]));

  for (const g of geraete) {
    const defekte = zerlegeDefekte(g.defekteRoh);
    const raus = entnommen.get(g.logId);
    const deckt: string[] = [];
    const mitSpuren: string[] = [];

    for (const t of teiltypen) {
      if (raus?.has(t)) continue;
      const z = zustandFuerTeiltyp(defekte, t);
      if (z !== "FREI" && z !== "KOSMETISCH") continue;
      deckt.push(t);
      if (z === "KOSMETISCH") mitSpuren.push(t);
      zaehler.set(t, (zaehler.get(t) ?? 0) + 1);
    }

    if (deckt.length === 0) continue;
    treffer.push({
      logId: g.logId,
      bezeichnung: g.bezeichnung,
      stellplatz: g.stellplatz,
      colli: g.colli,
      zustand: g.zustand,
      deckt,
      mitSpuren,
      defekte,
    });
  }

  treffer.sort((a, b) => {
    if (b.deckt.length !== a.deckt.length) return b.deckt.length - a.deckt.length;
    // Bei gleicher Abdeckung das nehmen, das weniger Gebrauchsspuren hat …
    if (a.mitSpuren.length !== b.mitSpuren.length) return a.mitSpuren.length - b.mitSpuren.length;
    // … und erst dann nach Laufweg.
    const s = (a.stellplatz ?? "").localeCompare(b.stellplatz ?? "", "de", { numeric: true });
    if (s !== 0) return s;
    const c = (a.colli ?? "").localeCompare(b.colli ?? "", "de", { numeric: true });
    return c !== 0 ? c : a.logId.localeCompare(b.logId, "de", { numeric: true });
  });

  return {
    geraeteName: args.geraeteName,
    teiltypen,
    proTeiltyp: teiltypen.map((t) => ({ teiltyp: t, anzahl: zaehler.get(t) ?? 0 })),
    geraete: treffer,
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

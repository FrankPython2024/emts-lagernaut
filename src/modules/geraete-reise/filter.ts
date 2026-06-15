import { Prisma } from "@prisma/client";

// Geräte-Reise — zentrale Filterlogik für die Geräte-Liste. Wird von der
// tRPC-Procedure geraeteListe UND vom Export-Endpoint genutzt, damit beide
// exakt dieselbe Treffermenge liefern. Reine Auswertung, kein Bestandseffekt.

export type GeraeteListeFilter = {
  verbleib?:        string;
  stellplatz?:      string;  // exakt
  stellplatzPrefix?: string; // stellplatz startsWith (LIKE 'X%', nutzt den Index)
  stellplatzContains?: string; // stellplatz enthält (LIKE '%X%', case-insensitive via MySQL-Collation)
  stellplaetze?:    string[]; // stellplatz IN (...) — für die Mehrfachauswahl (Warenkorb)
  bereich?:         string;  // Stellplatz-Bereich: stellplatz == bereich ODER startsWith "bereich-"
  geraeteart?:      string;
  hersteller?:      string;
  lager?:           string;
  lagernummer?:     string;
  ohneVerbleib?:    boolean;
  alterVon?:        number;  // verweildauerTage >= alterVon
  alterBis?:        number;  // verweildauerTage <= alterBis
  ausgeschieden?:   boolean; // Default false = nur „noch im System"
};

// Stellplatz-Bereich = führende, per Bindestrich getrennte Segmente bis VOR das
// erste rein-numerische Segment. Beispiele:
//   "WE-0-0-0" → "WE" · "ETL-HL-4-2-1" → "ETL-HL" · "Vor-Rei-1-AV" → "Vor-Rei"
//   "HL-01-13-01" → "HL" · "MDR-ETL" → "MDR-ETL" · "Recycler" → "Recycler"
// Gibt es kein numerisches Segment, ist der ganze String der Bereich.
export function stellplatzBereich(stellplatz: string): string {
  const fuehrend: string[] = [];
  for (const seg of stellplatz.split("-")) {
    if (/^\d+$/.test(seg)) break;
    fuehrend.push(seg);
  }
  return fuehrend.length > 0 ? fuehrend.join("-") : stellplatz;
}

// Intelligentes Freitext-Parsing für die Stellplatz-Suche.
//   "120-ETL-0-0-0" → { lagernummer: "120", stellplatzContains: "ETL-0-0-0" }
//   "123-Broker"    → { lagernummer: "123", stellplatzContains: "Broker" }
//   "ETL", "Broker", "ETL-0-0-0" → { stellplatzContains: <text> }
// Eine so erkannte Lagernummer hat Vorrang vor dem optionalen Dropdown.
export function parseStellplatzSuche(text: string): { lagernummer?: string; stellplatzContains: string } {
  const t = text.trim();
  const m = t.match(/^\s*(\d+)\s*-\s*(.+)$/);
  if (m) return { lagernummer: m[1], stellplatzContains: m[2]!.trim() };
  return { stellplatzContains: t };
}

// Baut die where-Klausel: alle gesetzten Filter UND-verknüpft.
// Alters-Range filtert über verweildauerTage (NULL fällt dabei automatisch raus).
// ausgeschieden wird IMMER gefiltert (Default false = nur Geräte im System).
export function buildGeraeteWhere(f: GeraeteListeFilter): Prisma.LogIdStandWhereInput {
  const and: Prisma.LogIdStandWhereInput[] = [];

  and.push({ ausgeschieden: f.ausgeschieden ?? false });

  if (f.ohneVerbleib)      and.push({ OR: [{ verbleib: null }, { verbleib: "" }] });
  else if (f.verbleib)     and.push({ verbleib: f.verbleib });
  if (f.stellplatz)        and.push({ stellplatz: f.stellplatz });
  // Präfix nutzt LIKE 'X%' → der stellplatz-Index greift. MySQL-Default-Collation
  // ist case-insensitiv, daher kein mode:"insensitive" nötig (auf MySQL ohnehin n/a).
  if (f.stellplatzPrefix)  and.push({ stellplatz: { startsWith: f.stellplatzPrefix } });
  if (f.stellplatzContains) and.push({ stellplatz: { contains: f.stellplatzContains } });
  // Mehrfachauswahl (Warenkorb): genau diese Stellplätze.
  if (f.stellplaetze && f.stellplaetze.length > 0) and.push({ stellplatz: { in: f.stellplaetze } });
  // Bereich = exakter Treffer ODER beginnt mit "bereich-" (grenzt „WE" sauber
  // gegen „WED" ab, im Gegensatz zum reinen Präfix).
  if (f.bereich)           and.push({ OR: [{ stellplatz: f.bereich }, { stellplatz: { startsWith: `${f.bereich}-` } }] });
  if (f.geraeteart)        and.push({ geraeteart: f.geraeteart });
  if (f.hersteller)        and.push({ hersteller: f.hersteller });
  if (f.lager)             and.push({ lager: f.lager });
  if (f.lagernummer)       and.push({ lagernummer: f.lagernummer });

  if (f.alterVon != null || f.alterBis != null) {
    const vd: Prisma.IntNullableFilter = {};
    if (f.alterVon != null) vd.gte = f.alterVon;
    if (f.alterBis != null) vd.lte = f.alterBis;
    and.push({ verweildauerTage: vd });
  }

  return and.length ? { AND: and } : {};
}

// ── Query-Param-Parser (für den Export-Endpoint / Pages-API) ────────────────────

type QueryVal = string | string[] | undefined;

function qstr(v: QueryVal): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  const t = s?.trim();
  return t ? t : undefined;
}
function qnum(v: QueryVal): number | undefined {
  const s = qstr(v);
  if (s === undefined) return undefined;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? undefined : n;
}
// Mehrfach-Query-Param (?stellplaetze=A&stellplaetze=B) → string[].
function qarr(v: QueryVal): string[] | undefined {
  if (v === undefined) return undefined;
  const arr = (Array.isArray(v) ? v : [v]).map((s) => s.trim()).filter(Boolean);
  return arr.length ? arr : undefined;
}

export function filterFromQuery(q: Partial<Record<string, string | string[]>>): GeraeteListeFilter {
  return {
    verbleib:           qstr(q.verbleib),
    stellplatz:         qstr(q.stellplatz),
    stellplatzPrefix:   qstr(q.stellplatzPrefix),
    stellplatzContains: qstr(q.stellplatzContains),
    stellplaetze:       qarr(q.stellplaetze),
    bereich:            qstr(q.bereich),
    geraeteart:         qstr(q.geraeteart),
    hersteller:       qstr(q.hersteller),
    lager:            qstr(q.lager),
    lagernummer:      qstr(q.lagernummer),
    ohneVerbleib:     qstr(q.ohneVerbleib) === "1",
    alterVon:         qnum(q.alterVon),
    alterBis:         qnum(q.alterBis),
    ausgeschieden:    qstr(q.ausgeschieden) === "1",
  };
}

import { Prisma } from "@prisma/client";

// Fehlteile — zentrale Filterlogik. Wird von der tRPC-Procedure fehlteile.liste
// UND vom Export-Endpoint genutzt, damit beide exakt dieselbe Treffermenge
// liefern. Reine Auswertung, kein Bestandseffekt.

export type FehlteilFilter = {
  suche?:           string; // Teiltreffer auf logId / seriennummer / bezeichnung (case-insensitiv)
  geraeteart?:      string;
  hersteller?:      string;
  sortiment?:       string;
  inVerbleibDurch?: string;
  seitVon?:         string; // YYYY-MM-DD (inVerbleibSeit >=)
  seitBis?:         string; // YYYY-MM-DD (inVerbleibSeit <= Tagesende)
};

// Tag-String (YYYY-MM-DD) → Date. endeDesTages=true → 23:59:59.999 (inklusiv).
function parseTag(s: string | undefined, endeDesTages: boolean): Date | undefined {
  if (!s) return undefined;
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  const [, y, mo, d] = m;
  return endeDesTages
    ? new Date(Number(y), Number(mo) - 1, Number(d), 23, 59, 59, 999)
    : new Date(Number(y), Number(mo) - 1, Number(d), 0, 0, 0, 0);
}

// Baut die where-Klausel: alle gesetzten Filter UND-verknüpft. MySQL-Default-
// Collation ist case-insensitiv → `contains` matcht ohne mode:"insensitive".
export function buildFehlteilWhere(f: FehlteilFilter): Prisma.FehlteilStandWhereInput {
  const and: Prisma.FehlteilStandWhereInput[] = [];

  if (f.suche) {
    and.push({
      OR: [
        { logId:        { contains: f.suche } },
        { seriennummer: { contains: f.suche } },
        { bezeichnung:  { contains: f.suche } },
      ],
    });
  }
  if (f.geraeteart)      and.push({ geraeteart: f.geraeteart });
  if (f.hersteller)      and.push({ hersteller: f.hersteller });
  if (f.sortiment)       and.push({ sortiment: f.sortiment });
  if (f.inVerbleibDurch) and.push({ inVerbleibDurch: f.inVerbleibDurch });

  const von = parseTag(f.seitVon, false);
  const bis = parseTag(f.seitBis, true);
  if (von || bis) {
    const d: Prisma.DateTimeNullableFilter = {};
    if (von) d.gte = von;
    if (bis) d.lte = bis;
    and.push({ inVerbleibSeit: d });
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

export function filterFromQuery(q: Partial<Record<string, string | string[]>>): FehlteilFilter {
  return {
    suche:           qstr(q.suche),
    geraeteart:      qstr(q.geraeteart),
    hersteller:      qstr(q.hersteller),
    sortiment:       qstr(q.sortiment),
    inVerbleibDurch: qstr(q.inVerbleibDurch),
    seitVon:         qstr(q.seitVon),
    seitBis:         qstr(q.seitBis),
  };
}

import { createTRPCRouter, adminProcedure } from "@/server/trpc";
import { prisma }       from "@/core/db/prisma";
import { meilisearch }  from "@/core/infra/meilisearch";
import { redis }        from "@/core/infra/redis";
import { AnfrageStatus, BuchungsTyp } from "@prisma/client";

// ── Hilfe ─────────────────────────────────────────────────────────────────────

function heuteRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── Router ────────────────────────────────────────────────────────────────────

export const dashboardRouter = createTRPCRouter({

  // 1 — KPI-Zahlen
  stats: adminProcedure.query(async () => {
    const { start, end } = heuteRange();
    const [aktiveAnfragen, offeneBedarf, artikelImBestand, auslagerungenHeute] =
      await Promise.all([
        prisma.anfrage.count({ where: { status: { in: [AnfrageStatus.NEU, AnfrageStatus.IN_BEARBEITUNG] } } }),
        prisma.anfrage.count({ where: { status: AnfrageStatus.BEDARF } }),
        prisma.artikel.count({ where: { bestand: { gt: 0 } } }),
        prisma.buchung.count({
          where: { datum: { gte: start, lt: end }, typ: { in: [BuchungsTyp.AUSGANG, BuchungsTyp.DIREKT] } },
        }),
      ]);
    return { aktiveAnfragen, offeneBedarf, artikelImBestand, auslagerungenHeute };
  }),

  // 2 — Anfragen-Status-Verteilung
  anfragenStatusVerteilung: adminProcedure.query(async () => {
    const grouped = await prisma.anfrage.groupBy({
      by: ["status"], _count: { status: true },
    });
    const m = new Map(grouped.map(g => [g.status, g._count.status]));
    return [
      { status: "NEU",            anzahl: m.get("NEU")            ?? 0, farbe: "#008BD2" },
      { status: "BEDARF",         anzahl: m.get("BEDARF")         ?? 0, farbe: "#F59E0B" },
      { status: "IN_BEARBEITUNG", anzahl: m.get("IN_BEARBEITUNG") ?? 0, farbe: "#202F61" },
      { status: "ABGESCHLOSSEN",  anzahl: m.get("ABGESCHLOSSEN")  ?? 0, farbe: "#04B475" },
      { status: "STORNIERT",      anzahl: m.get("STORNIERT")      ?? 0, farbe: "#94A3B8" },
    ];
  }),

  // 3 — Auslagerungs-Trend (letzte 30 Tage)
  auslagerungsTrend: adminProcedure.query(async () => {
    const von = daysAgo(30);
    const buchungen = await prisma.buchung.findMany({
      where: { datum: { gte: von }, typ: { in: [BuchungsTyp.AUSGANG, BuchungsTyp.DIREKT] } },
      select: { datum: true, typ: true },
      orderBy: { datum: "asc" },
    });

    const byDate = new Map<string, { ausgang: number; direkt: number }>();
    for (const b of buchungen) {
      const d = b.datum.toISOString().slice(0, 10);
      if (!byDate.has(d)) byDate.set(d, { ausgang: 0, direkt: 0 });
      const e = byDate.get(d)!;
      if (b.typ === BuchungsTyp.AUSGANG) e.ausgang++; else e.direkt++;
    }

    return Array.from({ length: 30 }, (_, i) => {
      const d = new Date(von);
      d.setDate(von.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      return { datum: key, ...(byDate.get(key) ?? { ausgang: 0, direkt: 0 }) };
    });
  }),

  // 4 — Top Teiltypen (letzte 30 Tage, abgeschlossene Anfragen)
  topTeiltypen: adminProcedure.query(async () => {
    const von = daysAgo(30);
    const grouped = await prisma.anfrage.groupBy({
      by: ["teil"],
      where: { datum: { gte: von }, status: AnfrageStatus.ABGESCHLOSSEN },
      _count: { teil: true },
      orderBy: { _count: { teil: "desc" } },
      take: 10,
    });
    return grouped.map(g => ({ teiltyp: g.teil, anzahl: g._count.teil }));
  }),

  // 5 — Techniker-Aktivität (letzte 7 Tage)
  technikerAktivitaet: adminProcedure.query(async () => {
    const von = daysAgo(7);
    const [alle, abg] = await Promise.all([
      prisma.anfrage.groupBy({
        by: ["techniker"], where: { datum: { gte: von } },
        _count: { techniker: true }, orderBy: { _count: { techniker: "desc" } }, take: 10,
      }),
      prisma.anfrage.groupBy({
        by: ["techniker"], where: { datum: { gte: von }, status: AnfrageStatus.ABGESCHLOSSEN },
        _count: { techniker: true },
      }),
    ]);
    const abgMap = new Map(abg.map(a => [a.techniker, a._count.techniker]));
    return alle.map(a => ({
      techniker:    a.techniker,
      anfragen:     a._count.techniker,
      abgeschlossen: abgMap.get(a.techniker) ?? 0,
    }));
  }),

  // 6 — Letzte 10 Anfragen
  letzteAnfragen: adminProcedure.query(() =>
    prisma.anfrage.findMany({
      take: 10, orderBy: { datum: "desc" },
      select: { id: true, techniker: true, status: true, teil: true, datum: true, geraeteName: true },
    })
  ),

  // 7 — Letzte 10 Buchungen
  letzteBuchungen: adminProcedure.query(() =>
    prisma.buchung.findMany({
      take: 10, orderBy: { datum: "desc" },
      select: { id: true, typ: true, bezeichnung: true, menge: true, mitarbeiter: true, datum: true },
    })
  ),

  // 8 — Lagerplatz-Auslastung
  lagerplatzAuslastung: adminProcedure.query(async () => {
    const plaetze = await prisma.lagerplatz.findMany({
      select: {
        code: true, regal: true, reihe: true, ebene: true, fach: true,
        hersteller: true, modellId: true,
        modell: { select: { modell: true, hersteller: true } },
      },
      orderBy: [{ regal: "asc" }, { reihe: "asc" }, { ebene: "asc" }, { fach: "asc" }],
    });
    const belegt = plaetze.filter(p => p.modellId !== null).length;
    return {
      total:  plaetze.length,
      belegt,
      frei:   plaetze.length - belegt,
      plaetze: plaetze.map(p => ({
        code: p.code, regal: p.regal, reihe: p.reihe, ebene: p.ebene, fach: p.fach,
        belegt: p.modellId !== null,
        modell: p.modell ? `${p.modell.hersteller} ${p.modell.modell}` : null,
        hersteller: p.hersteller,
      })),
    };
  }),

  // 9 — Mindestbestand (Artikel unter Schwellwert 2)
  mindestbestand: adminProcedure.query(async () => {
    const SCHWELLWERT = 2;
    const artikel = await prisma.artikel.findMany({
      where: { bestand: { gte: 0, lt: SCHWELLWERT } },
      select: { id: true, bezeichnung: true, kategorie: true, bestand: true, lagerplatz: true },
      orderBy: { bestand: "asc" },
      take: 20,
    });
    return artikel.map(a => ({ ...a, schwellwert: SCHWELLWERT }));
  }),

  // 10 — Aktivitäts-Protokoll (letzte Aktionen aus Buchungen + Anfragen)
  aktivitaetsProtokoll: adminProcedure.query(async () => {
    const [buchungen, anfragen] = await Promise.all([
      prisma.buchung.findMany({
        take: 6, orderBy: { datum: "desc" },
        select: { id: true, typ: true, bezeichnung: true, menge: true, mitarbeiter: true, datum: true },
      }),
      prisma.anfrage.findMany({
        take: 6, orderBy: { datum: "desc" },
        select: { id: true, techniker: true, status: true, teil: true, datum: true },
      }),
    ]);
    return [
      ...buchungen.map(b => ({
        id: `b-${b.id}`, typ: "buchung" as const,
        label: `${b.typ}: ${b.bezeichnung.substring(0, 40)} ×${b.menge}`,
        akteur: b.mitarbeiter, datum: b.datum, badge: b.typ,
      })),
      ...anfragen.map(a => ({
        id: `a-${a.id}`, typ: "anfrage" as const,
        label: `Anfrage: ${a.teil}`,
        akteur: a.techniker, datum: a.datum, badge: a.status,
      })),
    ].sort((a, b) => b.datum.getTime() - a.datum.getTime()).slice(0, 10);
  }),

  // 11 — System-Status
  systemStatus: adminProcedure.query(async () => {
    const [dbOk, msOk, redisOk] = await Promise.all([
      prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      meilisearch.health().then(() => true).catch(() => false),
      redis.ping().then(() => true).catch(() => false),
    ]);
    return {
      db:          dbOk    ? "ok" as const : "fail" as const,
      meilisearch: msOk    ? "ok" as const : "fail" as const,
      redis:       redisOk ? "ok" as const : "fail" as const,
    };
  }),

  // 12 — Quick Stats
  quickStats: adminProcedure.query(async () => {
    const [modelle, aktiveTechniker, lpTotal, lpBelegt] = await Promise.all([
      prisma.geraeteModell.count({ where: { aktiv: true } }),
      prisma.technikerSession.count({ where: { online: true } }),
      prisma.lagerplatz.count(),
      prisma.lagerplatz.count({ where: { modellId: { not: null } } }),
    ]);
    return {
      modelle,
      aktiveTechniker,
      lagerplaetzeTotal:     lpTotal,
      lagerplaetzeBelegt:    lpBelegt,
      lagerplaetzeAuslastung: lpTotal > 0 ? Math.round((lpBelegt / lpTotal) * 100) : 0,
    };
  }),
});

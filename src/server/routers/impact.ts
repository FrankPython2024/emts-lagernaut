import { z } from "zod";
import { AnfrageStatus } from "@prisma/client";
import { createTRPCRouter, permissionProcedure, adminProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";
import { AUSGABE_AN_TECHNIK } from "@/lib/buchungen/technikAusgabe";
import { statistikStandortFilter } from "@/lib/auth/standortFilter";
import { zeitraum } from "@/lib/zeit/berlin";
import { anfrageStandortWhere, buchungStandortWhere } from "@/modules/statistik/standort";

// ── Impact-/Nachhaltigkeits-Kennzahlen (Laptop-Ersatzteile) ──────────────────
// Wiederverwendete Teile = Ausgabe-Buchungen an die Technik (AUSGABE_AN_TECHNIK). Daraus über
// editierbare PAUSCHAL-Faktoren: eingespartes CO2 (kg) und vermiedener E-Schrott
// (kg = Gewicht). Bewusst grobe, anpassbare Schätzung — die Faktoren setzt AfB
// selbst (Tabelle ImpactEinstellung, Singleton id=1).
//
// Lesen: STATISTIK_VIEW · Faktoren ändern: adminProcedure.
// Folgt demselben tage-/standortId-Filter wie die Statistik-Seite.

// Startwerte (klar als Annahme gekennzeichnet, jederzeit im UI änderbar).
const DEFAULT_CO2_PRO_TEIL_KG     = 5;     // kg CO2e je wiederverwendetem Teil
const DEFAULT_GEWICHT_PRO_TEIL_KG = 0.15;  // kg (~150 g) je Teil → E-Schrott

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "bigint") return Number(v);
  return typeof v === "number" ? v : Number(v);
}
function round(n: number, stellen = 2): number {
  const f = 10 ** stellen;
  return Math.round(n * f) / f;
}

async function ladeFaktoren() {
  const row = await prisma.impactEinstellung.findUnique({ where: { id: 1 } });
  return {
    co2ProTeilKg:     row ? num(row.co2ProTeilKg)     : DEFAULT_CO2_PRO_TEIL_KG,
    gewichtProTeilKg: row ? num(row.gewichtProTeilKg) : DEFAULT_GEWICHT_PRO_TEIL_KG,
  };
}

export const impactRouter = createTRPCRouter({

  // Kennzahlen für den gewählten Zeitraum/Standort.
  kennzahlen: permissionProcedure("STATISTIK_VIEW")
    .input(z.object({
      tage:       z.number().int().positive().nullable().optional(),
      standortId: z.number().int().positive().nullable().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const tage   = input?.tage ?? null;
      const sId    = statistikStandortFilter(ctx, input?.standortId ?? null);
      // Dieselbe Zeitraum-Regel wie die Statistik-Seite (deutsche Kalendertage).
      const cutoff = tage ? zeitraum(tage).von : null;
      const datum  = cutoff ? { datum: { gte: cutoff } } : {};

      const standortBuchung = buchungStandortWhere(sId);
      const standortAnfrage = await anfrageStandortWhere(sId);

      const [reused, ohneArtikel, abgaben, geraeteRows, faktoren] = await Promise.all([
        // Wiederverwendete Teile = Ausgabe-Buchungen AN DIE TECHNIK.
        // `AUSGABE_AN_TECHNIK` schließt aus: Umlagerungen (Lager-interne Umzüge),
        // Abgaben an Niederlassungen (Wirkung entsteht dort) und — seit 17.09.2026 —
        // Buchungen ohne Anfrage-Bezug. Handkorrekturen machten vorher 29 % der
        // „wiederverwendeten Teile" aus (363 von 1.249 in 90 Tagen).
        prisma.buchung.aggregate({
          _sum:  { menge: true },
          where: { ...AUSGABE_AN_TECHNIK, ...datum, ...standortBuchung },
        }),
        // Erledigte Anfragen ohne Lagerartikel (keine Sonderanfrage) laufen als
        // DIREKT ohne Buchung — das Teil wurde trotzdem wiederverwendet.
        prisma.anfrage.aggregate({
          _sum: { menge: true },
          where: {
            ...standortAnfrage,
            artikelId:        null,
            istSonderAnfrage: false,
            testModus:        false,
            status:           AnfrageStatus.ABGESCHLOSSEN,
            buchungen:        { none: {} },
            ...datum,
          },
        }),
        // Was an andere Niederlassungen ging — nur nachrichtlich, ohne Wirkung.
        prisma.buchung.aggregate({
          _sum: { menge: true },
          where: {
            typ: { in: ["AUSGANG", "DIREKT"] },
            niederlassungId: { not: null },
            ...datum,
            ...standortBuchung,
          },
        }),
        // Versorgte Geräte = distinkte LogIDs erledigter (Nicht-Test-)Anfragen.
        prisma.anfrage.findMany({
          where: {
            ...standortAnfrage,
            status:    AnfrageStatus.ABGESCHLOSSEN,
            testModus: false,
            ...datum,
          },
          select:   { logId: true },
          distinct: ["logId"],
        }),
        ladeFaktoren(),
      ]);

      const reusedParts = (reused._sum.menge ?? 0) + (ohneArtikel._sum.menge ?? 0);
      return {
        reusedParts,
        geraete:  geraeteRows.length,
        co2Kg:    round(reusedParts * faktoren.co2ProTeilKg),
        ewasteKg: round(reusedParts * faktoren.gewichtProTeilKg),
        // Nachrichtlich: an andere Niederlassungen abgegeben. Fließt bewusst
        // NICHT in CO2/E-Schrott ein, weil die Wirkung dort entsteht.
        abgegeben: abgaben._sum.menge ?? 0,
        faktoren,
      };
    }),

  // Faktoren ändern (Singleton upsert id=1). Nur Admin.
  setFaktoren: adminProcedure
    .input(z.object({
      co2ProTeilKg:     z.number().min(0).max(100_000),
      gewichtProTeilKg: z.number().min(0).max(100_000),
    }))
    .mutation(async ({ input }) => {
      await prisma.impactEinstellung.upsert({
        where:  { id: 1 },
        create: { id: 1, co2ProTeilKg: input.co2ProTeilKg, gewichtProTeilKg: input.gewichtProTeilKg },
        update: { co2ProTeilKg: input.co2ProTeilKg, gewichtProTeilKg: input.gewichtProTeilKg },
      });
      return { ok: true };
    }),
});

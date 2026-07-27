import { z } from "zod";
import { AnfrageStatus } from "@prisma/client";
import { createTRPCRouter, permissionProcedure, adminProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";
import { NICHT_UMLAGERUNG } from "@/lib/buchungen/umlagerung";

// ── Impact-/Nachhaltigkeits-Kennzahlen (Laptop-Ersatzteile) ──────────────────
// Wiederverwendete Teile = Ausgabe-Buchungen (AUSGANG + DIREKT). Daraus über
// editierbare PAUSCHAL-Faktoren: eingespartes CO2 (kg) und vermiedener E-Schrott
// (kg = Gewicht). Bewusst grobe, anpassbare Schätzung — die Faktoren setzt AfB
// selbst (Tabelle ImpactEinstellung, Singleton id=1).
//
// Lesen: STATISTIK_VIEW · Faktoren ändern: adminProcedure.
// Folgt demselben tage-/standortId-Filter wie die Statistik-Seite.

const MS_PRO_TAG = 24 * 60 * 60 * 1000;

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
    .query(async ({ input }) => {
      const tage       = input?.tage ?? null;
      const standortId = input?.standortId ?? null;
      const cutoff     = tage ? new Date(Date.now() - tage * MS_PRO_TAG) : null;

      const datum    = cutoff ? { gte: cutoff } : undefined;
      const artikel  = standortId ? { standortId } : undefined;

      const [reused, geraeteRows, faktoren] = await Promise.all([
        // Wiederverwendete Teile = Summe menge über Ausgabe-Buchungen.
        prisma.buchung.aggregate({
          _sum: { menge: true },
          // Umlagerungen (Fach-/Standortwechsel) sind KEINE Wiederverwendung —
          // sonst zählen CO2/E-Schrott/Teile Lager-interne Umzüge mit.
          where: {
            typ: { in: ["AUSGANG", "DIREKT"] },
            ...NICHT_UMLAGERUNG,
            ...(datum ? { datum } : {}),
            ...(artikel ? { artikel } : {}),
          },
        }),
        // Versorgte Geräte = distinkte LogIDs erledigter (Nicht-Test-)Anfragen.
        prisma.anfrage.findMany({
          where: {
            status: AnfrageStatus.ABGESCHLOSSEN,
            testModus: false,
            ...(datum ? { datum } : {}),
            ...(artikel ? { artikel } : {}),
          },
          select: { logId: true },
          distinct: ["logId"],
        }),
        ladeFaktoren(),
      ]);

      const reusedParts = reused._sum.menge ?? 0;
      return {
        reusedParts,
        geraete:  geraeteRows.length,
        co2Kg:    round(reusedParts * faktoren.co2ProTeilKg),
        ewasteKg: round(reusedParts * faktoren.gewichtProTeilKg),
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

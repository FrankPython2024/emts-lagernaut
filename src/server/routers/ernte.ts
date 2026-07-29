import { z } from "zod";
import { Prisma } from "@prisma/client";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";

// ── Bauteil-Ernte-Auswertung (Laptop-Ersatzteile) ──────────────────────────────
// Spender-LogID (herkunftLogId) trackt, aus welchem Altgerät ein Teil stammt.
// Ernte-Kennzahlen zeigen: wiederverwendete Teile aus Altgeräten, Materialwert,
// Top-Modelle (nach Häufigkeit), versorgte Geräte (distinct LogIDs).
//
// Lesen: STATISTIK_VIEW
// Folgt demselben tage-/standortId-Filter wie die übrige Statistik-Seite.

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "bigint") return Number(v);
  return typeof v === "number" ? v : Number(v);
}

const MS_PRO_TAG = 24 * 60 * 60 * 1000;

export const erne = createTRPCRouter({

  // Ernte-Kennzahlen: Materialwert + Top-Modelle + versorgte Geräte.
  kennzahlen: permissionProcedure("STATISTIK_VIEW")
    .input(z.object({
      tage:       z.number().int().positive().nullable().optional(),
      standortId: z.number().int().positive().nullable().optional(),
    }).optional())
    .query(async ({ input }) => {
      const tage       = input?.tage ?? null;
      const standortId = input?.standortId ?? null;
      const cutoff     = tage ? new Date(Date.now() - tage * MS_PRO_TAG) : null;

      const datumFilter    = cutoff     ? Prisma.sql`AND b.datum >= ${cutoff}`     : Prisma.empty;
      const standortFilter = standortId ? Prisma.sql`AND a.standortId = ${standortId}` : Prisma.empty;

      // Materialwert pro Kategorie (alle EINGANG-Buchungen, unabhängig von LogID).
      // Alte Teile ohne LogID werden auch gezählt, neue mit LogID zugeordnet.
      const wertRows = await prisma.$queryRaw<
        { kategorie: string | null; menge: unknown; preis: unknown }[]
      >(Prisma.sql`
        SELECT a.kategorie AS kategorie,
               SUM(b.menge) AS menge,
               kp.preis     AS preis
        FROM Buchung b
        JOIN Artikel a       ON a.id = b.artikelId
        LEFT JOIN KategoriePreis kp ON kp.kategorie = a.kategorie
        WHERE b.typ = 'EINGANG'
          ${datumFilter}
          ${standortFilter}
        GROUP BY a.kategorie, kp.preis
        ORDER BY a.kategorie
      `);

      const proKategorie: { kategorie: string; menge: number; preis: number; wert: number }[] = [];
      const ohnePreis:    { kategorie: string; menge: number }[] = [];
      let materialWert = 0;
      let mengeGesamt = 0;

      for (const r of wertRows) {
        const kategorie = r.kategorie?.trim() || "(ohne Kategorie)";
        const menge     = num(r.menge);
        mengeGesamt += menge;
        if (r.preis == null) {
          ohnePreis.push({ kategorie, menge });
        } else {
          const preis = num(r.preis);
          const wert  = Math.round(menge * preis * 100) / 100;
          materialWert += wert;
          proKategorie.push({ kategorie, menge, preis, wert });
        }
      }

      proKategorie.sort((a, b) => b.wert - a.wert);
      ohnePreis.sort((a, b) => b.menge - a.menge);

      // Top-Modelle (nur Teile mit bekannter Spender-LogID, damit Nachverfolgung möglich).
      const topModelle = await prisma.$queryRaw<
        { logId: string; menge: unknown; wert: unknown }[]
      >(Prisma.sql`
        SELECT b.herkunftLogId AS logId,
               SUM(b.menge)    AS menge,
               COALESCE(SUM(b.menge * kp.preis), 0) AS wert
        FROM Buchung b
        JOIN Artikel a       ON a.id = b.artikelId
        LEFT JOIN KategoriePreis kp ON kp.kategorie = a.kategorie
        WHERE b.typ = 'EINGANG'
          AND b.herkunftLogId IS NOT NULL
          ${datumFilter}
          ${standortFilter}
        GROUP BY b.herkunftLogId
        ORDER BY menge DESC
        LIMIT 10
      `);

      // Versorgte Geräte (distinct herkunftLogId).
      const geraeteCount = await prisma.buchung.findMany({
        where: {
          typ: "EINGANG",
          herkunftLogId: { not: null },
          ...(cutoff ? { datum: { gte: cutoff } } : {}),
          ...(standortId ? { artikel: { standortId } } : {}),
        },
        select: { herkunftLogId: true },
        distinct: ["herkunftLogId"],
      });

      return {
        mengeGesamt,
        materialWert: Math.round(materialWert * 100) / 100,
        geraete: geraeteCount.length,
        proKategorie,
        ohnePreis,
        topModelle: topModelle.map((m) => ({
          logId: m.logId,
          menge: num(m.menge),
          wert: Math.round(num(m.wert) * 100) / 100,
        })),
      };
    }),

});

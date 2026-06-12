import { z } from "zod";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";

// Geräte-Reise (LogID-Tracking).
// Gating über das Recht GERAETE_REISE_VIEW (Admin via SYSTEM_ADMIN-Wildcard).
// Reine Auswertung, kein Bestandseffekt.

export const geraeteReiseRouter = createTRPCRouter({
  // Letzte Importe inkl. Status/Zähler/Fortschritt. Wird im Admin-UI gepollt,
  // solange ein Import „läuft".
  listImports: permissionProcedure("GERAETE_REISE_VIEW").query(() =>
    prisma.logIdImport.findMany({
      orderBy: { importiertAm: "desc" },
      take:    50,
    }),
  ),

  // Ein Gerät verfolgen: exakter LogID-Treffer (PK) zuerst, sonst Treffer auf
  // Seriennummer. Bei genau einem Treffer → Stand + Bewegungs-Timeline; bei
  // mehreren Seriennummer-Treffern → kurze Auswahlliste; bei 0 → „nicht gefunden".
  geraet: permissionProcedure("GERAETE_REISE_VIEW")
    .input(z.object({ query: z.string().trim().min(1).max(200) }))
    .query(async ({ input }) => {
      const q = input.query;

      // 1) Exakter LogID-Treffer (Primary Key)
      let stand = await prisma.logIdStand.findUnique({ where: { logId: q } });

      // 2) sonst Seriennummer (kein Index — gelegentliche Suche über 132k Zeilen ok)
      if (!stand) {
        const treffer = await prisma.logIdStand.findMany({
          where:  { seriennummer: q },
          select: { logId: true, bezeichnung: true },
          take:   25,
        });
        if (treffer.length === 0) return { kind: "none" as const };
        if (treffer.length > 1)   return { kind: "treffer" as const, treffer };
        stand = await prisma.logIdStand.findUnique({ where: { logId: treffer[0]!.logId } });
        if (!stand) return { kind: "none" as const };
      }

      const bewegungen = await prisma.logIdBewegung.findMany({
        where:   { logId: stand.logId },
        orderBy: [{ zeitpunkt: "asc" }, { id: "asc" }],
      });

      return { kind: "found" as const, stand, bewegungen };
    }),
});

import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";

// Geräte-Reise (LogID-Tracking) — S1: nur Import-Liste (für Upload + Fortschritt).
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
});

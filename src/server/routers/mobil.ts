import { z } from "zod";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";
import { runMobilImport } from "@/modules/mobil/import";

// Mobil-Ersatzteile (Smartphone/Tablet-Teile mit LogID).
// Lesen: MOBIL_VIEW, Import/Verwalten: MOBIL_MANAGE (ADMIN via SYSTEM_ADMIN-Wildcard).
// Eigenes Modul — KEIN Effekt auf das Laptop-Lager/Buchungen.
const view   = permissionProcedure("MOBIL_VIEW");
const manage = permissionProcedure("MOBIL_MANAGE");

export const mobilRouter = createTRPCRouter({

  // CSV-Import (ReForm/AfB-Export als Text). Schreibt je LogID eine MobilTeil-Zeile,
  // Sicheres als ERKANNT, Unsicheres als REVIEW. Idempotent (upsert je logId),
  // MANUELL zugeordnete Teile bleiben in der Zuordnung unangetastet.
  importieren: manage
    .input(z.object({
      csvText:   z.string().min(1, "Leere CSV"),
      dateiname: z.string().max(255).optional(),
      dryRun:    z.boolean().optional(), // true → nur Bericht, schreibt NICHTS
    }))
    .mutation(async ({ input }) => {
      return runMobilImport(input.csvText, { dryRun: input.dryRun });
    }),

  // Kurz-Übersicht (Kennzahlen) — kein Anzeige-Interface, nur Zähler.
  stats: view.query(async () => {
    const [gesamt, erkannt, review, manuell, modelle, teiltypen] = await Promise.all([
      prisma.mobilTeil.count(),
      prisma.mobilTeil.count({ where: { zuordnungStatus: "ERKANNT" } }),
      prisma.mobilTeil.count({ where: { zuordnungStatus: "REVIEW" } }),
      prisma.mobilTeil.count({ where: { zuordnungStatus: "MANUELL" } }),
      prisma.mobilModell.count(),
      prisma.mobilTeiltyp.count(),
    ]);
    return { gesamt, erkannt, review, manuell, modelle, teiltypen };
  }),
});

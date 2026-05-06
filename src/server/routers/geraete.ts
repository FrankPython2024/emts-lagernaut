import { z } from "zod";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "@/server/trpc";
import {
  legeModellAn,
  legeEinzelteilAn,
  getAlleModelle,
  setzeModellAktiv,
} from "@/modules/geraete/service";
import { prisma } from "@/core/db/prisma";
import { TRPCError } from "@trpc/server";

export const geraeteRouter = createTRPCRouter({

  // Alle Gerätemodelle auflisten
  getAll: protectedProcedure
    .input(z.object({ nurAktive: z.boolean().default(true) }).optional())
    .query(({ input }) =>
      getAlleModelle(input?.nurAktive ?? true),
    ),

  // Neues Gerätemodell mit 13 Standard-Teilen anlegen — Admin
  legeModellAn: adminProcedure
    .input(z.object({
      hersteller: z.string().min(1).max(100),
      modell:     z.string().min(1).max(100),
    }))
    .mutation(({ input }) =>
      legeModellAn(input.hersteller, input.modell),
    ),

  // Einzelnes Ersatzteil zu Modell hinzufügen — Admin
  legeEinzelteilAn: adminProcedure
    .input(z.object({
      hersteller: z.string().min(1).max(100),
      modell:     z.string().min(1).max(100),
      teiltyp:    z.string().min(1).max(100),
    }))
    .mutation(({ input }) =>
      legeEinzelteilAn(input),
    ),

  // Gerätemodell aktivieren / deaktivieren — Admin
  setAktiv: adminProcedure
    .input(z.object({
      id:    z.number().int().positive(),
      aktiv: z.boolean(),
    }))
    .mutation(({ input }) =>
      setzeModellAktiv(input.id, input.aktiv),
    ),

  // Gerätemodell löschen — Admin (nur ohne Kompatibilitätseinträge)
  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const modell = await prisma.geraeteModell.findUnique({
        where: { id: input.id },
        select: { id: true, hersteller: true, modell: true },
      });

      if (!modell) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Gerätemodell nicht gefunden." });
      }

      const geraetVoll    = `${modell.hersteller} ${modell.modell}`;
      const kompEintraege = await prisma.kompatibilitaet.count({
        where: { geraet: geraetVoll },
      });

      if (kompEintraege > 0) {
        throw new TRPCError({
          code:    "BAD_REQUEST",
          message: `'${geraetVoll}' hat noch ${kompEintraege} Kompatibilitätseinträge. Bitte zuerst entfernen.`,
        });
      }

      await prisma.geraeteModell.delete({ where: { id: input.id } });
      return { geloescht: geraetVoll };
    }),

});

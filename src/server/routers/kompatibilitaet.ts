import { z } from "zod";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "@/server/trpc";
import {
  sucheKompatibel,
  getByGeraet,
  getKompatibileGeraete,
  addKompatibilitaet,
  removeKompatibilitaet,
} from "@/modules/kompatibilitaet/service";
import { prisma } from "@/core/db/prisma";

export const kompatibilitaetRouter = createTRPCRouter({

  // Alle Einträge — Admin
  getAll: adminProcedure
    .query(() =>
      prisma.kompatibilitaet.findMany({
        orderBy: [{ geraet: "asc" }, { teiltyp: "asc" }],
        include: { artikel: { select: { id: true, bezeichnung: true, bestand: true } } },
      }),
    ),

  // Alle Teile für ein Gerät — Techniker-Portal (Kompatibilitäts-Modal)
  getByGeraet: protectedProcedure
    .input(z.object({ geraet: z.string().min(1).max(255) }))
    .query(({ input }) =>
      getByGeraet(input.geraet),
    ),

  // Alle Geräte für einen Artikel — Techniker-Portal
  getKompatibileGeraete: protectedProcedure
    .input(z.object({ artikelId: z.number().int().positive() }))
    .query(({ input }) =>
      getKompatibileGeraete(input.artikelId),
    ),

  // Fuzzy-Suche nach Gerät + Teiltyp — Techniker-Portal + Admin
  sucheKompatibel: protectedProcedure
    .input(z.object({
      geraet:  z.string().min(1).max(255),
      teiltyp: z.string().min(1).max(100),
    }))
    .query(({ input }) =>
      sucheKompatibel(input.geraet, input.teiltyp),
    ),

  // Kompatibilitätseintrag hinzufügen — Admin
  add: adminProcedure
    .input(z.object({
      geraet:    z.string().min(1).max(255),
      teiltyp:   z.string().min(1).max(100),
      artikelId: z.number().int().positive(),
    }))
    .mutation(({ input }) =>
      addKompatibilitaet(input),
    ),

  // Kompatibilitätseintrag entfernen — Admin
  remove: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) =>
      removeKompatibilitaet(input.id),
    ),

});

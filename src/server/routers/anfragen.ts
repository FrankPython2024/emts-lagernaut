import { z } from "zod";
import { AnfrageStatus } from "@prisma/client";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "@/server/trpc";
import {
  erstelleAnfrage,
  storniereAnfrage,
  setzeStatus,
  getAnfragenByTechniker,
  getAnfragenAdmin,
  getAnfragenGruppiert,
} from "@/modules/anfragen/service";

export const anfragenRouter = createTRPCRouter({

  // Neue Anfrage erstellen — Techniker-Portal
  create: protectedProcedure
    .input(z.object({
      techniker:   z.string().min(1).max(50),
      logId:       z.string().min(1).max(100),
      geraeteName: z.string().max(255).optional(),
      geraet:      z.string().min(1).max(255),
      artikelId:   z.number().int().positive(),
      teil:        z.string().min(1).max(255),
      grading:     z.string().max(10).optional(),
      kommentar:   z.string().max(1000).optional(),
      gruppenNr:   z.string().max(50).optional(),
      korbId:      z.number().int().positive().optional(),
    }))
    .mutation(({ input }) =>
      erstelleAnfrage(input),
    ),

  // Alle Anfragen — Admin mit Filter
  getAll: adminProcedure
    .input(z.object({
      status:    z.nativeEnum(AnfrageStatus).optional(),
      techniker: z.string().optional(),
      von:       z.date().optional(),
      bis:       z.date().optional(),
      limit:     z.number().int().min(1).max(100).default(50),
      offset:    z.number().int().min(0).default(0),
    }).optional())
    .query(({ input }) =>
      getAnfragenAdmin({
        limit:  50,
        offset: 0,
        ...input,
      }),
    ),

  // Anfragen eines Technikers
  getByTechniker: protectedProcedure
    .input(z.object({
      kuerzel: z.string().min(1).max(50),
      showAll: z.boolean().default(false),
      limit:   z.number().int().min(1).max(50).default(20),
      offset:  z.number().int().min(0).default(0),
    }))
    .query(({ input }) =>
      getAnfragenByTechniker({
        techniker: input.kuerzel,
        showAll:   input.showAll,
        limit:     input.limit,
        offset:    input.offset,
      }),
    ),

  // Anfrage stornieren — Techniker: nur eigene, nur NEU/BEDARF
  storniere: protectedProcedure
    .input(z.object({
      techniker: z.string().min(1).max(50),
      logId:     z.string().min(1).max(100),
      teil:      z.string().min(1).max(255),
    }))
    .mutation(({ input }) =>
      storniereAnfrage(input),
    ),

  // Status setzen — nur Admin
  setStatus: adminProcedure
    .input(z.object({
      id:     z.number().int().positive(),
      status: z.nativeEnum(AnfrageStatus),
    }))
    .mutation(({ input }) =>
      setzeStatus(input.id, input.status),
    ),

  // Gruppenansicht — Admin
  getGruppiert: adminProcedure
    .input(z.object({
      status:    z.nativeEnum(AnfrageStatus).optional(),
      techniker: z.string().optional(),
      von:       z.date().optional(),
      bis:       z.date().optional(),
    }).optional())
    .query(({ input }) =>
      getAnfragenGruppiert(input),
    ),

});

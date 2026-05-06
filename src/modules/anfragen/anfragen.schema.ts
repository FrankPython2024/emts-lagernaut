import { z } from "zod";
import { AnfrageStatus } from "@prisma/client";

export const AnfrageErstellenSchema = z.object({
  techniker:   z.string().min(1).max(50),
  logId:       z.string().min(1).max(100),
  geraet:      z.string().min(1).max(255),
  geraeteName: z.string().max(255).optional(),
  artikelId:   z.number().int().positive(),
  teil:        z.string().min(1).max(255),
  menge:       z.number().int().positive().default(1),
  grading:     z.string().max(10).optional(),
  kommentar:   z.string().max(1000).optional(),
  gruppenNr:   z.string().max(50).optional(),
  korbId:      z.number().int().positive().optional(),
});

export const AnfrageListeTechnikerSchema = z.object({
  techniker: z.string().min(1).max(50),
  limit:     z.number().int().min(1).max(50).default(20),
  offset:    z.number().int().min(0).default(0),
});

export const AnfrageListeAdminSchema = z.object({
  status:    z.nativeEnum(AnfrageStatus).optional(),
  techniker: z.string().optional(),
  von:       z.date().optional(),
  bis:       z.date().optional(),
  limit:     z.number().int().min(1).max(100).default(50),
  offset:    z.number().int().min(0).default(0),
});

export const AnfrageStorniereSchema = z.object({
  id:        z.number().int().positive(),
  techniker: z.string().min(1).max(50),
});

export const AnfrageStatusSetzenSchema = z.object({
  id:     z.number().int().positive(),
  status: z.nativeEnum(AnfrageStatus),
});

export type AnfrageErstellenInput = z.infer<typeof AnfrageErstellenSchema>;

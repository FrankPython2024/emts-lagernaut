import { z } from "zod";
import { BuchungsTyp } from "@prisma/client";

export const BuchungErstellenSchema = z.object({
  artikelId:   z.number().int().positive(),
  typ:         z.nativeEnum(BuchungsTyp),
  menge:       z.number().int().positive(),
  mitarbeiter: z.string().min(1).max(50),
  notiz:       z.string().max(500).optional(),
});

export const BuchungListeSchema = z.object({
  artikelId: z.number().int().positive().optional(),
  typ:       z.nativeEnum(BuchungsTyp).optional(),
  von:       z.date().optional(),
  bis:       z.date().optional(),
  limit:     z.number().int().min(1).max(100).default(50),
  offset:    z.number().int().min(0).default(0),
});

export const BestandSyncSchema = z.object({
  artikelId: z.number().int().positive().optional(),
});

export type BuchungErstellenInput = z.infer<typeof BuchungErstellenSchema>;
export type BuchungListeInput     = z.infer<typeof BuchungListeSchema>;

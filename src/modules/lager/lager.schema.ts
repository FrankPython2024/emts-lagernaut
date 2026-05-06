import { z } from "zod";

export const ArtikelErstellenSchema = z.object({
  bezeichnung: z.string().min(1).max(255),
  kategorie:   z.string().min(1).max(100),
  lagerplatz:  z.string().max(50).optional(),
});

export const ArtikelAktualisierenSchema = z.object({
  id:          z.number().int().positive(),
  bezeichnung: z.string().min(1).max(255).optional(),
  kategorie:   z.string().min(1).max(100).optional(),
  lagerplatz:  z.string().max(50).optional().nullable(),
});

export const ArtikelSucheSchema = z.object({
  q:      z.string().min(1).max(200),
  limit:  z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).default(0),
});

export const ArtikelByIdSchema = z.object({
  id: z.number().int().positive(),
});

export const ArtikelListeSchema = z.object({
  kategorie: z.string().optional(),
  limit:     z.number().int().min(1).max(100).default(50),
  offset:    z.number().int().min(0).default(0),
});

export type ArtikelErstellenInput      = z.infer<typeof ArtikelErstellenSchema>;
export type ArtikelAktualisierenInput  = z.infer<typeof ArtikelAktualisierenSchema>;
export type ArtikelSucheInput          = z.infer<typeof ArtikelSucheSchema>;

import { z } from "zod";
import { createTRPCRouter, adminProcedure, permissionProcedure } from "@/server/trpc";
import {
  getAlleLagerplaetze,
  getBereiche,
  getLagerplatzDetails,
  createLagerplatz,
  updateLagerplatz,
  loescheLagerplatz,
  verschiebeArtikel,
  verschiebeAlle,
} from "@/modules/lagerplaetze/service";

// Lesen erfordert LAGERPLATZ_VIEW — vorher lief das alte Modul auf protectedProcedure,
// d.h. JEDER eingeloggte Nutzer (auch Techniker) konnte die komplette Lagerstruktur
// samt Artikelverteilung abfragen. Der neuere lagerplatzRouter gated dieselben Daten
// bereits so; Techniker sollen Lagerplätze bewusst NICHT sehen.
const lagerplatzView = permissionProcedure("LAGERPLATZ_VIEW");

export const lagerplaetzeRouter = createTRPCRouter({

  // Alle Lagerplätze (distinct Strings) mit Artikel-Anzahl
  getAll: lagerplatzView
    .input(z.object({ bereich: z.string().optional() }).optional())
    .query(({ input }) => getAlleLagerplaetze(input)),

  // Alle Bereiche für Filter-Dropdown
  getBereiche: lagerplatzView
    .query(() => getBereiche()),

  // Neuen Lagerplatz manuell anlegen — Admin
  create: adminProcedure
    .input(z.object({
      code:         z.string().min(1).max(50),
      beschreibung: z.string().max(255).optional(),
      bereich:      z.string().max(100).optional(),
    }))
    .mutation(({ input }) => createLagerplatz(input)),

  // Lagerplatz bearbeiten — Beschreibung/Bereich, optional Umbenennen.
  // Beim Umbenennen ziehen die Artikel mit (siehe Service).
  update: adminProcedure
    .input(z.object({
      code:         z.string().min(1).max(50),
      neuerCode:    z.string().min(1).max(50).optional(),
      beschreibung: z.string().max(255).nullish(),
      bereich:      z.string().max(100).nullish(),
    }))
    .mutation(({ input }) => updateLagerplatz(input)),

  // Lagerplatz löschen — nur wenn keine Artikel mehr darauf stehen.
  loeschen: adminProcedure
    .input(z.object({ code: z.string().min(1).max(50) }))
    .mutation(({ input }) => loescheLagerplatz(input.code)),

  // Lagerplatz-Details: alle Artikel mit diesem Code
  getByCode: lagerplatzView
    .input(z.object({ code: z.string().min(1) }))
    .query(({ input }) => getLagerplatzDetails(input.code)),

  // Einzelnen Artikel verschieben — Admin
  verschiebeArtikel: adminProcedure
    .input(z.object({
      artikelId:      z.number().int().positive(),
      neuerLagerplatz: z.string().min(1).max(50),
      mitarbeiter:    z.string().min(1).max(50),
    }))
    .mutation(({ input }) => verschiebeArtikel(input)),

  // Alle Artikel eines Lagerplatzes verschieben — Admin
  verschiebeAlle: adminProcedure
    .input(z.object({
      alterLagerplatz: z.string().min(1).max(50),
      neuerLagerplatz: z.string().min(1).max(50),
      mitarbeiter:     z.string().min(1).max(50),
    }))
    .mutation(({ input }) => verschiebeAlle(input)),

});

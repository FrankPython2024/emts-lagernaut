import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "@/server/trpc";
import { getZugaenglicheStandortIds } from "@/lib/auth/standortFilter";
import {
  sucheKompatibel,
  getByGeraet,
  getKompatibileGeraete,
  addKompatibilitaet,
  removeKompatibilitaet,
  getByGeraetMitStandard,
  getByModell,
  getModalData,
  setVerknuepfung,
  setVerknuepfteArtikelBulk,
  autoVerknuepfung,
  massAutoVerknuepfung,
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

  // Alle Teile für ein Gerät — Techniker-Portal
  getByGeraet: protectedProcedure
    .input(z.object({ geraet: z.string().min(1).max(255) }))
    .query(({ input }) => getByGeraet(input.geraet)),

  // Alle Geräte für einen Artikel
  getKompatibileGeraete: protectedProcedure
    .input(z.object({ artikelId: z.number().int().positive() }))
    .query(({ input }) => getKompatibileGeraete(input.artikelId)),

  // Fuzzy-Suche
  sucheKompatibel: protectedProcedure
    .input(z.object({ geraet: z.string().min(1).max(255), teiltyp: z.string().min(1).max(100) }))
    .query(({ input }) => sucheKompatibel(input.geraet, input.teiltyp)),

  // Kompatibilitätseintrag hinzufügen — Admin
  add: adminProcedure
    .input(z.object({ geraet: z.string().min(1).max(255), teiltyp: z.string().min(1).max(100), artikelId: z.number().int().positive() }))
    .mutation(({ input }) => addKompatibilitaet(input)),

  // Kompatibilitätseintrag entfernen — Admin
  remove: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => removeKompatibilitaet(input.id)),

  // Teile für Gerät mit Standard-Fallback — Techniker-Portal + LogID-Suche
  getByGeraetMitStandard: protectedProcedure
    .input(z.object({ geraet: z.string().min(1) }))
    .query(({ input, ctx }) => {
      const standortIds = getZugaenglicheStandortIds(ctx);
      return getByGeraetMitStandard({
        geraet:      input.geraet,
        standortIds: standortIds ?? undefined,
      });
    }),

  // ─── Modell-Verknüpfung (Admin) ────────────────────────────────────────────

  // Alle Verknüpfungen eines Modells
  getByModell: adminProcedure
    .input(z.object({ modellId: z.number().int().positive() }))
    .query(({ input }) => getByModell(input.modellId)),

  // Alle Daten für Verknüpfungs-Modal (ein Aufruf)
  getModalData: adminProcedure
    .input(z.object({ modellId: z.number().int().positive() }))
    .query(({ input }) => getModalData(input.modellId)),

  // Verknüpfungen eines Modells komplett setzen (Legacy, 1 Artikel pro Teiltyp)
  setVerknuepfung: adminProcedure
    .input(z.object({
      modellId:       z.number().int().positive(),
      verknuepfungen: z.array(z.object({
        teiltyp:   z.string().min(1).max(100),
        artikelId: z.number().int().positive().nullable(),
      })),
    }))
    .mutation(({ input }) => setVerknuepfung(input)),

  // Multi-Artikel pro (geraet, teiltyp) setzen — Pool-Verknüpfung über mehrere Teiltypen
  setVerknuepfteArtikelBulk: adminProcedure
    .input(z.object({
      geraet:    z.string().min(1).max(255),
      eintraege: z.array(z.object({
        teiltyp:    z.string().min(1).max(100),
        artikelIds: z.array(z.number().int().positive()).max(50),
      })).max(100),
    }))
    .mutation(({ input }) => setVerknuepfteArtikelBulk(input)),

  // Aktuell mit (artikel, teiltyp) verknüpfte Gerätenamen — für Multi-Select-Initialstate
  getVerknuepfteGeraete: adminProcedure
    .input(z.object({
      artikelId: z.number().int().positive(),
      teiltyp:   z.string().min(1).max(100),
    }))
    .query(async ({ input }) => {
      const rows = await prisma.kompatibilitaet.findMany({
        where:   { artikelId: input.artikelId, teiltyp: input.teiltyp },
        select:  { geraet: true },
        orderBy: { geraet: "asc" },
      });
      return rows.map((r) => r.geraet);
    }),

  // Bulk: einen Artikel für mehrere Modelle als kompatibel setzen / abwählen.
  // geraete = (neu) verknüpfen (upsert), entfernen = abwählen (nur wenn auf
  // DIESEN Artikel zeigend). Beides in einer Transaktion. Leere Listen = No-op.
  setVerknuepfungBulk: adminProcedure
    .input(z.object({
      artikelId: z.number().int().positive(),
      teiltyp:   z.string().min(1).max(100),
      geraete:   z.array(z.string().min(1).max(255)).default([]),
      entfernen: z.array(z.string().min(1).max(255)).optional(),
    }))
    .mutation(async ({ input }) =>
      prisma.$transaction(async (tx) => {
        for (const geraet of input.geraete) {
          await tx.kompatibilitaet.upsert({
            where:  { geraet_teiltyp_artikelId: { geraet, teiltyp: input.teiltyp, artikelId: input.artikelId } },
            create: { geraet, teiltyp: input.teiltyp, artikelId: input.artikelId },
            update: {},
          });
        }

        let entfernt = 0;
        if (input.entfernen && input.entfernen.length > 0) {
          const del = await tx.kompatibilitaet.deleteMany({
            where: {
              geraet:    { in: input.entfernen },
              teiltyp:   input.teiltyp,
              artikelId: input.artikelId,
            },
          });
          entfernt = del.count;
        }

        return { verknuepft: input.geraete.length, entfernt };
      }),
    ),

  // Auto-Verknüpfung für ein Modell
  autoVerknuepfung: adminProcedure
    .input(z.object({ modellId: z.number().int().positive() }))
    .mutation(({ input }) => autoVerknuepfung(input.modellId)),

  // Massen-Auto-Verknüpfung aller Modelle ohne Kompatibilität
  massAutoVerknuepfung: adminProcedure
    .mutation(() => massAutoVerknuepfung()),

  // ── Globale Routen ─────────────────────────────────────────────────────────

  // Gesamtanzahl aller Kompatibilitäts-Einträge im System
  getCount: adminProcedure
    .query(() => prisma.kompatibilitaet.count()),

  // ALLE Kompatibilitäten löschen — Admin only, nuklearer Reset
  removeAll: adminProcedure
    .mutation(async ({ ctx }) => {
      const result = await prisma.kompatibilitaet.deleteMany({});
      return { geloescht: result.count };
    }),

  // ── Modell-spezifische Routen ──────────────────────────────────────────────

  // Alle Kompatibilitäten für ein Gerät (String) entfernen — Admin
  removeAllByModell: adminProcedure
    .input(z.object({ geraet: z.string().min(1).max(255) }))
    .mutation(async ({ input }) => {
      const result = await prisma.kompatibilitaet.deleteMany({
        where: { geraet: input.geraet },
      });
      return { geloescht: result.count };
    }),

  // Detail-Daten eines Modells (für Detail-Modal)
  getDetailForModell: adminProcedure
    .input(z.object({ modellId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const modell = await prisma.geraeteModell.findUnique({
        where: { id: input.modellId },
      });
      if (!modell) throw new TRPCError({ code: "NOT_FOUND", message: "Modell nicht gefunden." });

      const geraetVoll = `${modell.hersteller} ${modell.modell}`;
      const eintraege  = await prisma.kompatibilitaet.findMany({
        where:   { geraet: geraetVoll },
        include: {
          artikel: {
            select: { id: true, bezeichnung: true, bestand: true, lagerplatz: true, kategorie: true },
          },
        },
        orderBy: { teiltyp: "asc" },
      });

      return { modell, geraetVoll, eintraege, anzahl: eintraege.length };
    }),

  // Artikel suchen für einen bestimmten Teiltyp — für Verknüpfungs-Suchfeld
  sucheArtikelFuerTeil: adminProcedure
    .input(z.object({
      query:   z.string().max(200).default(""),
      teiltyp: z.string().min(1).max(100),
      limit:   z.number().int().min(1).max(20).default(10),
    }))
    .query(async ({ input }) => {
      const trim = input.query.trim();
      return prisma.artikel.findMany({
        where: {
          kategorie: input.teiltyp,
          ...(trim ? { bezeichnung: { contains: trim } } : {}),
        },
        select: { id: true, bezeichnung: true, bestand: true, lagerplatz: true },
        orderBy: [{ bestand: "desc" }, { bezeichnung: "asc" }],
        take: input.limit,
      });
    }),

});

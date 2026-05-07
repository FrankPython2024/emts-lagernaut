import { z } from "zod";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "@/server/trpc";
import {
  getLiveStats,
  getMeistgefragteGeraete,
  getMeistgefragteTeile,
  getAnfragenNachStatus,
  getBuchungenVerlauf,
  getKpiOverview,
  getTechnikerStats,
  getMonatsbericht,
  getAnfragenVerlauf,
  getTechnikerKpis,
  getTechnikerTeile,
  getTechnikerGeraete,
  getTechnikerWochentage,
  getTechnikerTageszeiten,
  getTechnikerLetzteAnfragen,
  getTechnikerTeamVergleich,
  getTechnikerJahresArchiv,
  getTechnikerVerfuegbareJahre,
  getTechnikerMonatsDetail,
  getAllTechnikerJahresOverview,
} from "@/modules/statistik/service";

const TageSchema = z.object({
  tage: z.number().int().min(1).max(365).default(30),
});

export const statistikRouter = createTRPCRouter({

  // Live-Kennzahlen — alle eingeloggten User
  getLiveStats: protectedProcedure
    .query(() => getLiveStats()),

  // Meistgefragte Geräte — Admin
  getMeistgefragteGeraete: adminProcedure
    .input(TageSchema)
    .query(({ input }) => getMeistgefragteGeraete(input.tage)),

  // Meistgefragte Teile — Admin
  getMeistgefragteTeile: adminProcedure
    .input(TageSchema)
    .query(({ input }) => getMeistgefragteTeile(input.tage)),

  // Anfragen nach Status — Admin
  getAnfragenNachStatus: adminProcedure
    .query(() => getAnfragenNachStatus()),

  // Buchungsverlauf täglich — Admin
  getBuchungenVerlauf: adminProcedure
    .input(TageSchema)
    .query(({ input }) => getBuchungenVerlauf(input.tage)),

  // KPI-Übersicht — Admin (tage statt Date-Objekte)
  getKpiOverview: adminProcedure
    .input(TageSchema)
    .query(({ input }) => getKpiOverview(input.tage)),

  // Techniker-Statistik — Admin
  getTechnikerStats: adminProcedure
    .input(TageSchema)
    .query(({ input }) => getTechnikerStats(input.tage)),

  // Monatsbericht — Admin
  getMonatsbericht: adminProcedure
    .input(z.object({
      monat: z.number().int().min(1).max(12),
      jahr:  z.number().int().min(2020).max(2100),
    }))
    .query(({ input }) => getMonatsbericht(input.monat, input.jahr)),

  // ── Techniker-Statistik (Anfragen-basiert) ────────────────────────────────

  // Anfragen-Verlauf täglich (optional nach Techniker gefiltert)
  getAnfragenVerlauf: adminProcedure
    .input(z.object({
      tage:    z.number().int().min(1).max(365).default(30),
      kuerzel: z.string().optional(),
    }))
    .query(({ input }) => getAnfragenVerlauf(input.tage, input.kuerzel)),

  // Techniker-KPIs (6 Kennzahlen, nur für einen Techniker)
  getTechnikerKpis: adminProcedure
    .input(z.object({
      kuerzel: z.string().min(1),
      tage:    z.number().int().min(1).max(365).default(30),
    }))
    .query(({ input }) => getTechnikerKpis(input.kuerzel, input.tage)),

  // Top Teile eines Technikers mit Bedarf-Anteil
  getTechnikerTeile: adminProcedure
    .input(z.object({
      kuerzel: z.string().min(1),
      tage:    z.number().int().min(1).max(365).default(30),
    }))
    .query(({ input }) => getTechnikerTeile(input.kuerzel, input.tage)),

  // Top Geräte eines Technikers
  getTechnikerGeraete: adminProcedure
    .input(z.object({
      kuerzel: z.string().min(1),
      tage:    z.number().int().min(1).max(365).default(30),
    }))
    .query(({ input }) => getTechnikerGeraete(input.kuerzel, input.tage)),

  // Wochentag-Verteilung
  getTechnikerWochentage: adminProcedure
    .input(z.object({
      kuerzel: z.string().min(1),
      tage:    z.number().int().min(1).max(365).default(90),
    }))
    .query(({ input }) => getTechnikerWochentage(input.kuerzel, input.tage)),

  // Tageszeit-Verteilung
  getTechnikerTageszeiten: adminProcedure
    .input(z.object({
      kuerzel: z.string().min(1),
      tage:    z.number().int().min(1).max(365).default(90),
    }))
    .query(({ input }) => getTechnikerTageszeiten(input.kuerzel, input.tage)),

  // Letzte Anfragen (paginiert)
  getTechnikerLetzteAnfragen: adminProcedure
    .input(z.object({
      kuerzel: z.string().min(1),
      tage:    z.number().int().min(1).max(365).default(30),
      limit:   z.number().int().min(1).max(50).default(20),
      offset:  z.number().int().min(0).default(0),
    }))
    .query(({ input }) =>
      getTechnikerLetzteAnfragen(input.kuerzel, input.tage, input.limit, input.offset),
    ),

  // Team-Vergleich: alle Techniker mit mehreren Metriken
  getTechnikerTeamVergleich: adminProcedure
    .input(TageSchema)
    .query(({ input }) => getTechnikerTeamVergleich(input.tage)),

  // ── Jahres-Archiv ─────────────────────────────────────────────────────────

  // 12-Monats-Übersicht für ein Jahr (Redis-gecacht)
  getTechnikerJahresArchiv: adminProcedure
    .input(z.object({
      kuerzel: z.string().min(1),
      jahr:    z.number().int().min(2020).max(2100),
    }))
    .query(({ input }) => getTechnikerJahresArchiv(input.kuerzel, input.jahr)),

  // Verfügbare Jahre für den Jahr-Selector
  getTechnikerVerfuegbareJahre: adminProcedure
    .input(z.object({ kuerzel: z.string().min(1) }))
    .query(({ input }) => getTechnikerVerfuegbareJahre(input.kuerzel)),

  // Monats-Detail mit Top Teile/Geräte + alle Anfragen (Redis-gecacht)
  getTechnikerMonatsDetail: adminProcedure
    .input(z.object({
      kuerzel: z.string().min(1),
      monat:   z.number().int().min(1).max(12),
      jahr:    z.number().int().min(2020).max(2100),
    }))
    .query(({ input }) => getTechnikerMonatsDetail(input.kuerzel, input.monat, input.jahr)),

  // Alle Techniker kompakt für Chefetage-Überblick
  getAllTechnikerJahresOverview: adminProcedure
    .input(z.object({ jahr: z.number().int().min(2020).max(2100) }))
    .query(({ input }) => getAllTechnikerJahresOverview(input.jahr)),

});

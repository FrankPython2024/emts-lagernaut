import { z } from "zod";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { statistikStandortFilter } from "@/lib/auth/standortFilter";
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

// Alle Statistik-Endpoints sind read-only und sollen für BETRACHTER
// (STATISTIK_VIEW) sichtbar sein. ADMIN bekommt es via SYSTEM_ADMIN-Wildcard.
const statistikProcedure = permissionProcedure("STATISTIK_VIEW");

const standortId = z.number().int().positive().nullish();
const tageFeld   = z.number().int().min(1).max(365);

const TageSchema = z.object({ tage: tageFeld.default(30), standortId });

// ⚠️ JEDE Abfrage prüft den Standort auf dem Server — auch die je Techniker.
// Bis 17.09.2026 bekamen die Techniker-Abfragen, Jahresarchiv und Monatsdetail
// gar keinen Standort: Ein auf einen Standort beschränktes Konto sah dort die
// Anfragen aller Standorte.
const TechnikerSchema = z.object({ kuerzel: z.string().min(1), tage: tageFeld.default(30), standortId });

export const statistikRouter = createTRPCRouter({

  // Live-Kennzahlen. ⚠️ War ein protectedProcedure — damit konnten auch TECHNIKER
  // und PICKUP Bestandszahlen abrufen. Wird aktuell von keiner Seite genutzt.
  getLiveStats: statistikProcedure
    .input(z.object({ standortId }).optional())
    .query(({ input, ctx }) => getLiveStats(statistikStandortFilter(ctx, input?.standortId))),

  getMeistgefragteGeraete: statistikProcedure
    .input(TageSchema)
    .query(({ input, ctx }) => getMeistgefragteGeraete(input.tage, statistikStandortFilter(ctx, input.standortId))),

  getMeistgefragteTeile: statistikProcedure
    .input(TageSchema)
    .query(({ input, ctx }) => getMeistgefragteTeile(input.tage, statistikStandortFilter(ctx, input.standortId))),

  getAnfragenNachStatus: statistikProcedure
    .input(z.object({ tage: tageFeld.optional(), standortId }).optional())
    .query(({ input, ctx }) => getAnfragenNachStatus(input?.tage, statistikStandortFilter(ctx, input?.standortId))),

  getBuchungenVerlauf: statistikProcedure
    .input(TageSchema)
    .query(({ input, ctx }) => getBuchungenVerlauf(input.tage, statistikStandortFilter(ctx, input.standortId))),

  getKpiOverview: statistikProcedure
    .input(TageSchema)
    .query(({ input, ctx }) => getKpiOverview(input.tage, statistikStandortFilter(ctx, input.standortId))),

  getTechnikerStats: statistikProcedure
    .input(TageSchema)
    .query(({ input, ctx }) => getTechnikerStats(input.tage, statistikStandortFilter(ctx, input.standortId))),

  getMonatsbericht: statistikProcedure
    .input(z.object({
      monat: z.number().int().min(1).max(12),
      jahr:  z.number().int().min(2020).max(2100),
      standortId,
    }))
    .query(({ input, ctx }) =>
      getMonatsbericht(input.monat, input.jahr, statistikStandortFilter(ctx, input.standortId))),

  // ── Techniker-Statistik (Anfragen-basiert) ────────────────────────────────

  getAnfragenVerlauf: statistikProcedure
    .input(z.object({ tage: tageFeld.default(30), kuerzel: z.string().optional(), standortId }))
    .query(({ input, ctx }) =>
      getAnfragenVerlauf(input.tage, input.kuerzel, statistikStandortFilter(ctx, input.standortId))),

  getTechnikerKpis: statistikProcedure
    .input(TechnikerSchema)
    .query(({ input, ctx }) =>
      getTechnikerKpis(input.kuerzel, input.tage, statistikStandortFilter(ctx, input.standortId))),

  getTechnikerTeile: statistikProcedure
    .input(TechnikerSchema)
    .query(({ input, ctx }) =>
      getTechnikerTeile(input.kuerzel, input.tage, statistikStandortFilter(ctx, input.standortId))),

  getTechnikerGeraete: statistikProcedure
    .input(TechnikerSchema)
    .query(({ input, ctx }) =>
      getTechnikerGeraete(input.kuerzel, input.tage, statistikStandortFilter(ctx, input.standortId))),

  getTechnikerWochentage: statistikProcedure
    .input(TechnikerSchema)
    .query(({ input, ctx }) =>
      getTechnikerWochentage(input.kuerzel, input.tage, statistikStandortFilter(ctx, input.standortId))),

  getTechnikerTageszeiten: statistikProcedure
    .input(TechnikerSchema)
    .query(({ input, ctx }) =>
      getTechnikerTageszeiten(input.kuerzel, input.tage, statistikStandortFilter(ctx, input.standortId))),

  getTechnikerLetzteAnfragen: statistikProcedure
    .input(TechnikerSchema.extend({
      limit:  z.number().int().min(1).max(50).default(20),
      offset: z.number().int().min(0).default(0),
    }))
    .query(({ input, ctx }) =>
      getTechnikerLetzteAnfragen(
        input.kuerzel, input.tage, input.limit, input.offset,
        statistikStandortFilter(ctx, input.standortId),
      )),

  getTechnikerTeamVergleich: statistikProcedure
    .input(TageSchema)
    .query(({ input, ctx }) => getTechnikerTeamVergleich(input.tage, statistikStandortFilter(ctx, input.standortId))),

  // ── Jahres-Archiv ─────────────────────────────────────────────────────────

  getTechnikerJahresArchiv: statistikProcedure
    .input(z.object({ kuerzel: z.string().min(1), jahr: z.number().int().min(2020).max(2100), standortId }))
    .query(({ input, ctx }) =>
      getTechnikerJahresArchiv(input.kuerzel, input.jahr, statistikStandortFilter(ctx, input.standortId))),

  getTechnikerVerfuegbareJahre: statistikProcedure
    .input(z.object({ kuerzel: z.string().min(1), standortId }))
    .query(({ input, ctx }) =>
      getTechnikerVerfuegbareJahre(input.kuerzel, statistikStandortFilter(ctx, input.standortId))),

  getTechnikerMonatsDetail: statistikProcedure
    .input(z.object({
      kuerzel: z.string().min(1),
      monat:   z.number().int().min(1).max(12),
      jahr:    z.number().int().min(2020).max(2100),
      standortId,
    }))
    .query(({ input, ctx }) =>
      getTechnikerMonatsDetail(input.kuerzel, input.monat, input.jahr, statistikStandortFilter(ctx, input.standortId))),

  getAllTechnikerJahresOverview: statistikProcedure
    .input(z.object({ jahr: z.number().int().min(2020).max(2100), standortId }))
    .query(({ input, ctx }) =>
      getAllTechnikerJahresOverview(input.jahr, statistikStandortFilter(ctx, input.standortId))),

});

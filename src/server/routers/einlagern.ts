import { z }                                    from "zod";
import { createTRPCRouter, adminProcedure }    from "@/server/trpc";
import type { SessionUser }                    from "@/core/types";
import { resolveStandortId }                   from "@/lib/auth/standortFilter";
import {
  geraetSuchen,
  preview,
  execute,
  lagerplatzVorschlag,
  lagerplatzVorschlaegeMulti,
} from "@/modules/einlagern/service";
import { STANDARD_TEILE, GRADING_OPTIONS } from "@/modules/einlagern/constants";

const EinlagerItemSchema = z.object({
  teiltyp:    z.string().min(1).max(100),
  menge:      z.number().int().min(1).max(99),
  grading:    z.string().min(1).max(5),
  notiz:      z.string().max(500).optional(),
  lagerplatz: z.string().max(50).optional(),
});

export const einlagernRouter = createTRPCRouter({

  // Gerät per LogID, Text oder Modellname suchen
  geraetSuchen: adminProcedure
    .input(z.object({ query: z.string().min(1).max(200) }))
    .query(({ input }) => geraetSuchen(input.query)),

  // Statische Liste aller Standard-Teile + Grading-Optionen
  verfuegbareTeile: adminProcedure
    .query(() => ({ teile: STANDARD_TEILE, grading: GRADING_OPTIONS })),

  // Vorschau: Was passiert beim Einbuchen?
  preview: adminProcedure
    .input(z.object({
      geraetName: z.string().min(1).max(255),
      items:      z.array(EinlagerItemSchema).min(1).max(13),
    }))
    .query(({ input }) => preview(input.items, input.geraetName)),

  // Einbuchen: Artikel anlegen/finden, EINGANG-Buchung, Kompatibilitaet setzen, Lagerplatz zuweisen
  execute: adminProcedure
    .input(z.object({
      geraetName:             z.string().min(1).max(255),
      logId:                  z.string().optional(),
      items:                  z.array(EinlagerItemSchema).min(1).max(13),
      gewaehlterLagerplatzId: z.number().int().positive().optional(),
      standortId:             z.number().int().positive().optional(),
    }))
    .mutation(({ input, ctx }) => {
      const user       = ctx.session!.user as SessionUser;
      const standortId = input.standortId ?? resolveStandortId(ctx);
      return execute({ ...input, mitarbeiter: user.kuerzel, standortId });
    }),

  // Einzelner Lagerplatz-Vorschlag für eine Kategorie
  lagerplatzVorschlag: adminProcedure
    .input(z.object({
      kategorie:  z.string().min(1).max(100),
      standortId: z.number().int().positive().optional(),
    }))
    .query(({ input }) => lagerplatzVorschlag(input.kategorie, input.standortId)),

  // Mehrere Lagerplatz-Vorschläge auf einmal (für Step 3)
  lagerplatzVorschlaegeMulti: adminProcedure
    .input(z.object({
      kategorien: z.array(z.string().min(1).max(100)).max(13),
      standortId: z.number().int().positive().optional(),
    }))
    .query(({ input }) => lagerplatzVorschlaegeMulti(input.kategorien, input.standortId)),

});

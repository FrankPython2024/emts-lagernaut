import { z }                                    from "zod";
import { createTRPCRouter, adminProcedure }    from "@/server/trpc";
import type { SessionUser }                    from "@/core/types";
import { resolveStandortId }                   from "@/lib/auth/standortFilter";
import { TRPCError }                           from "@trpc/server";
import {
  geraetSuchen,
  modellImRegal,
  preview,
  execute,
  lagerplatzVorschlag,
  lagerplatzVorschlaegeMulti,
} from "@/modules/einlagern/service";
import { STANDARD_TEILE, GRADING_OPTIONS } from "@/modules/einlagern/constants";
import { HERKUNFT_ARTEN } from "@/lib/einlagern/herkunft";
import { normalisiereHersteller } from "@/lib/geraete/herstellerFilter";

const EinlagerItemSchema = z.object({
  teiltyp:          z.string().min(1).max(100),
  menge:            z.number().int().min(1).max(9999), // 3D-Druck: freie, teils große Stückzahlen
  grading:          z.string().min(1).max(5),
  notiz:            z.string().max(500).optional(),
  lagerplatz:       z.string().max(50).optional(),
  // Nur für Teiltyp "Verschiedenes": Freitext (z.B. "Schraubenset").
  verschiedenesText: z.string().max(100).optional(),
});

export const einlagernRouter = createTRPCRouter({

  // Gerät per LogID, Text oder Modellname suchen
  geraetSuchen: adminProcedure
    .input(z.object({ query: z.string().min(1).max(200) }))
    .query(({ input }) => geraetSuchen(input.query)),

  // Rein lesende Früh-Prüfung: Liegt das Modell schon im Regal (welches Fach/Standort)?
  // Legt nichts an, bucht nichts, weist nichts zu — nur Anzeige in Step 1.
  modellImRegal: adminProcedure
    .input(z.object({
      logId:      z.string().max(50).optional(),
      geraetName: z.string().max(255).optional(),
    }))
    .query(({ input }) => modellImRegal(input)),

  // Statische Liste aller Standard-Teile + Grading-Optionen
  verfuegbareTeile: adminProcedure
    .query(() => ({ teile: STANDARD_TEILE, grading: GRADING_OPTIONS })),

  // Vorschau: Was passiert beim Einbuchen?
  preview: adminProcedure
    .input(z.object({
      geraetName: z.string().min(1).max(255),
      items:      z.array(EinlagerItemSchema).min(1).max(13),
      // muss zum Standort passen, mit dem execute() bucht — sonst zeigt die Vorschau
      // Artikel/Bestände eines fremden Standorts an.
      standortId: z.number().int().positive().optional(),
    }))
    .query(({ input }) => preview(input.items, input.geraetName, input.standortId ?? 1)),

  // Einbuchen: Artikel anlegen/finden, EINGANG-Buchung, Kompatibilitaet setzen, Lagerplatz zuweisen
  execute: adminProcedure
    .input(z.object({
      geraetName:             z.string().min(1).max(255),
      logId:                  z.string().optional(),
      items:                  z.array(EinlagerItemSchema).min(1).max(13),
      gewaehlterLagerplatzId: z.number().int().positive().optional(),
      standortId:             z.number().int().positive().optional(),
      // Trennt echte Bauteil-Ernte von selbst gedruckten Teilen — sonst
      // verfälschen 3D-Druck-Chargen die Ernte-Kennzahlen.
      herkunftArt:            z.enum(HERKUNFT_ARTEN).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session!.user as SessionUser;

      // Standort ableiten — Lagerplatz hat immer Vorrang
      let standortId: number;
      if (input.gewaehlterLagerplatzId) {
        const platz = await ctx.prisma.lagerplatz.findUnique({
          where:  { id: input.gewaehlterLagerplatzId },
          select: {
            standortId: true,
            code:       true,
            belegungen: { include: { modell: { select: { id: true, hersteller: true } } } },
          },
        });
        if (!platz) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Lagerplatz #${input.gewaehlterLagerplatzId} nicht gefunden` });
        }
        standortId = platz.standortId;

        // Früh-Validierung (race-sichere Endprüfung passiert nochmal in execute()):
        // Kapazität max 4 + Hersteller-Reinheit.
        const zielHersteller = normalisiereHersteller(input.geraetName.split(" ")[0] ?? "");
        const fachHerst = platz.belegungen[0]?.modell.hersteller ?? null;
        if (fachHerst && zielHersteller && fachHerst !== zielHersteller) {
          throw new TRPCError({
            code:    "BAD_REQUEST",
            message: `Fach ${platz.code} enthält ${fachHerst}-Modelle, ${zielHersteller} ist nicht erlaubt.`,
          });
        }
        if (platz.belegungen.length >= 4) {
          throw new TRPCError({ code: "CONFLICT", message: `Fach ${platz.code} ist voll (max 4 Modelle).` });
        }
      } else {
        standortId = input.standortId ?? resolveStandortId(ctx);
      }

      // Techniker-Schutz: kein Einlagern in fremden Standort
      const userStandortId = (user as SessionUser).standortId;
      if (userStandortId != null && userStandortId !== standortId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Techniker kann nicht in fremden Standort einlagern" });
      }

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

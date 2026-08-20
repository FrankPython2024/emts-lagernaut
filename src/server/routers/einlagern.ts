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
import { erfasseKomponenten } from "@/modules/einlagern/komponenten";
import { erfasseLosesTeil }   from "@/modules/einlagern/loseTeile";
import { normalisiereHersteller } from "@/lib/geraete/herstellerFilter";

const EinlagerItemSchema = z.object({
  teiltyp:          z.string().min(1).max(100),
  menge:            z.number().int().min(1).max(9999), // 3D-Druck: freie, teils große Stückzahlen
  grading:          z.string().min(1).max(5),
  notiz:            z.string().max(500).optional(),
  lagerplatz:       z.string().max(50).optional(),
  // Nur für Teiltyp "Verschiedenes": Freitext (z.B. "Schraubenset").
  verschiedenesText: z.string().max(100).optional(),
  // Aufgedruckte Teilenummer, gescannt oder getippt. Bestimmt, wenn gesetzt,
  // die Identität des Artikels.
  teilenummer:      z.string().max(120).optional(),
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

  // ── Weg B: nur das Teil, kein Spendergeraet ─────────────────────────────
  // Anker ist die Teilenummer statt der LogID. Eins von beidem, Nummer oder
  // Bezeichnung, muss da sein — der Service lehnt sonst ab.
  erfasseLosesTeil: adminProcedure
    .input(z.object({
      standortId:  z.number().int().positive().optional(),
      teilenummer: z.string().max(120).nullish(),
      bezeichnung: z.string().max(191).nullish(),
      teiltyp:     z.string().min(1).max(100),
      menge:       z.number().int().min(1).max(9999),
      grading:     z.string().max(5).nullish(),
      lagerplatz:  z.string().max(50).nullish(),
      notiz:       z.string().max(500).nullish(),
      // Foto aus der Erkennung, base64 ohne Praefix. Wird als Vergleichsbild
      // an der Teilenummer abgelegt.
      fotoBase64:  z.string().max(9_000_000).nullish(),
    }))
    .mutation(({ input, ctx }) => {
      const user = ctx.session!.user as SessionUser;
      return erfasseLosesTeil({
        ...input,
        mitarbeiter: user.kuerzel || user.name || "?",
        standortId:  resolveStandortId(ctx, input.standortId),
      });
    }),

  // ── Datenträger & Arbeitsspeicher erfassen ────────────────────────────────
  // Eigener Weg neben dem Ernten aus einem Spendergerät: Diese Teile sind nicht
  // gerätegebunden, sie werden kartonweise gezählt. Mehrere Zeilen auf einmal,
  // damit eine Sortier-Sitzung in einem Rutsch gebucht werden kann.
  erfasseKomponenten: adminProcedure
    .input(z.object({
      standortId: z.number().int().positive().optional(),
      zeilen: z.array(z.union([
        z.object({
          art:           z.literal("DATENTRAEGER"),
          typ:           z.string().min(1).max(20),   // SSD | HDD
          groesse:       z.string().min(1).max(20),
          schnittstelle: z.string().min(1).max(30),
          bauform:       z.string().min(1).max(20),
          menge:         z.number().int().min(1).max(10_000),
          preis:         z.number().min(0).max(100_000).nullable().optional(),
          lagerplatz:    z.string().max(50).nullable().optional(),
        }),
        z.object({
          art:        z.literal("RAM"),
          groesse:    z.string().min(1).max(20),
          generation: z.string().min(1).max(20),
          bauform:    z.string().min(1).max(20),
          menge:      z.number().int().min(1).max(10_000),
          preis:      z.number().min(0).max(100_000).nullable().optional(),
          lagerplatz: z.string().max(50).nullable().optional(),
        }),
      ])).min(1).max(50),
    }))
    .mutation(({ input, ctx }) => {
      const user = ctx.session!.user as SessionUser;
      return erfasseKomponenten({
        zeilen:      input.zeilen,
        mitarbeiter: user.kuerzel || user.name || "?",
        standortId:  resolveStandortId(ctx, input.standortId),
      });
    }),

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

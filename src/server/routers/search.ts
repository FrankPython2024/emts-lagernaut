import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { meilisearch } from "@/core/infra/meilisearch";
import type { SessionUser } from "@/core/types";
import { getZugaenglicheStandortIds } from "@/lib/auth/standortFilter";

export const searchRouter = createTRPCRouter({

  global: permissionProcedure("SUCHE_GLOBAL")
    .input(z.object({
      query:      z.string().min(1).max(100),
      limit:      z.number().int().min(1).max(20).default(5),
      standortId: z.number().int().positive().nullish(),
    }))
    .query(async ({ input, ctx }) => {
      const isAdmin     = (ctx.session.user as SessionUser).rolle === "ADMIN";
      const standortIds = getZugaenglicheStandortIds(ctx, input.standortId);
      const sFilter     = standortIds
        ? `standortId IN [${standortIds.join(",")}]`
        : undefined;

      try {
        const [artikel, modelle, anfragen, buchungen] = await Promise.all([
          meilisearch.index("artikel").search(input.query, {
            limit: input.limit,
            filter: sFilter,
            attributesToRetrieve: [
              "id", "bezeichnung", "kategorie", "bestand",
              "lagerplatz", "modell", "bestandStatus",
            ],
          }),
          meilisearch.index("modelle").search(input.query, {
            limit: input.limit,
            filter: "aktiv = true",
            attributesToRetrieve: [
              "id", "modell", "hersteller", "lagerplatz", "anzahlLogIds",
            ],
          }),
          meilisearch.index("anfragen").search(input.query, {
            limit: input.limit,
            filter: sFilter,
            attributesToRetrieve: [
              "id", "gruppenNr", "teiltyp", "geraet",
              "techniker", "status", "erstelltAm",
            ],
          }),
          meilisearch.index("buchungen").search(input.query, {
            limit: input.limit,
            filter: sFilter,
            attributesToRetrieve: [
              "id", "typ", "artikelBezeichnung", "menge",
              "ausgefuehrtVon", "datum",
            ],
          }),
        ]);

        // Lagerplatz nur für Admins — Techniker sehen ihn nicht (defense in depth)
        if (!isAdmin) {
          artikel.hits  = artikel.hits.map(h  => ({ ...h, lagerplatz: null }));
          modelle.hits  = modelle.hits.map(h  => ({ ...h, lagerplatz: null }));
        }

        return {
          artikel: {
            hits:               artikel.hits,
            estimatedTotalHits: artikel.estimatedTotalHits ?? 0,
          },
          modelle: {
            hits:               modelle.hits,
            estimatedTotalHits: modelle.estimatedTotalHits ?? 0,
          },
          anfragen: {
            hits:               anfragen.hits,
            estimatedTotalHits: anfragen.estimatedTotalHits ?? 0,
          },
          buchungen: {
            hits:               buchungen.hits,
            estimatedTotalHits: buchungen.estimatedTotalHits ?? 0,
          },
        };
      } catch (error) {
        console.error("[search.global] Meilisearch Fehler:", error);
        throw new TRPCError({
          code:    "INTERNAL_SERVER_ERROR",
          message: "Suche temporär nicht verfügbar",
        });
      }
    }),

});

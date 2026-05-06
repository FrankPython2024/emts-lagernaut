import { createTRPCRouter, protectedProcedure, adminProcedure } from "@/server/trpc";
import {
  BuchungErstellenSchema,
  BuchungListeSchema,
  BestandSyncSchema,
} from "./buchungen.schema";
import {
  erstelleBuchung,
  getBuchungsListe,
  aktualisiereBestand,
  syncAlleBestaende,
} from "./buchungen.service";

export const buchungenRouter = createTRPCRouter({

  // Neue Buchung erstellen (EINGANG / AUSGANG / DIREKT)
  erstellen: protectedProcedure
    .input(BuchungErstellenSchema)
    .mutation(async ({ input }) => {
      return erstelleBuchung(input);
    }),

  // Buchungshistorie abrufen
  liste: protectedProcedure
    .input(BuchungListeSchema)
    .query(async ({ input }) => {
      return getBuchungsListe(input);
    }),

  // Bestand einer Artikel-ID neu berechnen (Admin)
  bestandAktualisieren: adminProcedure
    .input(BestandSyncSchema.required({ artikelId: true }))
    .mutation(async ({ input }) => {
      const neuerBestand = await aktualisiereBestand(input.artikelId);
      return { artikelId: input.artikelId, neuerBestand };
    }),

  // Alle Bestände neu berechnen (Admin)
  alleBestaendeSync: adminProcedure
    .mutation(async () => {
      return syncAlleBestaende();
    }),

});

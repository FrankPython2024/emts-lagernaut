import { createTRPCRouter } from "@/server/trpc";
import { lagerRouter }           from "./lager";
import { buchungenRouter }       from "./buchungen";
import { anfragenRouter }        from "./anfragen";
import { geraeteRouter }         from "./geraete";
import { kompatibilitaetRouter } from "./kompatibilitaet";
import { warenkorbRouter }       from "./warenkorb";
import { benutzerRouter }        from "./benutzer";
import { statistikRouter }       from "./statistik";
import { lagerplaetzeRouter }    from "./lagerplaetze";

export const appRouter = createTRPCRouter({
  lager:           lagerRouter,
  buchungen:       buchungenRouter,
  anfragen:        anfragenRouter,
  geraete:         geraeteRouter,
  kompatibilitaet: kompatibilitaetRouter,
  warenkorb:       warenkorbRouter,
  benutzer:        benutzerRouter,
  statistik:       statistikRouter,
  lagerplaetze:    lagerplaetzeRouter,
});

export type AppRouter = typeof appRouter;

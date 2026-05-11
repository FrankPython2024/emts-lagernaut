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
import { geraeteLookupRouter }   from "./geraeteLookup";
import { systemRouter }          from "./system";
import { nachrichtenRouter }     from "./nachrichten";
import { chatRouter }           from "./chat";

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
  geraeteLookup:   geraeteLookupRouter,
  system:          systemRouter,
  nachrichten:     nachrichtenRouter,
  chat:            chatRouter,
});

export type AppRouter = typeof appRouter;

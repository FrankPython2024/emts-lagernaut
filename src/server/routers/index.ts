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
import { stresstestRouter }     from "./stresstest";
import { einlagernRouter }      from "./einlagern";
import { lagerplatzRouter }     from "./lagerplatz";
import { modellRouter }         from "./modell";
import { auslagernRouter }      from "./auslagern";
import { searchRouter }         from "./search";
import { dashboardRouter }         from "./dashboard";
import { userPreferencesRouter }  from "./userPreferences";
import { standortRouter }         from "./standort";
import { teiltypenRouter }        from "./teiltypen";
import { rollenRouter }           from "./rollen";
import { bestellempfehlungRouter } from "./bestellempfehlung";
import { datenbankRouter }         from "./datenbank";

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
  stresstest:      stresstestRouter,
  einlagern:       einlagernRouter,
  lagerplatz:      lagerplatzRouter,
  modell:          modellRouter,
  auslagern:       auslagernRouter,
  search:          searchRouter,
  dashboard:        dashboardRouter,
  userPreferences:  userPreferencesRouter,
  standort:         standortRouter,
  teiltypen:        teiltypenRouter,
  rollen:           rollenRouter,
  bestellempfehlung: bestellempfehlungRouter,
  datenbank:         datenbankRouter,
});

export type AppRouter = typeof appRouter;

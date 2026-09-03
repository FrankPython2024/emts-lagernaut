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
import { importSandboxRouter }     from "./importSandbox";
import { colliEtikettenRouter }     from "./colliEtiketten";
import { pickupRouter }             from "./pickup";
import { lagerwagenRouter }         from "./lagerwagen";
import { geraeteReiseRouter }       from "./geraeteReise";
import { gleicheGeraeteRouter }     from "./gleicheGeraete";
import { schrottRouter }            from "./schrott";
import { fehlteileRouter }          from "./fehlteile";
import { verbrauchsmaterialRouter }  from "./verbrauchsmaterial";
import { mobilRouter }               from "./mobil";
import { mobilAnfrageRouter }        from "./mobilAnfrage";
import { preiseRouter }              from "./preise";
import { abgabenRouter }             from "./abgaben";
import { kameratestRouter }          from "./kameratest";
import { teilenummernRouter }        from "./teilenummern";
import { geraeteFotosRouter }        from "./geraeteFotos";
import { bestellanfragenRouter }     from "./bestellanfragen";
import { impactRouter }              from "./impact";
import { erne }                      from "./ernte";

export const appRouter = createTRPCRouter({
  erne,
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
  importSandbox:     importSandboxRouter,
  colliEtiketten:    colliEtikettenRouter,
  pickup:            pickupRouter,
  lagerwagen:        lagerwagenRouter,
  geraeteReise:      geraeteReiseRouter,
  gleicheGeraete:    gleicheGeraeteRouter,
  schrott:           schrottRouter,
  fehlteile:         fehlteileRouter,
  verbrauchsmaterial: verbrauchsmaterialRouter,
  mobil:              mobilRouter,
  mobilAnfrage:       mobilAnfrageRouter,
  preise:             preiseRouter,
  abgaben:            abgabenRouter,
  kameratest:         kameratestRouter,
  teilenummern:       teilenummernRouter,
  geraeteFotos:       geraeteFotosRouter,
  bestellanfragen:    bestellanfragenRouter,
  impact:             impactRouter,
});

export type AppRouter = typeof appRouter;

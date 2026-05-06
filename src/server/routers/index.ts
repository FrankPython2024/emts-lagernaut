import { createTRPCRouter } from "@/server/trpc";

// Module-Router werden hier später eingehängt:
// import { lagerRouter } from "@/modules/lager/lager.router";
// import { buchungenRouter } from "@/modules/buchungen/buchungen.router";
// import { anfragenRouter } from "@/modules/anfragen/anfragen.router";
// import { geraeteRouter } from "@/modules/geraete/geraete.router";
// import { kompatibilitaetRouter } from "@/modules/kompatibilitaet/kompatibilitaet.router";
// import { belegeRouter } from "@/modules/belege/belege.router";
// import { statistikRouter } from "@/modules/statistik/statistik.router";
// import { warenkorbRouter } from "@/modules/warenkorb/warenkorb.router";
// import { benutzerRouter } from "@/modules/benutzer/benutzer.router";

export const appRouter = createTRPCRouter({
  // lager: lagerRouter,
  // buchungen: buchungenRouter,
  // anfragen: anfragenRouter,
  // geraete: geraeteRouter,
  // kompatibilitaet: kompatibilitaetRouter,
  // belege: belegeRouter,
  // statistik: statistikRouter,
  // warenkorb: warenkorbRouter,
  // benutzer: benutzerRouter,
});

export type AppRouter = typeof appRouter;

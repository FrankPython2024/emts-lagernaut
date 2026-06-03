// ── Import-Sandbox ────────────────────────────────────────────────────────────
//
// Zeigt read-only, wie der Geräte-Import aus rohen Werten saubere Werte erzeugt.
// REINE Berechnung — kein DB-Zugriff, keine Schreibwirkung. Nutzt die ECHTEN
// Import-Funktionen (checkHersteller + bereinigeBezeichnungTrace), keine Kopie.
//
// Verfügbar für jeden eingeloggten Nutzer (insb. ADMIN + ADMIN_READONLY/Latifa) —
// die Sichtbarkeit des Menüpunkts wird im Frontend über MODELL_VIEW gesteuert.

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import { checkHersteller, type HerstellerRegel } from "@/lib/geraete/herstellerFilter";
import { bereinigeBezeichnungTrace } from "@/lib/geraete/bezeichnungBereinigen";

export const importSandboxRouter = createTRPCRouter({
  vorschau: protectedProcedure
    .input(
      z.object({
        hersteller:  z.string().max(200),
        bezeichnung: z.string().max(1000),
      }),
    )
    .query(({ input }) => {
      // Tor A — Hersteller-Prüfung (echte Funktion).
      const h = checkHersteller(input.hersteller, input.bezeichnung);
      const hersteller = {
        erlaubt:   h.erlaubt,
        kanonisch: h.kanonisch,
        grund:     h.grund,
        regel:     (h.regel ?? "unbekannt") as HerstellerRegel,
      };

      // Abgelehnt → kein Tor B, kein Endergebnis.
      if (!h.erlaubt || !h.kanonisch) {
        return { hersteller };
      }

      // Tor B — Bezeichnung-Bereinigung (echte Funktion, mit Trace).
      const bereinigung = bereinigeBezeichnungTrace(h.kanonisch, input.bezeichnung);
      const endergebnis = `${h.kanonisch} ${bereinigung.result}`;

      return { hersteller, bereinigung, endergebnis };
    }),
});

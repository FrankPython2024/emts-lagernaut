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
import { vergleichsKern, kernTokens } from "@/lib/geraete/vergleichsKern";

// Distinktiv = enthält eine Ziffer ODER ist ein Gx-Muster. Verhindert Treffer
// allein über Allerweltswörter (z.B. "elitebook", "thinkpad", "latitude").
function istDistinktiv(token: string): boolean {
  return /\d/.test(token) || /^g\d+$/i.test(token);
}

export const importSandboxRouter = createTRPCRouter({
  vorschau: protectedProcedure
    .input(
      z.object({
        hersteller:  z.string().max(200),
        bezeichnung: z.string().max(1000),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Tor A — Hersteller-Prüfung (echte Funktion).
      const h = checkHersteller(input.hersteller, input.bezeichnung);
      const hersteller = {
        erlaubt:   h.erlaubt,
        kanonisch: h.kanonisch,
        grund:     h.grund,
        regel:     (h.regel ?? "unbekannt") as HerstellerRegel,
      };

      // Abgelehnt → kein Tor B/C, kein Endergebnis.
      if (!h.erlaubt || !h.kanonisch) {
        return { hersteller };
      }

      // Tor B — Bezeichnung-Bereinigung (echte Funktion, mit Trace).
      const bereinigung = bereinigeBezeichnungTrace(h.kanonisch, input.bezeichnung);
      const endergebnis = `${h.kanonisch} ${bereinigung.result}`;

      // Tor C — Katalog-Abgleich (read-only, nur dieselbe Marke, kein Cross-Brand).
      const inputKern   = vergleichsKern(input.bezeichnung);
      const inputTokens = new Set(kernTokens(input.bezeichnung));

      const modelle = await ctx.prisma.geraeteModell.findMany({
        where:  { hersteller: h.kanonisch, aktiv: true },
        select: { id: true, modell: true },
      });

      const kandidaten = modelle
        .map((m) => {
          const mTokens = kernTokens(m.modell);
          if (mTokens.length === 0) return null;
          const trefferTokens = mTokens.filter((t) => inputTokens.has(t));
          const score = trefferTokens.length / mTokens.length;
          return { id: m.id, modell: m.modell, score, trefferTokens };
        })
        .filter((c): c is NonNullable<typeof c> =>
          c !== null && c.score >= 0.5 && c.trefferTokens.some(istDistinktiv),
        )
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);

      const katalog = { inputKern, kandidaten };

      return { hersteller, bereinigung, endergebnis, katalog };
    }),
});

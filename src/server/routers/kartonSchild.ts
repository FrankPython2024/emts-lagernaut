import { z } from "zod";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";
import { schildSchluessel } from "@/lib/geraete/schildName";
import type { SessionUser } from "@/core/types";

// ── Karton-Beschriftungen ────────────────────────────────────────────────────
//
// Merkt sich, für welche Modelle schon ein Schild gedruckt wurde. Damit kann
// der Einlager-Assistent sagen „Schild gibt es bereits" statt jedes Mal blind
// zum Drucken aufzufordern — und ein Nachdruck bleibt trotzdem jederzeit
// möglich (Schild abgerissen, zweiter Karton, Fach gewechselt).
//
// Rechte bewusst wiederverwendet: ARTIKEL_VIEW zum Sehen, ARTIKEL_EDIT zum
// Vermerken. Kein neues Recht, kein seed-rbac nötig.
const sehen    = permissionProcedure("ARTIKEL_VIEW");
const vermerken = permissionProcedure("ARTIKEL_EDIT");

const schildInput = z.object({
  hersteller: z.string().trim().max(64).nullish(),
  serie:      z.string().trim().max(120).default(""),
  modell:     z.string().trim().max(191).default(""),
  zusatz:     z.string().trim().max(64).nullish(),
});

/** Leerer Schlüssel = nichts Sinnvolles zum Nachschlagen. */
function schluesselVon(i: z.infer<typeof schildInput>): string {
  return schildSchluessel({
    hersteller: i.hersteller ?? null,
    serie:      i.serie,
    modell:     i.modell,
    zusatz:     i.zusatz ?? "",
  });
}

export const kartonSchildRouter = createTRPCRouter({
  /** Gibt es zu diesem Modell schon ein Schild? null = noch keins. */
  pruefe: sehen
    .input(schildInput)
    .query(async ({ input }) => {
      const schluessel = schluesselVon(input);
      if (schluessel === "") return null;
      return prisma.kartonSchild.findUnique({ where: { schluessel } });
    }),

  /**
   * Mehrere auf einmal prüfen — für die Liste im Modul, damit nicht je Zeile
   * eine eigene Abfrage läuft.
   */
  pruefeViele: sehen
    .input(z.object({ schilder: z.array(schildInput).max(200) }))
    .query(async ({ input }) => {
      const schluessel = [...new Set(input.schilder.map(schluesselVon).filter((s) => s !== ""))];
      if (schluessel.length === 0) return [];
      return prisma.kartonSchild.findMany({ where: { schluessel: { in: schluessel } } });
    }),

  /**
   * Einen Druck vermerken. Beim ersten Mal wird der Eintrag angelegt, danach
   * hochgezählt und Fach/Zeitpunkt aktualisiert.
   *
   * ⚠️ Wird NACH dem Öffnen des Druckfensters aufgerufen. Ob am Drucker
   * tatsächlich Papier herauskommt, weiß der Browser nicht — „gedruckt" heißt
   * hier also „Druck ausgelöst". Das ist die ehrlichste Aussage, die möglich
   * ist, und für die Frage „gibt es das Schild schon?" genau genug.
   */
  vermerkeDruck: vermerken
    .input(z.object({ schilder: z.array(schildInput.extend({ fach: z.string().trim().max(64).nullish() })).min(1).max(200) }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      const von  = (user.kuerzel ?? user.name ?? "").slice(0, 50) || null;

      let neu = 0;
      let erneut = 0;
      for (const s of input.schilder) {
        const schluessel = schluesselVon(s);
        if (schluessel === "") continue;
        const daten = {
          hersteller: s.hersteller?.trim() || null,
          serie:      s.serie.trim(),
          modell:     s.modell.trim(),
          zusatz:     s.zusatz?.trim() || null,
          fach:       s.fach?.trim() || null,
          zuletztVon: von,
        };
        const vorher = await prisma.kartonSchild.findUnique({ where: { schluessel }, select: { id: true } });
        if (vorher) erneut++; else neu++;
        await prisma.kartonSchild.upsert({
          where:  { schluessel },
          create: { schluessel, ...daten },
          // Fach nur überschreiben, wenn diesmal eines mitkam — sonst ginge ein
          // früher vermerktes Fach beim Nachdruck ohne Fachangabe verloren.
          update: {
            ...daten,
            fach:         daten.fach ?? undefined,
            anzahlDrucke: { increment: 1 },
          },
        });
      }
      return { neu, erneut };
    }),

  /** Bereits gedruckte Schilder — für die Übersicht im Modul. */
  liste: sehen
    .input(z.object({ suche: z.string().trim().max(100).optional() }).optional())
    .query(async ({ input }) => {
      const q = input?.suche;
      return prisma.kartonSchild.findMany({
        where: q
          ? { OR: [{ modell: { contains: q } }, { serie: { contains: q } }, { hersteller: { contains: q } }] }
          : {},
        orderBy: { zuletztAm: "desc" },
        take:    200,
      });
    }),
});

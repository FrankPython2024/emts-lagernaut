import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";
import { nurZiffern } from "@/lib/format/ziffern";

// Lagerwagen-Zuordnung (Untercolli → Hauptcolli + Stellplatz). Verwaltung wie
// Pickup: Recht PICKUP_MANAGE (kein eigenes Recht nötig). Reine Zuordnung,
// KEIN Bestandseffekt.
const manage = permissionProcedure("PICKUP_MANAGE");

const CHUNK = 500;

const zeileInput = z.object({
  untercolli:  z.string(),
  hauptcolli:  z.string(),
  stellplatz:  z.string().nullish(),
  lagernummer: z.string().nullish(),
});

export const lagerwagenRouter = createTRPCRouter({

  // Aktueller Stand (für die Admin-Übersicht): Anzahl Wagen + Untercollis +
  // Zeitpunkt des letzten Imports.
  status: manage.query(async () => {
    const [untercollis, gruppen, letzte] = await Promise.all([
      prisma.lagerwagen.count(),
      prisma.lagerwagen.groupBy({ by: ["hauptcolli"], _count: { _all: true } }),
      prisma.lagerwagen.findFirst({ orderBy: { aktualisiertAm: "desc" }, select: { aktualisiertAm: true } }),
    ]);
    return { wagen: gruppen.length, untercollis, aktualisiertAm: letzte?.aktualisiertAm ?? null };
  }),

  // VOLL-Ersetzung: komplette Tabelle neu setzen (die Datei ist der vollständige
  // aktuelle Stand). Server normalisiert nochmal (nurZiffern) und dedupliziert
  // nach untercolli; Zeilen ohne Nummer/Hauptcolli fallen raus.
  importieren: manage
    .input(z.object({ zeilen: z.array(zeileInput).min(1) }))
    .mutation(async ({ input }) => {
      const seen = new Set<string>();
      const rows = input.zeilen.flatMap((zeile) => {
        const untercolli = nurZiffern(zeile.untercolli);
        const hauptcolli = nurZiffern(zeile.hauptcolli);
        if (!untercolli || !hauptcolli || seen.has(untercolli)) return [];
        seen.add(untercolli);
        return [{
          untercolli,
          hauptcolli,
          stellplatz:  zeile.stellplatz?.trim()  || null,
          lagernummer: zeile.lagernummer?.trim() || null,
        }];
      });

      if (rows.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Keine gültigen Zeilen (Nummer/Hauptcolli fehlt)" });
      }

      await prisma.$transaction(async (tx) => {
        await tx.lagerwagen.deleteMany({});
        for (let i = 0; i < rows.length; i += CHUNK) {
          await tx.lagerwagen.createMany({ data: rows.slice(i, i + CHUNK), skipDuplicates: true });
        }
      }, { timeout: 120_000 });

      const wagen = new Set(rows.map((r) => r.hauptcolli)).size;
      return { wagen, untercollis: rows.length };
    }),
});

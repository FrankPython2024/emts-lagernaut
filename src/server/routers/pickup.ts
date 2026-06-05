import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";
import type { SessionUser } from "@/core/types";
import { normalizeLogId } from "@/lib/pickup/logId";

// Verwaltung (anlegen/liste/details/löschen) erfordert PICKUP_MANAGE.
// Admin hat das über die SYSTEM_ADMIN-Wildcard. (Das Picken via PICKUP_PICK
// kommt in S3 — hier noch nicht.)
const pickupManage = permissionProcedure("PICKUP_MANAGE");

const positionInput = z.object({
  logId:       z.string(),
  colli:       z.string().nullish(),
  stellplatz:  z.string().nullish(),
  bezeichnung: z.string().nullish(),
});

export const pickupRouter = createTRPCRouter({

  // Alle Aufträge mit Zählern (gesamt/offen/gefunden), neueste zuerst.
  liste: pickupManage.query(async () => {
    const auftraege = await prisma.pickupAuftrag.findMany({
      orderBy: { createdAt: "desc" },
      include: { ersteller: { select: { name: true, kuerzel: true } } },
    });

    const counts = await prisma.pickupPosition.groupBy({
      by:     ["auftragId", "status"],
      _count: { _all: true },
    });
    const zaehler = new Map<number, { gesamt: number; offen: number; gefunden: number }>();
    for (const c of counts) {
      const e = zaehler.get(c.auftragId) ?? { gesamt: 0, offen: 0, gefunden: 0 };
      e.gesamt += c._count._all;
      if (c.status === "GEFUNDEN") e.gefunden += c._count._all;
      else                         e.offen    += c._count._all;
      zaehler.set(c.auftragId, e);
    }

    return auftraege.map((a) => ({
      id:              a.id,
      name:            a.name,
      status:          a.status,
      createdAt:       a.createdAt,
      abgeschlossenAm: a.abgeschlossenAm,
      ersteller:       a.ersteller?.kuerzel ?? a.ersteller?.name ?? "—",
      ...(zaehler.get(a.id) ?? { gesamt: 0, offen: 0, gefunden: 0 }),
    }));
  }),

  // Auftrag + alle Positionen.
  details: pickupManage
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const auftrag = await prisma.pickupAuftrag.findUnique({
        where:   { id: input.id },
        include: {
          ersteller:  { select: { name: true, kuerzel: true } },
          positionen: true,
        },
      });
      if (!auftrag) throw new TRPCError({ code: "NOT_FOUND", message: "Pickup-Auftrag nicht gefunden" });
      return auftrag;
    }),

  // Auftrag aus importierten Positionen anlegen. Server-seitig nochmal nach
  // normalisiertem logId deduppen. Transaktional.
  erstellen: pickupManage
    .input(z.object({
      name:       z.string().trim().min(1).max(200),
      positionen: z.array(positionInput).min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;

      const seen = new Set<string>();
      const positionen = input.positionen.flatMap((p) => {
        const logId = normalizeLogId(p.logId);
        if (!logId || seen.has(logId)) return [];
        seen.add(logId);
        return [{
          logId,
          colli:       p.colli?.trim()       || null,
          stellplatz:  p.stellplatz?.trim()  || null,
          bezeichnung: p.bezeichnung?.trim() || null,
          status:      "OFFEN" as const,
        }];
      });

      if (positionen.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Keine gültigen Positionen (LogId fehlt)" });
      }

      const auftrag = await prisma.$transaction(async (tx) => {
        const a = await tx.pickupAuftrag.create({
          data: { name: input.name.trim(), status: "offen", erstelltVon: user.id },
        });
        await tx.pickupPosition.createMany({
          data: positionen.map((p) => ({ ...p, auftragId: a.id })),
        });
        return a;
      });

      return { id: auftrag.id };
    }),

  // Hartes Delete — Cascade räumt die Positionen.
  loeschen: pickupManage
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await prisma.pickupAuftrag.delete({ where: { id: input.id } });
      return { ok: true };
    }),
});

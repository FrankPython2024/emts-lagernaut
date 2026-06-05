import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";
import type { SessionUser } from "@/core/types";
import { normalizeLogId } from "@/lib/pickup/logId";

// Verwaltung (anlegen/liste/details/löschen) erfordert PICKUP_MANAGE.
// Picken (Scan-Ansicht) erfordert PICKUP_PICK. Admin hat beides über die
// SYSTEM_ADMIN-Wildcard.
const pickupManage = permissionProcedure("PICKUP_MANAGE");
const pickupPick   = permissionProcedure("PICKUP_PICK");

const positionInput = z.object({
  logId:       z.string(),
  colli:       z.string().nullish(),
  stellplatz:  z.string().nullish(),
  bezeichnung: z.string().nullish(),
});

// Position für die Scan-Ansicht aufbereiten (Finder-Name auflösen).
type PosMitFinder = {
  id: number; logId: string; colli: string | null; stellplatz: string | null;
  bezeichnung: string | null; status: string; gefundenAm: Date | null;
  finder: { name: string; kuerzel: string } | null;
};
function shapePos(p: PosMitFinder) {
  return {
    id:              p.id,
    logId:           p.logId,
    colli:           p.colli,
    stellplatz:      p.stellplatz,
    bezeichnung:     p.bezeichnung,
    status:          p.status,
    gefundenVonName: p.finder?.kuerzel ?? p.finder?.name ?? null,
    gefundenAm:      p.gefundenAm,
  };
}

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
      bemerkung:       a.bemerkung,
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
      bemerkung:  z.string().max(2000).optional(),
      positionen: z.array(positionInput).min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      const bemerkung = input.bemerkung?.trim() || null;

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
          data: { name: input.name.trim(), bemerkung, status: "offen", erstelltVon: user.id },
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

  // ── Picken (PICKUP_PICK) ──────────────────────────────────────────────────

  // Auftrag + Positionen für die Scan-Ansicht (inkl. Finder-Name + gefundenAm).
  pickDetails: pickupPick
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const auftrag = await prisma.pickupAuftrag.findUnique({
        where:   { id: input.id },
        include: { positionen: { include: { finder: { select: { name: true, kuerzel: true } } } } },
      });
      if (!auftrag) throw new TRPCError({ code: "NOT_FOUND", message: "Pickup-Auftrag nicht gefunden" });
      const positionen = auftrag.positionen.map(shapePos);
      return {
        id:        auftrag.id,
        name:      auftrag.name,
        bemerkung: auftrag.bemerkung,
        status:    auftrag.status,
        createdAt: auftrag.createdAt,
        gesamt:    positionen.length,
        gefunden:  positionen.filter((p) => p.status === "GEFUNDEN").length,
        positionen,
      };
    }),

  // Ein Scan. EXAKTE LogID-Zuordnung (kein fuzzy). Kein Bestand-Effekt.
  scan: pickupPick
    .input(z.object({ auftragId: z.number().int().positive(), logIdRaw: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const user  = ctx.session.user as SessionUser;
      const logId = normalizeLogId(input.logIdRaw);
      if (!logId) return { result: "FREMD" as const, logId: "", position: null };

      const pos = await prisma.pickupPosition.findFirst({
        where:   { auftragId: input.auftragId, logId },
        include: { finder: { select: { name: true, kuerzel: true } } },
      });

      // Nicht auf dieser Liste → NICHTS in der DB ändern.
      if (!pos) return { result: "FREMD" as const, logId, position: null };

      // Schon gefunden → nur melden.
      if (pos.status === "GEFUNDEN") {
        return { result: "SCHON" as const, logId, position: shapePos(pos) };
      }

      // OFFEN → als GEFUNDEN persistieren.
      const updated = await prisma.pickupPosition.update({
        where:   { id: pos.id },
        data:    { status: "GEFUNDEN", gefundenVon: user.id, gefundenAm: new Date() },
        include: { finder: { select: { name: true, kuerzel: true } } },
      });
      return { result: "GEFUNDEN" as const, logId, position: shapePos(updated) };
    }),

  // Versehentlichen Treffer zurücksetzen: GEFUNDEN → OFFEN.
  treffersZuruecksetzen: pickupPick
    .input(z.object({ positionId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await prisma.pickupPosition.update({
        where: { id: input.positionId },
        data:  { status: "OFFEN", gefundenVon: null, gefundenAm: null },
      });
      return { ok: true };
    }),
});

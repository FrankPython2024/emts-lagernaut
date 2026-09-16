import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import type { SessionUser } from "@/core/types";

// ── Notizbuch ────────────────────────────────────────────────────────────────
// Sammellisten für alles, was sonst auf einem Zettel landet: LogIDs
// hintereinander scannen, Barcodes, Inventarnummern. Jede Notiz hat einen
// Titel, einen Freitext und eine Liste gescannter Einträge.
//
// Sichtbar für alle mit NOTIZBUCH_VIEW. Schreiben braucht NOTIZBUCH_EDIT —
// BETRACHTER und ADMIN_READONLY sind ausdrücklich Rollen ohne Schreibrechte.
// ⚠️ Braucht einen seed-rbac-Lauf nach dem Deploy.
const lesen     = permissionProcedure("NOTIZBUCH_VIEW");
const schreiben = permissionProcedure("NOTIZBUCH_EDIT");

function kuerzelVon(ctx: { session: { user?: unknown } }): string {
  return ((ctx.session.user as SessionUser | undefined)?.kuerzel ?? "?").slice(0, 50);
}

/** Wie viele Einträge ein einzelner Aufruf höchstens anlegt (Einfügen einer Liste). */
const MAX_JE_AUFRUF = 500;

export const notizbuchRouter = createTRPCRouter({

  liste: lesen
    .input(z.object({ suche: z.string().max(100).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const suche = input?.suche?.trim();
      const notizen = await ctx.prisma.notiz.findMany({
        where: suche
          ? { OR: [{ titel: { contains: suche } }, { text: { contains: suche } }] }
          : undefined,
        // Zuletzt benutzte oben — ein neuer Scan zählt als Benutzung.
        orderBy: { updatedAt: "desc" },
        select: {
          id: true, titel: true, text: true, erstelltVon: true, geaendertVon: true,
          createdAt: true, updatedAt: true,
          _count: { select: { eintraege: true } },
        },
      });
      return notizen.map(({ _count, text, ...n }) => ({
        ...n,
        anzahl:   _count.eintraege,
        // Nur ein Anriss für die Übersicht — der volle Text kommt mit `get`.
        vorschau: (text ?? "").replace(/\s+/g, " ").trim().slice(0, 140),
      }));
    }),

  get: lesen
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const notiz = await ctx.prisma.notiz.findUnique({
        where:   { id: input.id },
        include: { eintraege: { orderBy: { id: "asc" } } },
      });
      if (!notiz) throw new TRPCError({ code: "NOT_FOUND", message: "Notiz nicht gefunden." });
      return { ...notiz, textStand: notiz.textStand.getTime() };
    }),

  anlegen: schreiben
    .input(z.object({ titel: z.string().trim().min(1, "Titel fehlt").max(191) }))
    .mutation(async ({ ctx, input }) => {
      const k = kuerzelVon(ctx);
      return ctx.prisma.notiz.create({
        data:   { titel: input.titel, erstelltVon: k, geaendertVon: k },
        select: { id: true },
      });
    }),

  /**
   * Titel und Freitext speichern.
   *
   * ⚠️ Notizen sind für alle sichtbar — zwei Personen können dieselbe gleichzeitig
   * offen haben. Ohne Prüfung würde der Zweite den Text des Ersten still
   * überschreiben. `stand` ist der `textStand`, den die Oberfläche beim Laden
   * gesehen hat; weicht er ab, wird abgelehnt und die Person genannt.
   */
  speichern: schreiben
    .input(z.object({
      id:    z.number().int().positive(),
      titel: z.string().trim().min(1, "Titel fehlt").max(191),
      text:  z.string().max(100_000),
      stand: z.number().int(),
    }))
    .mutation(async ({ ctx, input }) => {
      const k = kuerzelVon(ctx);
      const res = await ctx.prisma.notiz.updateMany({
        where: { id: input.id, textStand: new Date(input.stand) },
        data:  { titel: input.titel, text: input.text || null, geaendertVon: k, textStand: new Date() },
      });
      if (res.count === 0) {
        const aktuell = await ctx.prisma.notiz.findUnique({
          where: { id: input.id }, select: { geaendertVon: true },
        });
        if (!aktuell) throw new TRPCError({ code: "NOT_FOUND", message: "Die Notiz wurde inzwischen gelöscht." });
        throw new TRPCError({
          code:    "CONFLICT",
          message: `Die Notiz wurde inzwischen von ${aktuell.geaendertVon ?? "jemand anderem"} geändert. `
                 + "Bitte neu laden. Dein Text bleibt im Feld stehen, damit nichts verloren geht.",
        });
      }
      const neu = await ctx.prisma.notiz.findUniqueOrThrow({ where: { id: input.id }, select: { textStand: true } });
      return { stand: neu.textStand.getTime() };
    }),

  /**
   * Einen oder mehrere Werte anhängen. Mehrere entstehen, wenn jemand eine Liste
   * ins Scanfeld einfügt — jede Zeile wird ein Eintrag.
   * Doppelte werden NICHT abgelehnt (mitzählen kann gewollt sein), aber gemeldet.
   */
  eintraegeHinzufuegen: schreiben
    .input(z.object({
      notizId: z.number().int().positive(),
      werte:   z.array(z.string()).min(1).max(MAX_JE_AUFRUF),
    }))
    .mutation(async ({ ctx, input }) => {
      const werte = input.werte.map((w) => w.trim()).filter((w) => w.length > 0);
      if (werte.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Leerer Eintrag." });
      if (werte.some((w) => w.length > 500)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Ein Eintrag ist länger als 500 Zeichen." });
      }

      const k = kuerzelVon(ctx);
      return ctx.prisma.$transaction(async (tx) => {
        const notiz = await tx.notiz.findUnique({ where: { id: input.notizId }, select: { id: true } });
        if (!notiz) throw new TRPCError({ code: "NOT_FOUND", message: "Notiz nicht gefunden." });

        const vorhanden = await tx.notizEintrag.findMany({
          where:  { notizId: input.notizId, wert: { in: [...new Set(werte)] } },
          select: { wert: true },
        });
        const schonDa = new Set(vorhanden.map((v) => v.wert));

        // Einzeln statt createMany: MySQL liefert bei createMany keine Ids zurück,
        // die Oberfläche soll die neuen Einträge aber markieren können.
        const angelegt: { id: number; wert: string }[] = [];
        const imAufruf = new Set<string>();
        const doppelt  = new Set<string>();
        for (const wert of werte) {
          if (schonDa.has(wert) || imAufruf.has(wert)) doppelt.add(wert);
          imAufruf.add(wert);
          angelegt.push(await tx.notizEintrag.create({
            data:   { notizId: input.notizId, wert, erfasstVon: k },
            select: { id: true, wert: true },
          }));
        }
        // Rückt die Notiz in der Übersicht nach oben, OHNE textStand zu berühren.
        await tx.notiz.update({ where: { id: input.notizId }, data: { geaendertVon: k } });
        return { angelegt, doppelt: [...doppelt] };
      // 500 einzelne Inserts sprengen Prismas Standard-Zeitlimit von 5 s auf dem 4-GB-Server.
      }, { timeout: 30_000 });
    }),

  eintragAendern: schreiben
    .input(z.object({ id: z.number().int().positive(), wert: z.string().trim().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const k = kuerzelVon(ctx);
      const e = await ctx.prisma.notizEintrag.update({
        where: { id: input.id }, data: { wert: input.wert }, select: { notizId: true },
      });
      await ctx.prisma.notiz.update({ where: { id: e.notizId }, data: { geaendertVon: k } });
      return { ok: true };
    }),

  eintragLoeschen: schreiben
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const k = kuerzelVon(ctx);
      const e = await ctx.prisma.notizEintrag.delete({ where: { id: input.id }, select: { notizId: true } });
      await ctx.prisma.notiz.update({ where: { id: e.notizId }, data: { geaendertVon: k } });
      return { ok: true };
    }),

  /** Notiz samt aller Einträge löschen. Die Oberfläche fragt vorher nach. */
  loeschen: schreiben
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.notiz.delete({ where: { id: input.id } });
      return { ok: true };
    }),
});

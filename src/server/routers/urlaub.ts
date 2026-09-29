import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";
import type { SessionUser } from "@/core/types";
import { URLAUB_TEAM_IDS, darfBearbeiten, istImUrlaubTeam } from "@/lib/urlaub/team";
import {
  ABWESENHEIT_ARTEN, STATUS, arbeitstage, freieTage, istGueltigesDatum, ueberschneiden, urlaubskonto,
} from "@/lib/urlaub/tage";
import { URLAUBSARTEN } from "@/lib/urlaub/antrag";

// ── Urlaubsplanung (29.09.2026) ───────────────────────────────────────────────
// Nur für die drei Konten aus src/lib/urlaub/team.ts — geprüft bei JEDEM Aufruf,
// nicht nur im Menü. Lesen dürfen alle drei alles; SCHREIBEN (eintragen, ändern,
// löschen, geplant/genehmigt, Anspruch) jeder nur bei sich selbst — `darfBearbeiten`.
// Vorher konnte z. B. Ronny bei Frank eintragen (Frank, 29.09.2026).

const team = protectedProcedure.use(({ ctx, next }) => {
  const user = ctx.session.user as SessionUser;
  if (!istImUrlaubTeam(user.id)) throw new TRPCError({ code: "FORBIDDEN", message: "Kein Zugang zur Urlaubsplanung." });
  return next({ ctx });
});

const ichVon = (ctx: { session: { user?: unknown } }) => Number((ctx.session.user as SessionUser | undefined)?.id);
function nurEigene(ctx: { session: { user?: unknown } }, besitzer: number) {
  if (!darfBearbeiten(ichVon(ctx), besitzer)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Du kannst nur deine eigenen Einträge bearbeiten." });
  }
}

const kuerzelVon = (ctx: { session: { user?: unknown } }) =>
  ((ctx.session.user as SessionUser | undefined)?.kuerzel ?? "?").slice(0, 50);

// @db.Date kommt als UTC-Mitternacht zurück — der Kalendertag ist damit genau
// der ISO-Datumsteil. (Nur für @db.Date so richtig, nicht für Zeitstempel!)
const alsTag = (d: Date) => d.toISOString().slice(0, 10);
const alsDate = (tag: string) => new Date(`${tag}T00:00:00.000Z`);

const datum = z.string().refine(istGueltigesDatum, "Ungültiges Datum");

const eintragInput = z.object({
  id:        z.number().int().positive().optional(),
  userId:    z.number().int().positive(),
  art:       z.enum(ABWESENHEIT_ARTEN),
  von:       datum,
  bis:       datum,
  halberTag: z.boolean(),
  status:    z.enum(STATUS),
  notiz:     z.string().max(500).nullable(),
  // Nur bei URLAUB; sonst ignoriert.
  urlaubsart:  z.enum(URLAUBSARTEN).nullable().default(null),
  sondergrund: z.string().trim().max(200).nullable().default(null),
}).refine((e) => e.von <= e.bis, { message: "„Bis“ liegt vor „von“." })
  .refine((e) => e.art !== "URLAUB" || e.urlaubsart !== "SONDER" || !!e.sondergrund, { message: "Bitte den Grund für den Sonderurlaub angeben." })
  .refine((e) => !e.halberTag || e.von === e.bis, { message: "Einen halben Tag gibt es nur für einen einzelnen Tag." })
  .refine((e) => e.bis <= `${Number(e.von.slice(0, 4)) + 1}-12-31`, { message: "Ein Eintrag darf höchstens bis Ende des Folgejahres gehen." });

type EintragRoh = {
  id: number; userId: number; art: string; von: Date; bis: Date; halberTag: boolean; status: string;
  notiz: string | null; erstelltVon: string; geaendertVon: string | null; genehmigtVon: string | null; genehmigtAm: Date | null;
  urlaubsart: string | null; sondergrund: string | null;
};
function shape(e: EintragRoh) {
  const z = { von: alsTag(e.von), bis: alsTag(e.bis), halberTag: e.halberTag };
  return { ...e, ...z, tage: arbeitstage(z) };
}

/** Wer ist im selben Zeitraum schon weg (andere Personen, an Arbeitstagen)? */
async function ueberschneidungen(e: { id?: number; userId: number; von: string; bis: string }) {
  const kandidaten = await prisma.abwesenheit.findMany({
    where: { userId: { not: e.userId }, von: { lte: alsDate(e.bis) }, bis: { gte: alsDate(e.von) }, ...(e.id ? { id: { not: e.id } } : {}) },
  });
  const namen = new Map((await prisma.user.findMany({ where: { id: { in: [...URLAUB_TEAM_IDS] } }, select: { id: true, name: true, kuerzel: true } }))
    .map((u) => [u.id, u.kuerzel === "FRANK" ? "Frank" : u.name]));
  return kandidaten
    .filter((k) => ueberschneiden({ von: e.von, bis: e.bis }, { von: alsTag(k.von), bis: alsTag(k.bis) }))
    .map((k) => ({ id: k.id, wer: namen.get(k.userId) ?? `#${k.userId}`, art: k.art, von: alsTag(k.von), bis: alsTag(k.bis) }));
}

export const urlaubRouter = createTRPCRouter({

  // Alles für ein Jahr: Team, Einträge (auch die, die ins Jahr hineinragen),
  // Anspruch und Konto je Person, Feiertage.
  uebersicht: team
    .input(z.object({ jahr: z.number().int().min(2020).max(2100) }))
    .query(async ({ ctx, input }) => {
      const { jahr } = input;
      const [nutzer, eintraege, ansprueche] = await Promise.all([
        prisma.user.findMany({ where: { id: { in: [...URLAUB_TEAM_IDS] } }, select: { id: true, name: true, kuerzel: true } }),
        prisma.abwesenheit.findMany({
          where: { von: { lte: alsDate(`${jahr}-12-31`) }, bis: { gte: alsDate(`${jahr}-01-01`) } },
          orderBy: [{ von: "asc" }, { userId: "asc" }],
        }),
        prisma.urlaubAnspruch.findMany({ where: { jahr } }),
      ]);
      const reihenfolge = new Map(URLAUB_TEAM_IDS.map((id, i) => [id, i]));
      const personen = nutzer
        .sort((a, b) => (reihenfolge.get(a.id) ?? 9) - (reihenfolge.get(b.id) ?? 9))
        .map((u) => {
          const a = ansprueche.find((x) => x.userId === u.id);
          const anspruch = a ? Number(a.tage) : 0;
          const uebertrag = a ? Number(a.uebertrag) : 0;
          const eigene = eintraege.filter((e) => e.userId === u.id)
            .map((e) => ({ art: e.art, status: e.status, urlaubsart: e.urlaubsart, von: alsTag(e.von), bis: alsTag(e.bis), halberTag: e.halberTag }));
          return {
            id: u.id,
            name: u.kuerzel === "FRANK" ? "Frank" : u.name,
            kuerzel: u.kuerzel === "FRANK" ? "FS" : u.kuerzel,
            anspruchGesetzt: !!a,
            konto: urlaubskonto({ anspruch, uebertrag, eintraege: eigene, jahr }),
          };
        });
      // Antragsangaben nur die EIGENEN — Personalnummern der anderen gehen niemanden an.
      const meineStammdaten = await prisma.urlaubStammdaten.findUnique({ where: { userId: ichVon(ctx) } });
      return {
        jahr,
        meineStammdaten,
        personen,
        eintraege: eintraege.map(shape),
        feiertage: [...freieTage(jahr)].map(([tag, name]) => ({ tag, name })),
      };
    }),

  // Vorab prüfen, ob sich ein Eintrag mit anderen überschneidet (Warnung im Dialog).
  pruefen: team
    .input(z.object({ id: z.number().int().positive().optional(), userId: z.number().int().positive(), von: datum, bis: datum }))
    .query(({ input }) => (input.von <= input.bis ? ueberschneidungen(input) : [])),

  speichern: team
    .input(eintragInput)
    .mutation(async ({ ctx, input }) => {
      nurEigene(ctx, input.userId);
      if (arbeitstage({ von: input.von, bis: input.bis }) === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Im Zeitraum liegt kein Arbeitstag — nur Wochenende oder freie Tage." });
      }
      const wer = kuerzelVon(ctx);
      const genehmigt = input.status === "GENEHMIGT";
      const istUrlaub = input.art === "URLAUB";
      const daten = {
        userId: input.userId, art: input.art, von: alsDate(input.von), bis: alsDate(input.bis),
        halberTag: input.halberTag, notiz: input.notiz?.trim() || null,
        urlaubsart:  istUrlaub ? (input.urlaubsart ?? "ERHOLUNG") : null,
        sondergrund: istUrlaub && input.urlaubsart === "SONDER" ? (input.sondergrund?.trim() || null) : null,
      };
      let id: number;
      if (input.id) {
        const alt = await prisma.abwesenheit.findUnique({ where: { id: input.id } });
        if (!alt) throw new TRPCError({ code: "NOT_FOUND", message: "Eintrag nicht gefunden" });
        // Auch der BESTEHENDE Eintrag muss meiner sein — sonst ließe sich ein
        // fremder Eintrag „umschreiben", indem man die eigene userId mitschickt.
        nurEigene(ctx, alt.userId);
        // Genehmigt war ein bestimmter Zeitraum. Der Dialog stellt deshalb bei
        // jeder Zeitänderung auf „geplant" zurück; wer danach wieder „genehmigt"
        // wählt, wird als neuer Genehmiger vermerkt.
        const zeitGeaendert = alsTag(alt.von) !== input.von || alsTag(alt.bis) !== input.bis
          || alt.halberTag !== input.halberTag || alt.userId !== input.userId || alt.art !== input.art
          || (alt.urlaubsart ?? "ERHOLUNG") !== (daten.urlaubsart ?? "ERHOLUNG");
        const neuGenehmigt = genehmigt && (alt.status !== "GENEHMIGT" || zeitGeaendert);
        await prisma.abwesenheit.update({
          where: { id: input.id },
          data: {
            ...daten, geaendertVon: wer, status: input.status,
            ...(!genehmigt ? { genehmigtVon: null, genehmigtAm: null }
              : neuGenehmigt ? { genehmigtVon: wer, genehmigtAm: new Date() } : {}),
          },
        });
        id = input.id;
      } else {
        const neu = await prisma.abwesenheit.create({
          data: {
            ...daten, erstelltVon: wer, status: input.status,
            ...(genehmigt ? { genehmigtVon: wer, genehmigtAm: new Date() } : {}),
          },
        });
        id = neu.id;
      }
      return { id, ueberschneidungen: await ueberschneidungen({ id, userId: input.userId, von: input.von, bis: input.bis }) };
    }),

  // Schnell umschalten: geplant ↔ genehmigt.
  status: team
    .input(z.object({ id: z.number().int().positive(), status: z.enum(STATUS) }))
    .mutation(async ({ ctx, input }) => {
      const e = await prisma.abwesenheit.findUnique({ where: { id: input.id }, select: { userId: true } });
      if (!e) throw new TRPCError({ code: "NOT_FOUND", message: "Eintrag nicht gefunden" });
      nurEigene(ctx, e.userId);
      const wer = kuerzelVon(ctx);
      await prisma.abwesenheit.update({
        where: { id: input.id },
        data: input.status === "GENEHMIGT"
          ? { status: "GENEHMIGT", genehmigtVon: wer, genehmigtAm: new Date(), geaendertVon: wer }
          : { status: "GEPLANT", genehmigtVon: null, genehmigtAm: null, geaendertVon: wer },
      });
      return { ok: true };
    }),

  loeschen: team
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const e = await prisma.abwesenheit.findUnique({ where: { id: input.id }, select: { userId: true } });
      if (!e) throw new TRPCError({ code: "NOT_FOUND", message: "Eintrag nicht gefunden" });
      nurEigene(ctx, e.userId);
      await prisma.abwesenheit.delete({ where: { id: input.id } });
      return { ok: true };
    }),

  // Angaben für den Urlaubsantrag — nur die eigenen.
  stammdatenSetzen: team
    .input(z.object({
      nachname:       z.string().trim().min(1).max(100),
      vorname:        z.string().trim().min(1).max(100),
      personalnummer: z.string().trim().min(1).max(30),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ichVon(ctx);
      await prisma.urlaubStammdaten.upsert({ where: { userId }, create: { userId, ...input }, update: input });
      return { ok: true };
    }),

  // Urlaubsanspruch je Person und Jahr (+ Übertrag aus dem Vorjahr), halbe Tage erlaubt.
  anspruchSetzen: team
    .input(z.object({
      userId:    z.number().int().positive(),
      jahr:      z.number().int().min(2020).max(2100),
      tage:      z.number().min(0).max(60).multipleOf(0.5),
      uebertrag: z.number().min(0).max(60).multipleOf(0.5),
    }))
    .mutation(async ({ ctx, input }) => {
      nurEigene(ctx, input.userId);
      const daten = { tage: input.tage, uebertrag: input.uebertrag, geaendertVon: kuerzelVon(ctx) };
      await prisma.urlaubAnspruch.upsert({
        where:  { userId_jahr: { userId: input.userId, jahr: input.jahr } },
        create: { userId: input.userId, jahr: input.jahr, ...daten },
        update: daten,
      });
      return { ok: true };
    }),
});

import { z } from "zod";
import { BuchungsTyp } from "@prisma/client";
import { createTRPCRouter, adminProcedure, permissionProcedure } from "@/server/trpc";
import { abgeben, auswertung } from "@/modules/abgaben/service";
import type { SessionUser } from "@/core/types";

// ── Material-Abgaben an andere Niederlassungen ───────────────────────────────
// Lesen: ARTIKEL_VIEW (wer den Bestand sehen darf, darf auch sehen was rausging).
// Schreiben: ADMIN — eine Abgabe verändert echten Bestand.
// Bewusst KEIN neues Recht → kein seed-rbac nötig.
const leseProcedure = permissionProcedure("ARTIKEL_VIEW");

export const abgabenRouter = createTRPCRouter({

  // ── Niederlassungen (Stammdaten) ──────────────────────────────────────────

  niederlassungen: leseProcedure
    .input(z.object({ nurAktive: z.boolean().default(false) }).optional())
    .query(({ ctx, input }) =>
      ctx.prisma.niederlassung.findMany({
        where:   input?.nurAktive ? { aktiv: true } : {},
        orderBy: [{ aktiv: "desc" }, { name: "asc" }],
      }),
    ),

  niederlassungAnlegen: adminProcedure
    .input(z.object({
      name:     z.string().min(1).max(120).trim(),
      kurzname: z.string().max(20).trim().optional(),
      adresse:  z.string().max(500).trim().optional(),
      notiz:    z.string().max(500).trim().optional(),
    }))
    .mutation(({ ctx, input }) =>
      ctx.prisma.niederlassung.create({
        data: {
          name:     input.name,
          kurzname: input.kurzname || null,
          adresse:  input.adresse  || null,
          notiz:    input.notiz    || null,
        },
      }),
    ),

  niederlassungAendern: adminProcedure
    .input(z.object({
      id:       z.number().int().positive(),
      name:     z.string().min(1).max(120).trim().optional(),
      kurzname: z.string().max(20).trim().nullish(),
      adresse:  z.string().max(500).trim().nullish(),
      notiz:    z.string().max(500).trim().nullish(),
      aktiv:    z.boolean().optional(),
    }))
    .mutation(({ ctx, input }) => {
      const { id, ...rest } = input;
      return ctx.prisma.niederlassung.update({ where: { id }, data: rest });
    }),

  // Löschen nur, wenn nie etwas dorthin ging — sonst verlöre die Auswertung
  // ihren Bezug. Stattdessen auf inaktiv setzen.
  niederlassungLoeschen: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const anzahl = await ctx.prisma.buchung.count({ where: { niederlassungId: input.id } });
      if (anzahl > 0) {
        return {
          geloescht: false as const,
          hinweis:   `Es gibt ${anzahl} Abgaben an diese Niederlassung — sie wurde stattdessen auf „inaktiv" gesetzt.`,
          ...(await ctx.prisma.niederlassung.update({ where: { id: input.id }, data: { aktiv: false } })),
        };
      }
      await ctx.prisma.niederlassung.delete({ where: { id: input.id } });
      return { geloescht: true as const, hinweis: null };
    }),

  // ── Abgabe buchen ─────────────────────────────────────────────────────────

  abgeben: adminProcedure
    .input(z.object({
      artikelId:       z.number().int().positive(),
      menge:           z.number().int().positive().max(10_000),
      niederlassungId: z.number().int().positive(),
      notiz:           z.string().max(500).optional(),
    }))
    .mutation(({ ctx, input }) => {
      const user = ctx.session!.user as SessionUser;
      return abgeben({ ...input, mitarbeiter: user.kuerzel || user.name || "?" });
    }),

  // ── Historie & Auswertung ─────────────────────────────────────────────────

  letzte: leseProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional())
    .query(({ ctx, input }) =>
      ctx.prisma.buchung.findMany({
        where:   { niederlassungId: { not: null }, typ: BuchungsTyp.AUSGANG },
        select: {
          id: true, datum: true, menge: true, mitarbeiter: true, notiz: true,
          artikel: {
            select: {
              id: true, bezeichnung: true, kategorie: true, preis: true,
              standort: { select: { name: true, adresse: true } },
            },
          },
          niederlassung: { select: { id: true, name: true, adresse: true } },
        },
        orderBy: { datum: "desc" },
        take:    input?.limit ?? 50,
      }).then(async (rows) => {
        // Kategoriepreise als Rückfall, damit der Nachdruck denselben Wert zeigt
        // wie beim Buchen. Decimal → Zahl, weil superjson Decimal nicht überträgt.
        const kategorien = Array.from(new Set(rows.map((r) => r.artikel.kategorie)));
        const katPreise = new Map(
          (await ctx.prisma.kategoriePreis.findMany({
            where: { kategorie: { in: kategorien } }, select: { kategorie: true, preis: true },
          })).map((k) => [k.kategorie, Number(k.preis)]),
        );
        return rows.map((r) => ({
          ...r,
          artikel: {
            ...r.artikel,
            preis: r.artikel.preis != null
              ? Number(r.artikel.preis)
              : katPreise.get(r.artikel.kategorie) ?? null,
          },
        }));
      }),
    ),

  auswertung: leseProcedure
    .input(z.object({
      tage:       z.number().int().positive().nullable().optional(),
      standortId: z.number().int().positive().nullable().optional(),
    }).optional())
    .query(({ input }) => auswertung({
      tage:       input?.tage ?? null,
      standortId: input?.standortId ?? null,
    })),
});

import { z } from "zod";
import sanitizeHtml from "sanitize-html";
import { createTRPCRouter, protectedProcedure, permissionProcedure } from "@/server/trpc";
import type { SessionUser } from "@/core/types";

// Sanitize-Konfiguration für die WYSIWYG-Labels (Schrank + Freitext). Bewusst
// SEHR eng: nur die von TipTap erzeugbaren Block-/Inline-Tags. Alles andere
// (script, img, style, font, a, …) wird verworfen, der Textinhalt bleibt erhalten.
// TipTap: fett=<strong>, kursiv=<em>; b/i werden zur Sicherheit auf strong/em
// normalisiert. span ist nur mit reinem font-size-Style erlaubt (FontSize → px).
const SCHRANK_SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "em", "b", "i", "ul", "ol", "li", "h1", "h2", "h3", "span"],
  allowedAttributes: { span: ["style"] },
  allowedStyles: {
    span: { "font-size": [/^\d{1,3}(\.\d+)?(px|pt|em|rem|%)$/] },
  },
  transformTags: {
    b: "strong",
    i: "em",
  },
  allowedSchemes: [],
  disallowedTagsMode: "discard",
};

export const colliEtikettenRouter = createTRPCRouter({
  // Druck-Nutzung protokollieren. Bewusst protectedProcedure (NICHT adminProcedure),
  // damit auch BETRACHTER protokolliert werden. Ein Event pro Druckvorgang
  // (Stapel oder Einzel) + anzahl Etiketten — Dashboard kann später wahlweise
  // Druckvorgänge oder Etiketten-Summe zeigen.
  protokolliereDruck: protectedProcedure
    .input(z.object({
      modus:  z.enum(["colli", "text", "schrank"]),
      anzahl: z.number().int().positive().max(100_000),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      await ctx.prisma.colliDruckLog.create({
        data: { userId: user.id, modus: input.modus, anzahl: input.anzahl },
      });
      return { ok: true };
    }),

  // Schrank-Beschriftung: WYSIWYG-HTML SERVERSEITIG sanitizen, bevor es client-
  // seitig ins Druck-Template geschrieben wird (Schutz gegen eingeschleustes
  // Markup/Script). Gibt das bereinigte HTML zurück. Gleiche Zugriffsgrenze wie
  // das Tool selbst (COLLI_ETIKETTEN_VIEW).
  sanitizeSchrank: permissionProcedure("COLLI_ETIKETTEN_VIEW")
    .input(z.object({ html: z.string().max(50_000) }))
    .mutation(async ({ input }) => {
      return { html: sanitizeHtml(input.html, SCHRANK_SANITIZE) };
    }),

  // ── Speicherbare Label-Vorlagen (geteilt & dauerhaft) — nur Schrank + Text ──
  // Alle nach typ gefiltert, gleiche Zugriffsgrenze wie das Tool.

  // Liste der Vorlagen eines Typs (id, name, updatedAt), nach Name sortiert.
  vorlagenListe: permissionProcedure("COLLI_ETIKETTEN_VIEW")
    .input(z.object({ typ: z.enum(["schrank", "text"]) }))
    .query(async ({ input, ctx }) => {
      return ctx.prisma.labelVorlage.findMany({
        where:   { typ: input.typ },
        select:  { id: true, name: true, updatedAt: true },
        orderBy: { name: "asc" },
      });
    }),

  // Vorlage speichern — upsert per (typ, name): existierender Name wird überschrieben.
  vorlageSpeichern: permissionProcedure("COLLI_ETIKETTEN_VIEW")
    .input(z.object({
      typ:          z.enum(["schrank", "text"]),
      name:         z.string().trim().min(1).max(120),
      html:         z.string().max(100_000),
      orientierung: z.enum(["quer", "hoch"]).optional(),
      qrAktiv:      z.boolean().optional(),
      stellplatz:   z.string().max(200).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const daten = {
        html:         input.html,
        orientierung: input.orientierung ?? null,
        qrAktiv:      input.qrAktiv ?? false,
        stellplatz:   input.stellplatz ?? null,
      };
      return ctx.prisma.labelVorlage.upsert({
        where:  { typ_name: { typ: input.typ, name: input.name } },
        update: daten,
        create: { typ: input.typ, name: input.name, ...daten },
        select: { id: true, name: true },
      });
    }),

  // Eine Vorlage vollständig laden.
  vorlageLaden: permissionProcedure("COLLI_ETIKETTEN_VIEW")
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.prisma.labelVorlage.findUnique({ where: { id: input.id } });
    }),

  // Vorlage löschen.
  vorlageLoeschen: permissionProcedure("COLLI_ETIKETTEN_VIEW")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.prisma.labelVorlage.delete({ where: { id: input.id } });
      return { ok: true };
    }),
});

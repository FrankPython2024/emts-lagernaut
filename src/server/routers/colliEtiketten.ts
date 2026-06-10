import { z } from "zod";
import sanitizeHtml from "sanitize-html";
import { createTRPCRouter, protectedProcedure, permissionProcedure } from "@/server/trpc";
import type { SessionUser } from "@/core/types";

// Sanitize-Konfiguration für die Schrank-Beschriftung. Bewusst SEHR eng:
// nur die im Editor erzeugbaren Block-/Inline-Tags. Alles andere (script, img,
// style, font, a, …) wird verworfen, der Textinhalt bleibt erhalten.
// b/i werden auf strong/em normalisiert (manche Browser liefern via execCommand
// noch b/i). span ist nur mit reinem font-size-Style erlaubt.
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
});

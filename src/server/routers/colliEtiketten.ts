import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import type { SessionUser } from "@/core/types";

export const colliEtikettenRouter = createTRPCRouter({
  // Druck-Nutzung protokollieren. Bewusst protectedProcedure (NICHT adminProcedure),
  // damit auch BETRACHTER protokolliert werden. Ein Event pro Druckvorgang
  // (Stapel oder Einzel) + anzahl Etiketten — Dashboard kann später wahlweise
  // Druckvorgänge oder Etiketten-Summe zeigen.
  protokolliereDruck: protectedProcedure
    .input(z.object({
      modus:  z.enum(["colli", "text"]),
      anzahl: z.number().int().positive().max(100_000),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      await ctx.prisma.colliDruckLog.create({
        data: { userId: user.id, modus: input.modus, anzahl: input.anzahl },
      });
      return { ok: true };
    }),
});

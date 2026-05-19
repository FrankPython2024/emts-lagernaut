import { z } from "zod";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "@/server/trpc";

export const standortRouter = createTRPCRouter({

  list: protectedProcedure
    .query(async ({ ctx }) => {
      return ctx.prisma.standort.findMany({
        where:   { aktiv: true },
        orderBy: { name: "asc" },
        select:  { id: true, name: true, kurzname: true, aktiv: true },
      });
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.standort.findUnique({ where: { id: input.id } });
    }),

  create: adminProcedure
    .input(z.object({
      name:     z.string().min(2).max(100),
      kurzname: z.string().min(2).max(10),
      adresse:  z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.standort.create({ data: input });
    }),

  update: adminProcedure
    .input(z.object({
      id:       z.number().int().positive(),
      name:     z.string().min(2).max(100).optional(),
      kurzname: z.string().min(2).max(10).optional(),
      adresse:  z.string().max(500).optional(),
      aktiv:    z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      return ctx.prisma.standort.update({ where: { id }, data });
    }),

});

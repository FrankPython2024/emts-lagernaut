import { initTRPC, TRPCError } from "@trpc/server";
import { getServerSession } from "next-auth";
import superjson from "superjson";
import { ZodError } from "zod";
import { authOptions } from "@/core/auth/config";
import { prisma } from "@/core/db/prisma";
import { getMeinePermissions, hasPermission } from "@/modules/rollen/service";
import type { Session } from "next-auth";
import type { SessionUser } from "@/core/types";

// Minimaler Kontext — funktioniert mit Fetch Adapter (App Router) und Server Caller
export type TRPCContext = {
  session: Session | null;
  prisma:  typeof prisma;
};

// Fetch Adapter (App Router API Route) — kein req/res nötig
export const createTRPCContext = async (): Promise<TRPCContext> => {
  const session = await getServerSession(authOptions);
  return { session, prisma };
};

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const createTRPCRouter    = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure     = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});

export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if ((ctx.session.user as SessionUser).rolle !== "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next({ ctx });
});

// Procedure die eine spezifische Permission erfordert.
// SYSTEM_ADMIN-Wildcard wird automatisch akzeptiert (siehe hasPermission).
//
// Beispiel:
//   getStats: permissionProcedure("STATISTIK_VIEW").query(...)
export function permissionProcedure(requiredPermission: string) {
  return protectedProcedure.use(async ({ ctx, next }) => {
    const user        = ctx.session.user as SessionUser;
    const permissions = await getMeinePermissions(user.rolle);

    if (!hasPermission(permissions, requiredPermission)) {
      throw new TRPCError({
        code:    "FORBIDDEN",
        message: `Berechtigung fehlt: ${requiredPermission}`,
      });
    }

    return next({ ctx: { ...ctx, permissions } });
  });
}

// Inline-Check ohne neue Procedure. Sinnvoll wenn ein bestehender
// adminProcedure intern feingranular prüfen soll.
export async function requirePermission(user: SessionUser, key: string): Promise<void> {
  const permissions = await getMeinePermissions(user.rolle);
  if (!hasPermission(permissions, key)) {
    throw new TRPCError({
      code:    "FORBIDDEN",
      message: `Berechtigung fehlt: ${key}`,
    });
  }
}

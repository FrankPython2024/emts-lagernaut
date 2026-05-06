import { getServerSession } from "next-auth";
import { TRPCError } from "@trpc/server";
import { authOptions } from "./config";
import type { SessionUser } from "@/core/types";
import type { UserRolle } from "@prisma/client";

export async function getSession() {
  return getServerSession(authOptions);
}

export function getSessionUser(session: Awaited<ReturnType<typeof getSession>>): SessionUser | null {
  if (!session?.user) return null;
  return session.user as SessionUser;
}

export function isAdmin(session: Awaited<ReturnType<typeof getSession>>): boolean {
  return (session?.user as SessionUser)?.rolle === "ADMIN";
}

export function isTechniker(session: Awaited<ReturnType<typeof getSession>>): boolean {
  const rolle = (session?.user as SessionUser)?.rolle;
  return rolle === "TECHNIKER" || rolle === "ADMIN";
}

export function isBetrachter(session: Awaited<ReturnType<typeof getSession>>): boolean {
  return (session?.user as SessionUser)?.rolle === "BETRACHTER";
}

export function requireRole(
  session: Awaited<ReturnType<typeof getSession>>,
  rolle: UserRolle,
): SessionUser {
  const user = getSessionUser(session);

  if (!user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Nicht eingeloggt." });
  }

  const rangfolge: Record<UserRolle, number> = {
    ADMIN:      3,
    TECHNIKER:  2,
    BETRACHTER: 1,
  };

  if (rangfolge[user.rolle] < rangfolge[rolle]) {
    throw new TRPCError({
      code:    "FORBIDDEN",
      message: `Rolle '${rolle}' erforderlich. Deine Rolle: '${user.rolle}'.`,
    });
  }

  return user;
}

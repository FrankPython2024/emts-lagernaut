import "server-only";
import { cache } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/core/auth/config";
import { prisma } from "@/core/db/prisma";
import { appRouter } from "@/server/routers";
import { createCallerFactory } from "@/server/trpc";

const createContext = cache(async () => {
  const session = await getServerSession(authOptions);
  return { session, prisma };
});

const createCaller = createCallerFactory(appRouter);

export const api = createCaller(createContext);

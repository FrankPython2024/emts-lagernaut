import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/routers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/core/auth/config";
import { prisma } from "@/core/db/prisma";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: async () => {
      const session = await getServerSession(authOptions);
      return { session, prisma };
    },
    onError:
      process.env.NODE_ENV === "development"
        ? ({ path, error }) => console.error(`tRPC error [${path}]:`, error)
        : undefined,
  });

export { handler as GET, handler as POST };

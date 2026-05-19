import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/core/db/prisma";
import bcrypt from "bcryptjs";
import type { SessionUser } from "@/core/types";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        kuerzel: { label: "Kürzel", type: "text" },
        password: { label: "Passwort", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.kuerzel || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { kuerzel: credentials.kuerzel.toUpperCase() },
        });

        if (!user || !user.aktiv) return null;

        const valid = await bcrypt.compare(credentials.password, user.password);
        if (!valid) return null;

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLogin: new Date() },
        });

        return {
          id:         String(user.id),
          name:       user.name,
          email:      user.email,
          kuerzel:    user.kuerzel,
          rolle:      user.rolle,
          standortId: user.standortId ?? null,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id         = Number(user.id);
        token.kuerzel    = (user as SessionUser & { id: string }).kuerzel;
        token.rolle      = (user as SessionUser & { id: string }).rolle;
        token.standortId = (user as SessionUser & { id: string }).standortId ?? null;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        (session.user as SessionUser).id         = token.id as number;
        (session.user as SessionUser).kuerzel    = token.kuerzel as string;
        (session.user as SessionUser).rolle      = token.rolle as SessionUser["rolle"];
        (session.user as SessionUser).standortId = token.standortId as number | null | undefined;
      }
      return session;
    },
  },
};

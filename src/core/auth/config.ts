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
          where:   { kuerzel: credentials.kuerzel.toUpperCase() },
          include: { standortAccess: { select: { standortId: true } } },
        });

        if (!user || !user.aktiv) return null;

        const valid = await bcrypt.compare(credentials.password, user.password);
        if (!valid) return null;

        await prisma.user.update({
          where: { id: user.id },
          data:  { lastLogin: new Date() },
        });

        // Standort-Zugriff in Session encoden: Hauptstandort + zusätzliche.
        // Bei alleStandorte=true ist die Liste irrelevant (Wildcard).
        const standortIds = Array.from(
          new Set<number>([
            ...(user.standortId != null ? [user.standortId] : []),
            ...user.standortAccess.map(a => a.standortId),
          ]),
        );

        return {
          id:            String(user.id),
          name:          user.name,
          email:         user.email,
          kuerzel:       user.kuerzel,
          rolle:         user.rolle,
          standortId:    user.standortId ?? null,
          alleStandorte: user.alleStandorte,
          standortIds,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        const u = user as SessionUser & { id: string };
        token.id            = Number(user.id);
        token.kuerzel       = u.kuerzel;
        token.rolle         = u.rolle;
        token.standortId    = u.standortId ?? null;
        token.alleStandorte = u.alleStandorte ?? false;
        token.standortIds   = u.standortIds   ?? [];
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        const s = session.user as SessionUser;
        s.id            = token.id            as number;
        s.kuerzel       = token.kuerzel       as string;
        s.rolle         = token.rolle         as SessionUser["rolle"];
        s.standortId    = token.standortId    as number | null | undefined;
        s.alleStandorte = (token.alleStandorte as boolean | undefined) ?? false;
        s.standortIds   = (token.standortIds   as number[] | undefined) ?? [];
      }
      return session;
    },
  },
};

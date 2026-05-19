export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import NextAuth from "next-auth";
import { authOptions } from "@/core/auth/config";

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };

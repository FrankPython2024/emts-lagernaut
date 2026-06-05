import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/core/auth/config";
import { homeFor } from "@/lib/auth/homeFor";

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  // Rollen-eigene Home (PICKUP → /pickup, Admin-Lesesichten → /admin, sonst
  // /techniker). Vermeidet den Redirect-Kreis für PICKUP.
  const rolle = (session.user as { rolle?: string }).rolle;
  redirect(homeFor(rolle));
}

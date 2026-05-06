import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/core/auth/config";

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  const rolle = (session.user as { rolle?: string }).rolle;

  if (rolle === "ADMIN") {
    redirect("/admin");
  }

  redirect("/techniker");
}

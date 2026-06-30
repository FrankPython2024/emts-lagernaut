import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/core/auth/config";

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  // Die rechtebasierte Auswahl/Weiterleitung übernimmt /start (Admin + Anfrage-Recht
  // → Auswahl; sonst direkt ins passende Ziel). Hält die Logik an EINER Stelle.
  redirect("/start");
}

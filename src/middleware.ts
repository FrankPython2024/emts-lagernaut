import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { homeFor } from "@/lib/auth/homeFor";

export async function middleware(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const { pathname } = req.nextUrl;

  // Nicht eingeloggt → Login
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  const rolle = token.rolle as string | undefined;
  const darfAnfragen = token.darfAnfragen === true; // Anfrage-Recht (beim Login aufgelöst)
  // Bei fehlender Berechtigung IMMER auf die ROLLEN-EIGENE Home umleiten
  // (nicht pauschal /admin oder /techniker) — sonst entsteht ein Redirect-Kreis
  // für Rollen, die in beiden Bereichen abgewiesen werden (z.B. PICKUP).
  const heim = homeFor(rolle);
  const heimRedirect = () => NextResponse.redirect(new URL(heim, req.url));

  // /admin/benutzer + /admin/rollen → nur ADMIN (Audit-Rolle sieht keine
  // User-/Rollen-Daten, auch nicht lesend)
  if ((pathname.startsWith("/admin/benutzer") || pathname.startsWith("/admin/rollen")) && rolle !== "ADMIN") {
    return heimRedirect();
  }

  // /admin/system → nur ADMIN
  if (pathname.startsWith("/admin/system") && rolle !== "ADMIN") {
    return heimRedirect();
  }

  // /admin → ADMIN, BETRACHTER oder ADMIN_READONLY (Audit-Lesesicht)
  if (pathname.startsWith("/admin")) {
    if (rolle !== "ADMIN" && rolle !== "BETRACHTER" && rolle !== "ADMIN_READONLY") {
      return heimRedirect();
    }
  }

  // /techniker → TECHNIKER, ADMIN, oder JEDER mit einem Anfrage-Recht (rechtebasiert,
  // damit auch andere Rollen mit ANFRAGE_(MOBIL_)CREATE ins Anfrage-Portal kommen).
  if (pathname.startsWith("/techniker")) {
    if (rolle !== "TECHNIKER" && rolle !== "ADMIN" && !darfAnfragen) {
      return heimRedirect();
    }
  }

  // /start (Login-Auswahl) → nur Login-Pflicht (oben erzwungen), keine Rollen-Sperre.

  // /pickup → nur Login-Pflicht (oben erzwungen). Feingranulare Berechtigung
  // (PICKUP_PICK) prüft die Seite + die tRPC-Procedures; daher hier KEINE
  // Rollen-Einschränkung (PICKUP-Rolle, ADMIN via Wildcard, künftige Rollen).
  // /pickup leitet selbst NICHT weiter → kein Kreis.

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/techniker/:path*", "/pickup/:path*", "/start"],
};

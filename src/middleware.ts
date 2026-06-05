import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

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

  // /admin/benutzer + /admin/rollen → nur ADMIN (Audit-Rolle sieht keine
  // User-/Rollen-Daten, auch nicht lesend)
  if ((pathname.startsWith("/admin/benutzer") || pathname.startsWith("/admin/rollen")) && rolle !== "ADMIN") {
    return NextResponse.redirect(new URL("/admin", req.url));
  }

  // /admin/system → nur ADMIN
  if (pathname.startsWith("/admin/system") && rolle !== "ADMIN") {
    return NextResponse.redirect(new URL("/admin", req.url));
  }

  // /admin → ADMIN, BETRACHTER oder ADMIN_READONLY (Audit-Lesesicht)
  if (pathname.startsWith("/admin")) {
    if (rolle !== "ADMIN" && rolle !== "BETRACHTER" && rolle !== "ADMIN_READONLY") {
      return NextResponse.redirect(new URL("/techniker", req.url));
    }
  }

  // /techniker → TECHNIKER oder ADMIN
  if (pathname.startsWith("/techniker")) {
    if (rolle !== "TECHNIKER" && rolle !== "ADMIN") {
      return NextResponse.redirect(new URL("/admin", req.url));
    }
  }

  // /pickup → nur Login-Pflicht (oben erzwungen). Feingranulare Berechtigung
  // (PICKUP_PICK) prüft die Seite + die tRPC-Procedures; daher hier KEINE
  // Rollen-Einschränkung (PICKUP-Rolle, ADMIN via Wildcard, künftige Rollen).

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/techniker/:path*", "/pickup/:path*"],
};

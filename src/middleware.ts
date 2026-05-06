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

  // /admin/benutzer → nur ADMIN
  if (pathname.startsWith("/admin/benutzer") && rolle !== "ADMIN") {
    return NextResponse.redirect(new URL("/admin", req.url));
  }

  // /admin/system → nur ADMIN
  if (pathname.startsWith("/admin/system") && rolle !== "ADMIN") {
    return NextResponse.redirect(new URL("/admin", req.url));
  }

  // /admin → ADMIN oder BETRACHTER
  if (pathname.startsWith("/admin")) {
    if (rolle !== "ADMIN" && rolle !== "BETRACHTER") {
      return NextResponse.redirect(new URL("/techniker", req.url));
    }
  }

  // /techniker → TECHNIKER oder ADMIN
  if (pathname.startsWith("/techniker")) {
    if (rolle !== "TECHNIKER" && rolle !== "ADMIN") {
      return NextResponse.redirect(new URL("/admin", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/techniker/:path*"],
};

import { getToken } from "next-auth/jwt";

// ── Identität für Socket.io-Verbindungen (serverseitig verifiziert) ───────────
// Früher übernahm der Socket-Server kuerzel/rolle aus `handshake.auth` — also aus
// dem, was der Browser BEHAUPTET. Damit konnte sich jeder als ADMIN ausgeben und
// alle Admin-Räume (Anfragen, Chat, Activity, Bestellungen) mitlesen.
// Die Identität kommt jetzt ausschließlich aus dem signierten NextAuth-Cookie.

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const teil of header.split(";")) {
    const idx = teil.indexOf("=");
    if (idx < 0) continue;
    const k = teil.slice(0, idx).trim();
    if (!k) continue;
    const roh = teil.slice(idx + 1).trim();
    try { out[k] = decodeURIComponent(roh); } catch { out[k] = roh; }
  }
  return out;
}

export type SocketIdentitaet = { kuerzel: string; rolle: string };

/**
 * Liest die Identität aus dem NextAuth-Session-Cookie des Handshakes.
 * Gibt null zurück, wenn kein gültiges (signiertes, nicht abgelaufenes) Token da ist.
 */
export async function ermittleSocketIdentitaet(
  cookieHeader: string | undefined,
  headers:      unknown = {},
): Promise<SocketIdentitaet | null> {
  const cookies = parseCookies(cookieHeader);
  if (Object.keys(cookies).length === 0) return null;

  // Beide Cookie-Varianten prüfen: NextAuth setzt je nach NEXTAUTH_URL (http/https)
  // `next-auth.session-token` ODER `__Secure-next-auth.session-token`. Beides zu
  // versuchen macht den Handshake robust gegen Deployment-/Proxy-Unterschiede —
  // sonst bekäme nach einer Umstellung schlagartig NIEMAND mehr Live-Updates.
  const varianten = [
    { cookieName: "next-auth.session-token",          secureCookie: false },
    { cookieName: "__Secure-next-auth.session-token", secureCookie: true  },
  ] as const;

  for (const v of varianten) {
    if (!cookies[v.cookieName]) continue;
    try {
      const token = await getToken({
        req:          { cookies, headers } as never,
        secret:       process.env.NEXTAUTH_SECRET,
        cookieName:   v.cookieName,
        secureCookie: v.secureCookie,
      });
      if (token?.kuerzel) {
        return { kuerzel: String(token.kuerzel), rolle: String(token.rolle ?? "") };
      }
    } catch {
      // ungültige/abgelaufene Signatur → nächste Variante probieren
    }
  }
  return null;
}

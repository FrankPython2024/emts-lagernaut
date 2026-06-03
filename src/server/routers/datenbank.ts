/**
 * Datenbank-Explorer — Schritt 1: Passwort-Gate.
 *
 * Read-only DB-Explorer unter /admin/datenbank. Zusätzlich zur ADMIN-Rolle
 * (adminProcedure — ausdrücklich NICHT ADMIN_READONLY) durch ein eigenes Passwort
 * gesichert. Nach erfolgreichem `unlock` wird ein signiertes, httpOnly-Cookie
 * gesetzt (HMAC mit NEXTAUTH_SECRET, 2h gültig). Alle Daten-Queries der Schritte
 * 2–4 rufen `requireDbExplorer()` auf, das Signatur + Ablauf prüft.
 *
 * Strikt read-only: keine Schreib-Routen, kein freies SQL.
 */
import { z } from "zod";
import { createHmac, createHash, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, adminProcedure } from "@/server/trpc";

const COOKIE_NAME    = "db_explorer";
const GUELTIGKEIT_MS = 2 * 60 * 60 * 1000; // 2 Stunden

// ── Krypto-Helfer ─────────────────────────────────────────────────────────────

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Server-Secret (NEXTAUTH_SECRET) ist nicht gesetzt." });
  }
  return s;
}

/** HMAC-Signatur über den Ablaufzeitpunkt. */
function signiere(exp: number): string {
  return createHmac("sha256", secret()).update(String(exp)).digest("hex");
}

/** Token-Format: `<exp-ms>.<hmac>`. */
function baueToken(exp: number): string {
  return `${exp}.${signiere(exp)}`;
}

/**
 * Konstant-Zeit-Vergleich zweier Strings. Über SHA-256-Digests, damit
 * `timingSafeEqual` immer gleich lange Buffer erhält (kein Längen-Leak).
 */
function sicherGleich(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/** Prüft Signatur + Ablauf eines Cookie-Tokens. */
function tokenGueltig(token: string | undefined): boolean {
  if (!token) return false;
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return false;

  const exp = Number(token.slice(0, idx));
  if (!Number.isFinite(exp) || exp < Date.now()) return false;

  const sig      = token.slice(idx + 1);
  const erwartet = signiere(exp);
  if (sig.length !== erwartet.length) return false; // timingSafeEqual braucht gleiche Länge
  return timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(erwartet, "utf8"));
}

// ── Öffentlicher Auth-Helfer für Schritte 2–4 ─────────────────────────────────

/**
 * Wache für alle Datenbank-Explorer-Daten-Queries (Schritt 2–4).
 * Wirft UNAUTHORIZED, wenn das `db_explorer`-Cookie fehlt, ungültig oder
 * abgelaufen ist. Muss in einer adminProcedure verwendet werden (Rolle ADMIN ist
 * bereits dort geprüft).
 */
export async function requireDbExplorer(): Promise<void> {
  const store = await cookies();
  if (!tokenGueltig(store.get(COOKIE_NAME)?.value)) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Datenbank-Explorer ist gesperrt. Bitte erneut freischalten." });
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export const datenbankRouter = createTRPCRouter({

  // Ist der Explorer aktuell freigeschaltet (Cookie vorhanden & gültig)?
  status: adminProcedure.query(async () => {
    const store = await cookies();
    return { unlocked: tokenGueltig(store.get(COOKIE_NAME)?.value) };
  }),

  // Mit Passwort freischalten → signiertes httpOnly-Cookie (2h).
  unlock: adminProcedure
    .input(z.object({ passwort: z.string().min(1).max(200) }))
    .mutation(async ({ input }) => {
      const erwartet = process.env.DB_EXPLORER_PASSWORD;
      if (!erwartet) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB_EXPLORER_PASSWORD ist auf dem Server nicht gesetzt." });
      }
      if (!sicherGleich(input.passwort, erwartet)) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Falsches Passwort." });
      }

      const exp   = Date.now() + GUELTIGKEIT_MS;
      const store = await cookies();
      store.set(COOKIE_NAME, baueToken(exp), {
        httpOnly: true,
        secure:   process.env.NODE_ENV === "production",
        sameSite: "lax",
        path:     "/",
        maxAge:   GUELTIGKEIT_MS / 1000,
      });
      return { unlocked: true, gueltigBis: exp };
    }),

  // Manuell sperren (Cookie löschen).
  lock: adminProcedure.mutation(async () => {
    const store = await cookies();
    store.delete(COOKIE_NAME);
    return { unlocked: false };
  }),

});

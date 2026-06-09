export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { redis } from "@/core/infra/redis";

/**
 * Öffentlicher (unauthentifizierter) Hinweis für die Login-Seite.
 * Quelle: Redis-Key "login_hinweis" (String = Text; nicht vorhanden = kein Hinweis).
 * Setzen/Löschen erfolgt per Redis-Befehl (mit TTL für Auto-Ablauf), nicht über UI.
 *
 * try/catch: Ist Redis kurz weg (enableOfflineQueue:false → wirft sofort), liefert
 * der Handler { text: null } — die Login-Seite muss funktionsfähig bleiben.
 */
export async function GET() {
  try {
    const text = await redis.get("login_hinweis");
    return NextResponse.json({ text: text ?? null });
  } catch {
    return NextResponse.json({ text: null });
  }
}

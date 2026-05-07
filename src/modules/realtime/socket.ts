/**
 * Socket.io Helper-Modul
 *
 * Der eigentliche Socket.io-Server wird über src/pages/api/socketio.ts
 * initialisiert (Pages Router + res.socket.server Trick).
 * Dieses Modul stellt nur Safe-Emit-Helpers über global.io bereit.
 */

import type { Server } from "socket.io";
import type { IncomingMessage, ServerResponse } from "http";
import type { Server as HttpServer } from "http";
import { EVENTS } from "./events";

// Wird von src/pages/api/socketio.ts gesetzt
declare global {
  var io: Server | undefined;
}

// ── Init (wird jetzt von Pages API Route gerufen) ────────────────────────────

export function getSocketIO(): Server | null {
  return global.io ?? null;
}

export function isSocketIOReady(): boolean {
  return !!global.io;
}

// Legacy: wird von server.ts gerufen — jetzt No-Op da init über Pages API
export function initSocketIO(httpServer: HttpServer): void {
  // Kein-Op: Socket.io wird über /api/socketio (Pages Router) initialisiert
  console.log("[Socket.io] initSocketIO: Initialisierung via Pages API (/api/socketio)");
}

// ── Safe Emit-Helpers ─────────────────────────────────────────────────────────

export function emitToUser(kuerzel: string, event: string, data: unknown): void {
  global.io?.to(`user:${kuerzel}`).emit(event, data);
}

export function emitToAdmins(event: string, data: unknown): void {
  global.io?.to("admins").emit(event, data);
}

export function emitToTechniker(event: string, data: unknown): void {
  global.io?.to("techniker").emit(event, data);
}

export function emitToAll(event: string, data: unknown): void {
  global.io?.emit(event, data);
}

// ── Verbundene Clients (für Nerd-Dashboard) ───────────────────────────────────

export async function getConnectedClients() {
  if (!global.io) return [];
  try {
    const sockets = await global.io.fetchSockets();
    return sockets.map((s) => ({
      id:          s.id,
      kuerzel:     s.handshake.auth.kuerzel as string,
      rolle:       s.handshake.auth.rolle   as string,
      connectedAt: s.handshake.time,
    }));
  } catch {
    return [];
  }
}

export { EVENTS };

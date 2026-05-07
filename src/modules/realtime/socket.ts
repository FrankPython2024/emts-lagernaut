import { Server, type Socket } from "socket.io";
import type { IncomingMessage, ServerResponse } from "http";
import type { Server as HttpServer } from "http";
import { EVENTS } from "./events";

let io: Server | null = null;

// ── Init ─────────────────────────────────────────────────────────────────────

export function getSocketIO(): Server {
  if (!io) throw new Error("Socket.io nicht initialisiert");
  return io;
}

export function isSocketIOReady(): boolean {
  return io !== null;
}

export function initSocketIO(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors:            { origin: "*", methods: ["GET", "POST"] },
    path:            "/socket.io",
    transports:      ["websocket", "polling"],
    pingInterval:    10_000,
    pingTimeout:     5_000,
  });

  io.on("connection", (socket: Socket) => {
    const kuerzel = socket.handshake.auth.kuerzel as string | undefined;
    const rolle   = socket.handshake.auth.rolle   as string | undefined;

    if (!kuerzel) {
      socket.disconnect();
      return;
    }

    console.log(`[Socket.io] + ${kuerzel} (${rolle}) — ${socket.id}`);

    // Rooms
    socket.join(`user:${kuerzel}`);
    if (rolle === "ADMIN")     socket.join("admins");
    if (rolle === "TECHNIKER") socket.join("techniker");

    // Techniker Online-Status
    if (rolle === "TECHNIKER") {
      socket.broadcast.to("admins").emit(EVENTS.TECHNIKER_ONLINE, { kuerzel });
      updateTechnikerSession(kuerzel, true).catch(console.error);
    }

    socket.on("disconnect", () => {
      console.log(`[Socket.io] - ${kuerzel} — ${socket.id}`);
      if (rolle === "TECHNIKER") {
        io?.to("admins").emit(EVENTS.TECHNIKER_OFFLINE, { kuerzel });
        updateTechnikerSession(kuerzel, false).catch(console.error);
      }
    });

    socket.on(EVENTS.PING, () => socket.emit(EVENTS.PONG));
  });

  console.log("[Socket.io] Server bereit");
  return io;
}

// ── DB-Update (lazy import vermeidet Prisma-Init-Loop) ────────────────────────

async function updateTechnikerSession(kuerzel: string, online: boolean) {
  const { prisma } = await import("@/core/db/prisma");
  await prisma.technikerSession.upsert({
    where:  { kuerzel },
    update: { online, lastSeen: new Date() },
    create: { kuerzel, online, lastSeen: new Date() },
  });
}

// ── Safe Emit-Helpers (kein Fehler wenn Socket.io nicht initialisiert) ────────

export function emitToUser(kuerzel: string, event: string, data: unknown): void {
  try { getSocketIO().to(`user:${kuerzel}`).emit(event, data); } catch { /* nicht initialisiert */ }
}

export function emitToAdmins(event: string, data: unknown): void {
  try { getSocketIO().to("admins").emit(event, data); } catch {}
}

export function emitToTechniker(event: string, data: unknown): void {
  try { getSocketIO().to("techniker").emit(event, data); } catch {}
}

export function emitToAll(event: string, data: unknown): void {
  try { getSocketIO().emit(event, data); } catch {}
}

// ── Verbundene Clients abrufen (für Nerd-Dashboard) ─────────────────────────

export async function getConnectedClients() {
  try {
    const sockets = await getSocketIO().fetchSockets();
    return sockets.map((s) => ({
      id:        s.id,
      kuerzel:   s.handshake.auth.kuerzel as string,
      rolle:     s.handshake.auth.rolle   as string,
      connectedAt: s.handshake.time,
    }));
  } catch {
    return [];
  }
}

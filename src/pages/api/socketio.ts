import type { NextApiRequest, NextApiResponse } from "next";
import { Server } from "socket.io";
import type { Server as HTTPServer } from "http";
import type { Socket as NetSocket } from "net";
import { ermittleSocketIdentitaet } from "@/lib/auth/socketAuth";

// ── Type-Erweiterungen für Next.js Pages API ──────────────────────────────────

interface SocketServer extends HTTPServer {
  io?: Server;
}

interface SocketWithIO extends NetSocket {
  server: SocketServer;
}

interface NextApiResponseWithSocket extends NextApiResponse {
  socket: SocketWithIO;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default function handler(
  req:  NextApiRequest,
  res:  NextApiResponseWithSocket,
) {
  if (res.socket.server.io) {
    console.log("[Socket.io] Bereits aktiv");
    res.end();
    return;
  }

  console.log("[Socket.io] Initialisiere Server über Pages API...");

  const io = new Server(res.socket.server, {
    path:              "/api/socketio",
    addTrailingSlash:  false,
    cors:              { origin: "*", methods: ["GET", "POST"] },
    transports:        ["websocket", "polling"],
    pingInterval:      25_000,
    pingTimeout:       20_000,
    perMessageDeflate: false,
  });

  // AUTH-Gate: läuft VOR jedem `connection`-Event. Ohne gültige Session kommt
  // niemand rein — `handshake.auth` wird bewusst ignoriert (Client-Behauptung).
  io.use((socket, next) => {
    void ermittleSocketIdentitaet(socket.request.headers.cookie, socket.request.headers)
      .then((ident) => {
        if (!ident) {
          console.warn("[Socket.io] Verbindung ohne gültige Session abgelehnt");
          next(new Error("unauthorized"));
          return;
        }
        socket.data.kuerzel = ident.kuerzel;
        socket.data.rolle   = ident.rolle;
        next();
      })
      .catch((e) => {
        console.error("[Socket.io] Auth-Prüfung fehlgeschlagen:", e);
        next(new Error("unauthorized"));
      });
  });

  io.on("connection", (socket) => {
    // Verifizierte Identität aus dem Session-Cookie (siehe io.use oben).
    const kuerzel = socket.data.kuerzel as string | undefined;
    const rolle   = socket.data.rolle   as string | undefined;

    if (!kuerzel) {
      socket.disconnect();
      return;
    }

    console.log(`[Socket.io] + ${kuerzel} (${rolle}) — ${socket.id}`);

    socket.join(`user:${kuerzel}`);
    // Backoffice = alle Non-Techniker (ADMIN + BETRACHTER + zukünftige Rollen).
    // Wird für statistik-relevante Events genutzt (ANFRAGE_NEU/UPDATED/…),
    // damit Live-Updates auch read-only Rollen erreichen.
    if (rolle !== "TECHNIKER") socket.join("backoffice");
    if (rolle === "ADMIN")     socket.join("admins");
    if (rolle === "TECHNIKER") {
      socket.join("techniker");
      io.to("admins").emit("techniker:online", { kuerzel, timestamp: new Date() });
      // TechnikerSession aktualisieren (fire & forget)
      import("@/core/db/prisma")
        .then(({ prisma }) =>
          prisma.technikerSession.upsert({
            where:  { kuerzel },
            update: { online: true, lastSeen: new Date() },
            create: { kuerzel, online: true, lastSeen: new Date() },
          }),
        )
        .catch(console.error);
    }

    socket.on("disconnect", (reason) => {
      console.log(`[Socket.io] - ${kuerzel} (${reason})`);
      if (rolle === "TECHNIKER") {
        io.to("admins").emit("techniker:offline", { kuerzel, timestamp: new Date() });
        import("@/core/db/prisma")
          .then(({ prisma }) =>
            prisma.technikerSession.updateMany({
              where: { kuerzel },
              data:  { online: false },
            }),
          )
          .catch(console.error);
      }
    });

    socket.on("ping", () => socket.emit("pong"));

    socket.on("activity", (data: unknown) => {
      // Navigation server-seitig festhalten (Nerd-Dashboard "Letzter Menüpunkt").
      // kuerzel stammt aus der serverseitig verifizierten Session (socket.data),
      // NICHT aus dem Payload. Aus dem Payload nur den Pfad, defensiv geprüft.
      const path = (data as { path?: unknown } | null)?.path;
      if (kuerzel && typeof path === "string" && path.length > 0 && path.length <= 200) {
        // Fire & forget: Redis-Client wirft sofort (enableOfflineQueue:false) —
        // darf das Event-Handling nie kippen. 24h-TTL.
        import("@/core/infra/redis")
          .then(({ redis }) =>
            redis.set(`nav:${kuerzel}`, JSON.stringify({ path, ts: Date.now() }), "EX", 86400),
          )
          .catch(() => {});
      }
      io.to("admins").emit("activity:neu", data);
    });
  });

  // Server-Referenz für spätere Nutzung
  res.socket.server.io = io;
  global.io = io;

  console.log("[Socket.io] Server bereit auf /api/socketio");
  res.end();
}

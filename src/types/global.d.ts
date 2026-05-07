import type { Server } from "socket.io";

declare global {
  // Singleton Socket.io Server — gesetzt von Pages API Route /api/socketio
  var io: Server | undefined;
}

export {};

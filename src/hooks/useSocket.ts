"use client";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { useSession } from "next-auth/react";
import type { SessionUser } from "@/core/types";
import { EVENTS } from "@/modules/realtime/events";

// Singleton Socket-Instanz — bleibt über Re-Renders erhalten
let globalSocket: Socket | null = null;

export function useSocket() {
  const { data: session } = useSession();
  const user = session?.user as SessionUser | undefined;
  const [connected, setConnected] = useState(false);
  const listenersRef = useRef<Map<string, (data: unknown) => void>>(new Map());

  useEffect(() => {
    if (!user?.kuerzel) return;

    if (!globalSocket) {
      globalSocket = io({
        path:  "/socket.io",
        auth:  { kuerzel: user.kuerzel, rolle: user.rolle },
        reconnectionAttempts: 5,
        reconnectionDelay:    2_000,
      });
    }

    const socket = globalSocket;

    socket.on("connect",    () => { setConnected(true);  console.log("[Socket.io] verbunden"); });
    socket.on("disconnect", () => { setConnected(false); console.log("[Socket.io] getrennt"); });

    // Heartbeat
    const hbInterval = setInterval(() => {
      if (socket.connected) socket.emit(EVENTS.PING);
    }, 30_000);

    return () => {
      clearInterval(hbInterval);
      // Socket NICHT disconnecten (Singleton bleibt bestehen)
    };
  }, [user?.kuerzel, user?.rolle]);

  function on(event: string, handler: (data: unknown) => void) {
    if (!globalSocket) return;
    globalSocket.on(event, handler);
    listenersRef.current.set(event, handler);
  }

  function off(event: string) {
    if (!globalSocket) return;
    const handler = listenersRef.current.get(event);
    if (handler) {
      globalSocket.off(event, handler);
      listenersRef.current.delete(event);
    }
  }

  return { socket: globalSocket, connected, on, off, EVENTS };
}

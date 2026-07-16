"use client";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { useSession } from "next-auth/react";
import type { SessionUser } from "@/core/types";
import { EVENTS } from "@/modules/realtime/events";

// Singleton Socket-Instanz — bleibt über Re-Renders erhalten
let globalSocket: Socket | null = null;

export function useSocket() {
  const { data: session } = useSession() ?? { data: null };
  const user = session?.user as SessionUser | undefined;
  const [connected, setConnected] = useState(false);
  const listenersRef = useRef<Map<string, (data: unknown) => void>>(new Map());

  useEffect(() => {
    if (!user?.kuerzel) return;

    if (!globalSocket) {
      globalSocket = io({
        path:                "/api/socketio",
        addTrailingSlash:    false,
        auth:                { kuerzel: user.kuerzel, rolle: user.rolle },
        // Nie dauerhaft aufgeben: nach einem Deploy (Server ist Minuten weg) sollen
        // offene Tabs von selbst wieder verbinden, statt nach ~20s tot zu bleiben.
        reconnectionAttempts: Infinity,
        reconnectionDelay:    1_000,
        reconnectionDelayMax: 5_000,
        transports:          ["polling", "websocket"],
      });
    }

    const socket = globalSocket;

    // Benannte Handler, damit die Cleanup sie wieder entfernen kann — sonst sammeln
    // sich bei jedem Mount/Remount neue connect/disconnect-Listener auf dem Singleton.
    const onConnect    = () => { setConnected(true);  console.log("[Socket.io] verbunden"); };
    const onDisconnect = () => { setConnected(false); console.log("[Socket.io] getrennt"); };
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    // Aktuellen Verbindungsstand sofort spiegeln (spät gemountete Konsumenten).
    setConnected(socket.connected);

    // Heartbeat
    const hbInterval = setInterval(() => {
      if (socket.connected) socket.emit(EVENTS.PING);
    }, 30_000);

    return () => {
      clearInterval(hbInterval);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      // Socket selbst NICHT disconnecten (Singleton bleibt bestehen)
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

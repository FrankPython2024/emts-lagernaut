"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useSocket } from "@/hooks/useSocket";

/**
 * Persistente Socket.io-Verbindung im Root-Layout.
 * - fetch("/api/socketio") weckt den Server-Socket (Pages-Router-Trick)
 * - useSocket() baut die echte Client-Verbindung auf (Singleton, bleibt offen)
 * - Guards sind in useSocket selbst: connect nur wenn User eingeloggt (kuerzel vorhanden)
 * - Meldet zusätzlich bei jedem Routenwechsel den aktuellen Pfad per "activity"-
 *   Event (Server schreibt daraus "Letzter Menüpunkt" ins Nerd-Dashboard).
 *   Da im Root-Layout gemountet, deckt das admin/techniker/pickup in einem Rutsch ab.
 */
export function SocketInitializer() {
  const { socket, connected } = useSocket(); // baut globale Verbindung auf sobald Session vorhanden
  const pathname = usePathname();

  useEffect(() => {
    fetch("/api/socketio").catch(() => {});
  }, []);

  useEffect(() => {
    if (connected && socket && pathname) {
      socket.emit("activity", { path: pathname });
    }
  }, [socket, connected, pathname]);

  return null;
}

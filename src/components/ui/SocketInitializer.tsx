"use client";
import { useEffect, useRef } from "react";
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
 *
 * WICHTIG: Der Emit hängt NICHT am React-Flag `connected` (das bleibt beim
 * Singleton-Socket oft aus, wenn die Verbindung schon vor dem Subscribe stand),
 * sondern — wie der funktionierende Ping-Heartbeat — am echten "connect"-Event
 * und am socket-eigenen Flag `socket.connected`.
 */
export function SocketInitializer() {
  const { socket } = useSocket(); // baut globale Verbindung auf sobald Session vorhanden
  const pathname = usePathname();

  // Aktuellen Pfad in einer Ref halten, damit der connect-Handler (der nur einmal
  // gebunden wird) immer den NEUESTEN Pfad kennt.
  const pathRef = useRef(pathname);
  useEffect(() => { pathRef.current = pathname; }, [pathname]);

  // Server-Socket wecken
  useEffect(() => {
    fetch("/api/socketio").catch(() => {});
  }, []);

  // (1) Bei jedem echten (Re-)Connect den aktuellen Pfad melden — und sofort,
  //     falls die Verbindung beim Mount schon steht (Singleton bereits connected).
  useEffect(() => {
    if (!socket) return;

    const meldeAktuellenPfad = () => {
      if (pathRef.current) socket.emit("activity", { path: pathRef.current });
    };

    socket.on("connect", meldeAktuellenPfad);
    if (socket.connected) meldeAktuellenPfad();

    return () => { socket.off("connect", meldeAktuellenPfad); };
  }, [socket]);

  // (2) Zusätzlich bei jedem Routenwechsel — geschützt mit dem socket-eigenen
  //     Flag socket.connected (nicht dem Hook-State).
  useEffect(() => {
    if (socket?.connected && pathname) {
      socket.emit("activity", { path: pathname });
    }
  }, [socket, pathname]);

  return null;
}

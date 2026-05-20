"use client";
import { useEffect } from "react";
import { useSocket } from "@/hooks/useSocket";

/**
 * Persistente Socket.io-Verbindung im Root-Layout.
 * - fetch("/api/socketio") weckt den Server-Socket (Pages-Router-Trick)
 * - useSocket() baut die echte Client-Verbindung auf (Singleton, bleibt offen)
 * - Guards sind in useSocket selbst: connect nur wenn User eingeloggt (kuerzel vorhanden)
 */
export function SocketInitializer() {
  useSocket(); // baut globale Verbindung auf sobald Session vorhanden

  useEffect(() => {
    fetch("/api/socketio").catch(() => {});
  }, []);

  return null;
}

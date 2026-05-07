"use client";
import { useEffect } from "react";

/**
 * Ruft /api/socketio einmalig beim App-Start auf.
 * Das initialisiert den Socket.io-Server über den Pages-Router-Trick
 * (res.socket.server) bevor irgendein Client sich verbindet.
 */
export function SocketInitializer() {
  useEffect(() => {
    fetch("/api/socketio").catch(() => {
      // Kein Fehler — socketio wird beim ersten Client-Connect initialisiert
    });
  }, []);
  return null;
}

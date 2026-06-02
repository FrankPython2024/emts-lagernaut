"use client";
import { useState, useEffect } from "react";

/**
 * Liefert die aktuelle Zeit (ms) und tickt in festem Intervall weiter.
 * Damit lassen sich zeitabhängige UI-Zustände (z.B. die 1h-Überfälligkeits-
 * Marke) live neu bewerten, ohne Server-Polling — `createdAt` liegt bereits
 * im Client.
 *
 * Default 60s: feingranular genug für eine Stundengrenze, ohne Render-Spam.
 */
export function useNow(intervalMs: number = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

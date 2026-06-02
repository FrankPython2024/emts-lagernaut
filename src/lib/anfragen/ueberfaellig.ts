import { AnfrageStatus } from "@prisma/client";

/**
 * Überfälligkeits-Logik für Anfragen — zentral, damit Liste (Badge) und
 * Dashboard-Widget exakt dieselbe Definition verwenden.
 *
 * Eine Anfrage ist überfällig, wenn:
 *   - Status ∈ { NEU, BEDARF, IN_BEARBEITUNG }, und
 *   - now - createdAt > 1 Stunde
 *
 * Basis ist bewusst `createdAt` (nicht statusGeändertAm) — einfach & konsistent.
 */

export const UEBERFAELLIG_MS = 60 * 60 * 1000; // 1 Stunde

// Offene Status — können überfällig werden
export const OFFENE_STATUS: AnfrageStatus[] = [
  AnfrageStatus.NEU,
  AnfrageStatus.BEDARF,
  AnfrageStatus.IN_BEARBEITUNG,
];

export function istOffen(status: AnfrageStatus): boolean {
  return OFFENE_STATUS.includes(status);
}

export function istUeberfaellig(
  status: AnfrageStatus,
  createdAt: Date | string,
  nowMs: number = Date.now(),
): boolean {
  if (!istOffen(status)) return false;
  const t = typeof createdAt === "string" ? new Date(createdAt).getTime() : createdAt.getTime();
  return nowMs - t > UEBERFAELLIG_MS;
}

/**
 * Verstrichene Zeit seit `createdAt` als "vor 2h 15m" / "vor 12m".
 * Nimmt `nowMs` als Parameter, damit der Wert mit einem tickenden Timer
 * live (ohne Refetch) aktualisiert werden kann.
 */
export function verstricheneZeit(createdAt: Date | string, nowMs: number = Date.now()): string {
  const t = typeof createdAt === "string" ? new Date(createdAt).getTime() : createdAt.getTime();
  const min = Math.max(0, Math.floor((nowMs - t) / 60_000));
  if (min < 60) return `vor ${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `vor ${h}h` : `vor ${h}h ${m}m`;
}

import { AnfrageStatus } from "@prisma/client";
import { TEILTYPEN_MIT_MENGE } from "@/lib/constants/teiltypen";

/**
 * Überfälligkeits-Logik für Anfragen — zentral, damit Liste (Badge) und
 * Dashboard-Widget exakt dieselbe Definition verwenden.
 *
 * Eine Anfrage ist überfällig, wenn:
 *   - Status ∈ { NEU, BEDARF, IN_BEARBEITUNG }, und
 *   - now - createdAt > 1 Stunde, und
 *   - es KEINE Füße sind (Frank, 09.10.2026): Füße werden oft erst gedruckt —
 *     eine Platte braucht bis zu 2 h 40 min (Latitude 7400). Die Warnung schlug
 *     bei jeder Füße-Anfrage an und verdeckte die Anfragen, die wirklich liegen.
 *
 * ⚠️ `teil` ist Pflicht, damit keine Stelle die Regel still umgeht (Liste, Board,
 * zwei Dashboard-Widgets, Browser-Benachrichtigung).
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

/** Füße zählen nie als überfällig (siehe oben). Vergleich über den DB-Namen („Füße vorne"). */
export function ohneUeberfaellig(teil: string | null | undefined): boolean {
  return !!teil && TEILTYPEN_MIT_MENGE.includes(teil);
}

export function istUeberfaellig(
  status: AnfrageStatus,
  createdAt: Date | string,
  nowMs: number,
  teil: string | null | undefined,
): boolean {
  if (!istOffen(status) || ohneUeberfaellig(teil)) return false;
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
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `vor ${h}h` : `vor ${h}h ${m}m`;
}

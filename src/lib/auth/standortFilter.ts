import type { TRPCContext } from "@/server/trpc";
import type { SessionUser } from "@/core/types";

/**
 * Standort-IDs, auf die der aktuelle User Zugriff hat.
 *
 * - Techniker (standortId gesetzt): nur eigener Standort.
 *   filterStandortId wird ignoriert (Sicherheit — kein Override möglich).
 * - Admin (standortId = null): alle Standorte.
 *   Kann via filterStandortId freiwillig auf einen einschränken.
 *
 * Rückgabe null = keine Einschränkung (Admin sieht alles).
 */
export function getZugaenglicheStandortIds(
  ctx:             TRPCContext,
  filterStandortId?: number | null,
): number[] | null {
  const user          = ctx.session?.user as SessionUser | undefined;
  const userStandortId = user?.standortId;

  if (userStandortId != null) {
    return [userStandortId]; // Techniker — fest, kein Override
  }

  // Admin
  if (filterStandortId != null) {
    return [filterStandortId];
  }

  return null; // keine Einschränkung
}

/**
 * Prisma-`where`-Fragment für Standort-Filterung.
 *
 * null-Return = leeres Objekt → kein Filter (Admin sieht alles).
 * Bei Techniker wird sein standortId erzwungen.
 */
export function standortWhere(
  ctx:              TRPCContext,
  filterStandortId?: number | null,
  fieldName:         string = "standortId",
): Record<string, unknown> {
  const ids = getZugaenglicheStandortIds(ctx, filterStandortId);
  if (ids === null)       return {};
  if (ids.length === 1)   return { [fieldName]: ids[0] };
  return { [fieldName]: { in: ids } };
}

/**
 * Standort-ID für neue Datensätze bestimmen.
 *
 * - Techniker: zwingend eigener Standort (ignoriert inputStandortId)
 * - Admin: aus inputStandortId oder Default 1 (Sömmerda)
 */
export function resolveStandortId(
  ctx:              TRPCContext,
  inputStandortId?: number | null,
): number {
  const user           = ctx.session?.user as SessionUser | undefined;
  const userStandortId = user?.standortId;
  return userStandortId ?? inputStandortId ?? 1;
}

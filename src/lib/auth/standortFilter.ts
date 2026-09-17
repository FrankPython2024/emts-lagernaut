import type { TRPCContext } from "@/server/trpc";
import type { SessionUser } from "@/core/types";

/**
 * Standort-IDs, auf die der aktuelle User Zugriff hat.
 *
 * Quelle: Session (in NextAuth-Callback aus DB geladen).
 *   - alleStandorte=true ⇒ Wildcard, Rückgabe null (keine Einschränkung).
 *   - sonst: standortIds (= Hauptstandort + UserStandortAccess-Einträge).
 *
 * filterStandortId (Sidebar-Dropdown) darf nur greifen wenn er in der
 * Access-Liste enthalten ist — sonst ignorieren (Sicherheit).
 *
 * Hinweis: Access-Änderungen werden erst nach Re-Login wirksam (JWT-Cache).
 */
export function getZugaenglicheStandortIds(
  ctx:               TRPCContext,
  filterStandortId?: number | null,
): number[] | null {
  const user = ctx.session?.user as SessionUser | undefined;
  if (!user) return [];

  // Wildcard
  if (user.alleStandorte) {
    return filterStandortId != null ? [filterStandortId] : null;
  }

  // Explizite Liste aus Session
  const accessible = user.standortIds && user.standortIds.length > 0
    ? user.standortIds
    : (user.standortId != null ? [user.standortId] : []);

  if (filterStandortId != null && accessible.includes(filterStandortId)) {
    return [filterStandortId];
  }

  return accessible;
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
 * - User mit alleStandorte=true (typisch ADMIN): inputStandortId, sonst 1 (Sömmerda)
 * - sonst: Hauptstandort (user.standortId) zwingend
 */
export function resolveStandortId(
  ctx:              TRPCContext,
  inputStandortId?: number | null,
): number {
  const user = ctx.session?.user as SessionUser | undefined;
  if (user?.alleStandorte) return inputStandortId ?? 1;
  return user?.standortId ?? inputStandortId ?? 1;
}

/**
 * Standort-Filter für Statistik und Auswertungen: `null` = alle Standorte,
 * eine Id, oder eine Liste (Nutzer mit Zugriff auf mehrere, aber nicht alle).
 *
 * ⚠️ Bei MEHREREN zugänglichen Standorten nie `null` zurückgeben — `null` heißt
 * nachgelagert „kein Filter" und zeigte dem Nutzer die Zahlen ALLER Standorte.
 * Eine leere Liste bleibt leer (= nichts sichtbar).
 *
 * ⚠️ Vorher lebte diese Funktion nur im Statistik-Router. Die Wert-Panels
 * (Preise, Abgaben, Impact) übernahmen `standortId` ungeprüft aus der Eingabe —
 * ein auf einen Standort beschränktes Konto konnte dort `null` schicken und sah
 * alles (festgestellt 17.09.2026, damals folgenlos, weil nur Sömmerda Daten hatte).
 */
export function statistikStandortFilter(
  ctx:              TRPCContext,
  filterStandortId?: number | null,
): number | number[] | null {
  const ids = getZugaenglicheStandortIds(ctx, filterStandortId);
  if (ids === null) return null;
  if (ids.length === 1) return ids[0] ?? null;
  return ids;
}

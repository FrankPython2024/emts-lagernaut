"use client";
import { useEffect } from "react";
import { api } from "@/trpc/react";
import { useSocket } from "@/hooks/useSocket";
import { EVENTS } from "@/modules/realtime/events";
import { usePermissions } from "@/hooks/usePermissions";

/**
 * Anzahl Anfragen im Status NEU für das Sidebar-Badge.
 *
 * - Permission-gated: liefert 0 ohne ANFRAGE_VIEW_ALL (Query bleibt disabled).
 * - Standort-Scoping passiert serverseitig.
 * - Live-Refresh über Socket: neue/aktualisierte/gelöschte Anfragen
 *   invalidieren den Zähler (kein F5 nötig). staleTime fängt den Polling-Druck ab.
 */
export function useNeueAnfragenZaehler(): number {
  const { has } = usePermissions();
  const erlaubt = has("ANFRAGE_VIEW_ALL");

  const utils = api.useUtils();
  const { on, off } = useSocket();

  const { data } = api.anfragen.zaehleNeue.useQuery(undefined, {
    enabled:   erlaubt,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!erlaubt) return;

    const refresh = () => { utils.anfragen.zaehleNeue.invalidate(); };

    on(EVENTS.ANFRAGE_NEU,       refresh);
    on(EVENTS.ANFRAGE_UPDATED,   refresh);
    on(EVENTS.ANFRAGE_GELOESCHT, refresh);

    return () => {
      off(EVENTS.ANFRAGE_NEU);
      off(EVENTS.ANFRAGE_UPDATED);
      off(EVENTS.ANFRAGE_GELOESCHT);
    };
  }, [erlaubt, on, off, utils]);

  return data ?? 0;
}

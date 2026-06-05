"use client";
import { useEffect } from "react";
import { api } from "@/trpc/react";
import { useSocket } from "@/hooks/useSocket";
import { useNow } from "@/hooks/useNow";
import { EVENTS } from "@/modules/realtime/events";
import { useStandortFilter } from "@/lib/standort/standortContext";
import { useNotifications } from "@/lib/notifications/notificationContext";
import { zeigeAnfrageNotification } from "@/lib/notifications/notify";
import { playPing } from "@/lib/notifications/ping";
import { istUeberfaellig, verstricheneZeit } from "@/lib/anfragen/ueberfaellig";

const LS_NOTIFIED_OVERDUE = "lagernaut.notified-overdue";

function readNotified(): Set<number> {
  try {
    const raw = localStorage.getItem(LS_NOTIFIED_OVERDUE);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? new Set(arr.filter((x): x is number => typeof x === "number")) : new Set();
  } catch {
    return new Set();
  }
}

function writeNotified(set: Set<number>): void {
  try { localStorage.setItem(LS_NOTIFIED_OVERDUE, JSON.stringify([...set])); } catch {}
}

/**
 * Admin-Browser-Notifications. Einmal im Admin-Layout gemountet.
 *
 * Zwei Trigger:
 *   1. Neue Anfrage (Socket `anfrage:neu`) — nur wenn das Fenster NICHT aktiv
 *      ist (sonst macht die Live-Liste das Update bereits).
 *   2. Überfälligkeit — sobald eine offene Anfrage die 1h-Marke überschreitet,
 *      genau einmal (Dedup über localStorage-Set). Der `useNow`-Tick bewertet
 *      die Grenze jede Minute neu.
 *
 * Macht nichts, wenn der Toggle aus oder die Permission nicht granted ist.
 *
 * TODO: deduplicate across tabs — bei mehreren offenen Admin-Tabs feuert aktuell
 *       jeder Tab. Per BroadcastChannel ließe sich ein „Leader"-Tab wählen.
 *       Frank arbeitet meist mit einem Tab, daher vorerst bewusst weggelassen.
 */
export function useAdminNotifications(): void {
  const { active }           = useNotifications();
  const { on, off }          = useSocket();
  const { activeStandortId } = useStandortFilter();
  const now                  = useNow(60_000);

  const { data: offene } = api.dashboard.offeneAnfragen.useQuery(
    { standortId: activeStandortId },
    { enabled: active, refetchInterval: 60_000, refetchIntervalInBackground: true, staleTime: 30_000 },
  );

  // ── Trigger 1: Neue Anfrage (Socket) ──────────────────────────────────────
  useEffect(() => {
    if (!active) return;
    const handler = (d: unknown) => {
      const a = d as {
        id: number; techniker: string; logId: string;
        geraeteName?: string | null; teil: string; gruppenNr?: string | null;
      };
      // Nur wenn der Tab/das Fenster gerade NICHT aktiv ist
      const fensterAktiv = !document.hidden && document.hasFocus();
      if (fensterAktiv) return;

      zeigeAnfrageNotification({
        title: "Neue Anfrage",
        body:  `${a.logId} · ${a.techniker} · ${a.geraeteName ?? a.teil}`,
        tag:   `anfrage-neu-${a.gruppenNr ?? a.id}`,
        href:  `/admin/anfragen?highlight=${a.id}`,
      });
      playPing();
    };

    on(EVENTS.ANFRAGE_NEU, handler);
    return () => off(EVENTS.ANFRAGE_NEU);
  }, [active, on, off]);

  // ── Trigger 1b: Pickup abgeschlossen (Socket) ─────────────────────────────
  // Gleiche Schiene: Ping (Glocken-Toggle respektiert) + Browser-Notification,
  // wenn das Fenster nicht aktiv ist. Der Toast kommt aus dem Admin-Layout.
  useEffect(() => {
    if (!active) return;
    const handler = (d: unknown) => {
      const p = d as { id: number; name: string; gesamt: number; gefunden: number; nichtGefunden: number };
      playPing();
      if (!document.hidden && document.hasFocus()) return;
      zeigeAnfrageNotification({
        title: "Pickup abgeschlossen",
        body:  `${p.name} — ${p.gefunden}/${p.gesamt} gefunden${p.nichtGefunden > 0 ? `, ${p.nichtGefunden} nicht gefunden` : ""}`,
        tag:   `pickup-abgeschlossen-${p.id}`,
        href:  `/admin/pickup/${p.id}`,
      });
    };
    on(EVENTS.PICKUP_ABGESCHLOSSEN, handler);
    return () => off(EVENTS.PICKUP_ABGESCHLOSSEN);
  }, [active, on, off]);

  // ── Trigger 2: Überfälligkeit (1h überschritten) ──────────────────────────
  useEffect(() => {
    if (!active || !offene) return;

    const offeneIds = new Set(offene.map((a) => a.id));
    // Set bereinigen: nur noch IDs behalten, die weiterhin offen sind
    // (abgeschlossene/stornierte fallen aus `offene` raus → werden vergessen).
    const notified = new Set([...readNotified()].filter((id) => offeneIds.has(id)));

    for (const a of offene) {
      if (istUeberfaellig(a.status, a.createdAt, now) && !notified.has(a.id)) {
        zeigeAnfrageNotification({
          title: "Anfrage überfällig",
          body:  `${a.logId} · ${a.techniker} · ${verstricheneZeit(a.createdAt, now)}`,
          tag:   `anfrage-ueberfaellig-${a.id}`,
          href:  `/admin/anfragen?highlight=${a.id}`,
        });
        playPing();
        notified.add(a.id);
      }
    }

    writeNotified(notified);
  }, [active, offene, now]);
}

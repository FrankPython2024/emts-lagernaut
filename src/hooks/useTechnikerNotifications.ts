"use client";
import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useSocket } from "@/hooks/useSocket";
import { EVENTS } from "@/modules/realtime/events";
import { useNotifications } from "@/lib/notifications/notificationContext";
import { zeigeAnfrageNotification } from "@/lib/notifications/notify";
import { playPing } from "@/lib/notifications/ping";

type SessionUser = { kuerzel?: string };

// Status → Notification-Titel (der Body trägt LogID + Modell)
const STATUS_TITEL: Record<string, string> = {
  ABGESCHLOSSEN:    "Teil bereit zur Abholung",
  BEDARF:           "Anfrage in Bedarf",
  NICHT_VERFUEGBAR: "⚠ Ersatzteil nicht verfügbar",
  STORNIERT:        "Anfrage storniert",
  // IN_BEARBEITUNG kommt über ANFRAGE_UEBERNOMMEN (eigener Handler)
};

function formatLogId(logId?: string | null): string {
  if (!logId || logId === "unbekannt") return "";
  const clean = logId.replace(/\D/g, "");
  return clean ? clean.replace(/(\d{3})(?=\d)/g, "$1.") : logId;
}

function baue(logId: string | null | undefined, modell: string | null | undefined): { body: string; href: string; key: string } {
  const logIdFmt = formatLogId(logId);
  const parts    = [logIdFmt, modell].filter(Boolean);
  const body     = parts.join(" · ") || "Anfrage aktualisiert";
  const hl       = logId && logId !== "unbekannt" ? logId : null;
  const href     = hl ? `/techniker?highlight=${encodeURIComponent(hl)}` : "/techniker";
  return { body, href, key: hl ?? "x" };
}

/**
 * Techniker-Browser-Notifications. Einmal im Techniker-Layout gemountet.
 *
 * Reagiert auf Server-Events (keine 1h-Logik — der Techniker reagiert auf das,
 * was der Admin tut):
 *   1. Status-Wechsel an eigener Anfrage (ANFRAGE_UPDATED + ANFRAGE_UEBERNOMMEN)
 *   2. Neue Chat-Nachricht (CHAT_NEU) — Auto-Nachrichten werden übersprungen,
 *      da der zugehörige Status (NICHT_VERFUEGBAR) bereits pingt.
 *
 * Alle Events sind serverseitig via emitToUser auf den eigenen Techniker
 * geroutet. Es wird nur gepingt, wenn der Tab NICHT aktiv ist (sonst übernimmt
 * der Tab-Counter im Titel). Macht nichts, wenn Toggle aus / Permission fehlt.
 *
 * TODO: deduplicate across tabs (BroadcastChannel) — wie beim Admin bewusst
 *       weggelassen.
 */
export function useTechnikerNotifications(): void {
  const { active }        = useNotifications();
  const { on, off }       = useSocket();
  const { data: session } = useSession();
  const kuerzel = (session?.user as SessionUser | undefined)?.kuerzel ?? "";

  useEffect(() => {
    if (!active || !kuerzel) return;
    const meins = kuerzel.toUpperCase();
    const fensterAktiv = () => !document.hidden && document.hasFocus();

    // ── Status-Wechsel (ABGESCHLOSSEN / BEDARF / NICHT_VERFUEGBAR / STORNIERT) ──
    const onStatus = (d: unknown) => {
      const p = d as { id: number; status: string; techniker?: string; logId?: string | null; geraeteName?: string | null };
      if (p.techniker && p.techniker.toUpperCase() !== meins) return; // nur eigene
      if (fensterAktiv()) return;
      const titel = STATUS_TITEL[p.status];
      if (!titel) return; // NEU o.ä. → keine Notification
      const { body, href, key } = baue(p.logId, p.geraeteName);
      zeigeAnfrageNotification({ title: titel, body, tag: `anfrage-status-${key === "x" ? p.id : key}`, href });
      playPing();
    };

    // ── In Bearbeitung genommen (ANFRAGE_UEBERNOMMEN, room-getargetet) ──
    const onUebernommen = (d: unknown) => {
      const p = d as { anfrageIds: number[]; logId?: string | null; geraeteName?: string | null };
      if (fensterAktiv()) return;
      const { body, href, key } = baue(p.logId, p.geraeteName);
      const tagId = key === "x" ? (p.anfrageIds?.[0] ?? "x") : key;
      zeigeAnfrageNotification({ title: "Anfrage in Bearbeitung", body, tag: `anfrage-status-${tagId}`, href });
      playPing();
    };

    // ── Neue Chat-Nachricht ──
    const onChat = (d: unknown) => {
      const p = d as {
        anfrageId: number; logId?: string | null; geraeteName?: string | null;
        autor?: string; vonKuerzel?: string; message?: string; inhalt?: string; isAutoMessage?: boolean;
      };
      if (p.isAutoMessage) return;                       // Auto-Nachricht → Status pingt bereits
      const autor = p.autor ?? p.vonKuerzel ?? "";
      if (autor.toUpperCase() === meins) return;         // eigene Nachricht nicht selbst pingen
      if (fensterAktiv()) return;
      const text     = (p.message ?? p.inhalt ?? "").slice(0, 60);
      const logIdFmt = formatLogId(p.logId);
      const { href, key } = baue(p.logId, p.geraeteName);
      const body = `${logIdFmt ? `${logIdFmt} · ` : ""}${autor}: ${text}`;
      zeigeAnfrageNotification({ title: "Neue Nachricht", body, tag: `chat-${key === "x" ? p.anfrageId : key}`, href });
      playPing();
    };

    on(EVENTS.ANFRAGE_UPDATED,     onStatus);
    on(EVENTS.ANFRAGE_UEBERNOMMEN, onUebernommen);
    on(EVENTS.CHAT_NEU,            onChat);
    return () => {
      off(EVENTS.ANFRAGE_UPDATED);
      off(EVENTS.ANFRAGE_UEBERNOMMEN);
      off(EVENTS.CHAT_NEU);
    };
  }, [active, kuerzel, on, off]);
}

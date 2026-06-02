"use client";
import { Bell, BellOff } from "lucide-react";
import { useNotifications } from "@/lib/notifications/notificationContext";

/**
 * Glocken-Toggle für Admin-Browser-Notifications. Drei sichtbare Zustände:
 *   • Aus       — graue Glocke (nie aktiviert ODER aktiv stummgeschaltet)
 *   • An        — cyan Glocke + grüner Punkt (Permission granted & aktiv)
 *   • Blockiert — graue durchgestrichene Glocke + roter Slash (denied)
 *
 * Klick-Logik steckt zentral im NotificationContext (handleToggle).
 */
export function NotificationToggle() {
  const { supported, permission, active, handleToggle } = useNotifications();

  if (!supported) return null;

  const blockiert = permission === "denied";

  const label = blockiert
    ? "Hinweise blockiert"
    : active
      ? "Hinweise an"
      : "Hinweise aus";

  const title = blockiert
    ? "Browser-Benachrichtigungen sind blockiert. In den Browser-Einstellungen (Schloss-Symbol in der Adressleiste) wieder erlauben."
    : active
      ? "Benachrichtigungen aktiv — Klick zum Stummschalten"
      : permission === "granted"
        ? "Benachrichtigungen aus — Klick zum Aktivieren"
        : "Benachrichtigungen aktivieren (Browser fragt nach Erlaubnis)";

  const ariaLabel = `Browser-Benachrichtigungen: ${
    blockiert ? "blockiert" : active ? "aktiv" : "inaktiv"
  }`;

  return (
    <button
      onClick={handleToggle}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={active}
      className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition-colors min-h-[44px]"
    >
      <span className="relative w-5 h-5 flex items-center justify-center flex-shrink-0">
        {blockiert ? (
          <BellOff size={18} className="text-gray-400 dark:text-gray-500" />
        ) : (
          <Bell size={18} className={active ? "text-cyan-600 dark:text-cyan-400" : "text-gray-400 dark:text-gray-500"} />
        )}
        {/* An-Indikator: grüner Punkt */}
        {active && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-500 ring-2 ring-white dark:ring-gray-900" aria-hidden />
        )}
        {/* Blockiert-Indikator: roter Slash */}
        {blockiert && (
          <span className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden>
            <span className="block w-[22px] h-[2px] bg-red-500 rotate-45 rounded-full" />
          </span>
        )}
      </span>
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}

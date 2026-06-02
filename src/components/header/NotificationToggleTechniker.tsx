"use client";
import { useNotifications } from "@/lib/notifications/notificationContext";

/**
 * Glocken-Toggle für Techniker-Browser-Notifications — kompakte Variante für
 * die Techniker-Header-Leiste (inline-Styling wie die übrigen Header-Buttons).
 *
 * Die gesamte Logik (Permission, localStorage, Ping) liegt geteilt im
 * NotificationContext — hier nur die Darstellung. Drei States: Aus / An /
 * Blockiert.
 */
export function NotificationToggleTechniker({ style }: { style?: React.CSSProperties }) {
  const { supported, permission, active, handleToggle } = useNotifications();

  if (!supported) return null;

  const blockiert = permission === "denied";
  const icon  = active ? "🔔" : "🔕";
  const label = blockiert ? "Blockiert" : active ? "An" : "Aus";
  const title = blockiert
    ? "Benachrichtigungen blockiert — im Browser (Schloss-Symbol in der Adressleiste) wieder erlauben"
    : active
      ? "Benachrichtigungen aktiv — Klick zum Stummschalten"
      : permission === "granted"
        ? "Benachrichtigungen aus — Klick zum Aktivieren"
        : "Benachrichtigungen aktivieren (Browser fragt nach Erlaubnis)";

  return (
    <button
      onClick={handleToggle}
      title={title}
      aria-label={`Benachrichtigungen: ${blockiert ? "blockiert" : active ? "aktiv" : "inaktiv"}`}
      aria-pressed={active}
      style={{
        ...style,
        display:     "inline-flex",
        alignItems:  "center",
        gap:         "0.3rem",
        position:    "relative",
        color:       blockiert ? "#dc2626" : active ? "var(--primary)" : "var(--text)",
        fontWeight:  active ? 700 : 600,
      }}
    >
      <span aria-hidden style={{ position: "relative", display: "inline-flex" }}>
        {icon}
        {active && (
          <span
            aria-hidden
            style={{
              position: "absolute", top: -2, right: -3, width: 7, height: 7,
              borderRadius: "50%", background: "#16a34a", border: "1.5px solid var(--card-bg)",
            }}
          />
        )}
      </span>
      {label}
    </button>
  );
}

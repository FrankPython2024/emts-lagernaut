"use client";

/**
 * Zeigt eine System-Benachrichtigung (Web-Notifications-API) für eine Anfrage.
 * Klick fokussiert das Fenster und springt zur Anfrage (?highlight=<id>,
 * dieselbe Logik wie im Überfällig-Widget).
 *
 * No-op, wenn Notifications nicht unterstützt oder nicht erlaubt sind.
 */
export function zeigeAnfrageNotification(opts: {
  title:       string;
  body:        string;
  tag:         string;
  highlightId: number;
}): void {
  if (typeof window === "undefined") return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  try {
    const n = new Notification(opts.title, {
      body: opts.body,
      tag:  opts.tag, // gleicher Tag → ersetzt statt stapelt (Duplikat-Schutz)
    });
    n.onclick = () => {
      window.focus();
      window.location.href = `/admin/anfragen?highlight=${opts.highlightId}`;
      n.close();
    };
  } catch {
    /* Notification-Konstruktor kann in manchen Kontexten werfen — ignorieren */
  }
}

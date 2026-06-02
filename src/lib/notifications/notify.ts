"use client";

/**
 * Zeigt eine System-Benachrichtigung (Web-Notifications-API) für eine Anfrage.
 * Klick fokussiert das Fenster und navigiert zur Ziel-URL `href`
 * (Admin: /admin/anfragen?highlight=…, Techniker: /techniker?highlight=…).
 *
 * No-op, wenn Notifications nicht unterstützt oder nicht erlaubt sind.
 */
export function zeigeAnfrageNotification(opts: {
  title: string;
  body:  string;
  tag:   string;
  href:  string;
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
      window.location.href = opts.href;
      n.close();
    };
  } catch {
    /* Notification-Konstruktor kann in manchen Kontexten werfen — ignorieren */
  }
}

// Alle Socket.io Event-Namen zentral definiert
export const EVENTS = {
  // Buchungen
  BUCHUNG_ERSTELLT:  "buchung:erstellt",
  BESTAND_UPDATED:   "bestand:updated",

  // Anfragen
  ANFRAGE_NEU:       "anfrage:neu",
  ANFRAGE_UPDATED:   "anfrage:updated",

  // Techniker Präsenz
  TECHNIKER_ONLINE:  "techniker:online",
  TECHNIKER_OFFLINE: "techniker:offline",

  // Nachrichten (Legacy)
  NACHRICHT_NEU:     "nachricht:neu",

  // Chat (Anfrage-gebunden)
  CHAT_NEU:          "chat:neu",

  // Activity
  ACTIVITY_NEU:      "activity:neu",

  // Intern
  PING:              "ping",
  PONG:              "pong",
} as const;

export type EventName = typeof EVENTS[keyof typeof EVENTS];

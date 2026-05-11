// Alle Socket.io Event-Namen zentral definiert
export const EVENTS = {
  // Buchungen
  BUCHUNG_ERSTELLT:  "buchung:erstellt",
  BESTAND_UPDATED:   "bestand:updated",

  // Anfragen
  ANFRAGE_NEU:          "anfrage:neu",
  ANFRAGE_UPDATED:      "anfrage:updated",
  ANFRAGE_UEBERNOMMEN:  "anfrage:uebernommen",
  ANFRAGE_FREIGEGEBEN:  "anfrage:freigegeben",

  // Techniker Präsenz
  TECHNIKER_ONLINE:  "techniker:online",
  TECHNIKER_OFFLINE: "techniker:offline",

  // Nachrichten (Legacy)
  NACHRICHT_NEU:     "nachricht:neu",

  // Chat (Anfrage-gebunden)
  CHAT_NEU:          "chat:neu",

  // Activity
  ACTIVITY_NEU:      "activity:neu",

  // Stress-Test Benchmark
  STRESSTEST_EVENT:   "stresstest:event",
  STRESSTEST_METRICS: "stresstest:metrics",
  STRESSTEST_DONE:    "stresstest:done",

  // Intern
  PING:              "ping",
  PONG:              "pong",
} as const;

export type EventName = typeof EVENTS[keyof typeof EVENTS];

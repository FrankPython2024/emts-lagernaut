import { prisma } from "@/core/db/prisma";

// empfKuerzel-Konstante für Admin-Gruppe
export const ADMIN_EMPF = "ADMIN";

/**
 * Alle Chat-Nachrichten einer Anfrage (chronologisch).
 */
export async function getByAnfrage(anfrageId: number) {
  return prisma.chatNachricht.findMany({
    where:   { anfrageId },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Techniker einer Anfrage ermitteln.
 */
export async function getTechnikerVonAnfrage(anfrageId: number): Promise<string | null> {
  const anfrage = await prisma.anfrage.findUnique({
    where:  { id: anfrageId },
    select: { techniker: true },
  });
  return anfrage?.techniker ?? null;
}

/**
 * Nachricht senden.
 * empfKuerzel wird vom Router bestimmt (Admin → techniker | Techniker → "ADMIN")
 */
export async function senden(data: {
  anfrageId:   number;
  vonKuerzel:  string;
  empfKuerzel: string;
  inhalt:      string;
}) {
  return prisma.chatNachricht.create({ data });
}

/**
 * Alle ungelesenen Nachrichten einer Anfrage als gelesen markieren
 * (nur die, die für den aktuellen User bestimmt waren).
 */
export async function markGelesen(anfrageId: number, empfKuerzel: string) {
  return prisma.chatNachricht.updateMany({
    where: { anfrageId, empfKuerzel, gelesen: false },
    data:  { gelesen: true, gelesenAt: new Date() },
  });
}

/**
 * Gesamtzahl ungelesener Chat-Nachrichten für den User → Glocken-Badge.
 */
export async function getUngelesenCount(empfKuerzel: string): Promise<number> {
  return prisma.chatNachricht.count({
    where: { empfKuerzel, gelesen: false },
  });
}

/**
 * Ungelesene Nachrichten pro Anfrage → für Badges an Anfrage-Karten.
 */
export async function getUngelesenProAnfrage(
  empfKuerzel: string,
): Promise<{ anfrageId: number | null; count: number }[]> {
  const rows = await prisma.chatNachricht.groupBy({
    by:     ["anfrageId"],
    where:  { empfKuerzel, gelesen: false },
    _count: { id: true },
  });
  return rows.map((r) => ({ anfrageId: r.anfrageId, count: r._count.id }));
}

/**
 * Alle Stats einer Anfrage auf einmal:
 * ungelesen, letzte Nachricht, Gesamtanzahl.
 * Optimiert für per-Karte Polling im Techniker-Portal.
 */
export async function getStatsForAnfrage(
  anfrageId: number,
  empfKuerzel: string,
): Promise<{
  ungelesen:      number;
  letzteNachricht: { inhalt: string; vonKuerzel: string; createdAt: Date } | null;
  gesamtAnzahl:   number;
}> {
  const [ungelesen, letzteNachricht, gesamtAnzahl] = await Promise.all([
    prisma.chatNachricht.count({
      where: { anfrageId, empfKuerzel, gelesen: false },
    }),
    prisma.chatNachricht.findFirst({
      where:   { anfrageId },
      orderBy: { createdAt: "desc" },
      select:  { inhalt: true, vonKuerzel: true, createdAt: true },
    }),
    prisma.chatNachricht.count({
      where: { anfrageId },
    }),
  ]);
  return { ungelesen, letzteNachricht: letzteNachricht ?? null, gesamtAnzahl };
}

/**
 * Stats für mehrere Anfragen auf einmal → effizienter Batch-Aufruf für Admin-Liste.
 */
export async function getStatsBatch(
  anfrageIds: number[],
  empfKuerzel: string,
): Promise<{
  anfrageId:       number;
  ungelesen:       number;
  letzteNachricht: { inhalt: string; vonKuerzel: string; createdAt: Date } | null;
  gesamtAnzahl:    number;
}[]> {
  if (anfrageIds.length === 0) return [];

  const [ungeleseneRows, nachrichten, gesamtRows] = await Promise.all([
    prisma.chatNachricht.groupBy({
      by:     ["anfrageId"],
      where:  { anfrageId: { in: anfrageIds }, empfKuerzel, gelesen: false },
      _count: { id: true },
    }),
    prisma.chatNachricht.findMany({
      where:   { anfrageId: { in: anfrageIds } },
      orderBy: { createdAt: "desc" },
      select:  { anfrageId: true, inhalt: true, vonKuerzel: true, createdAt: true },
    }),
    prisma.chatNachricht.groupBy({
      by:     ["anfrageId"],
      where:  { anfrageId: { in: anfrageIds } },
      _count: { id: true },
    }),
  ]);

  // Neueste Nachricht pro Anfrage (nachrichten ist DESC sortiert)
  const latestMap = new Map<number, { inhalt: string; vonKuerzel: string; createdAt: Date }>();
  for (const n of nachrichten) {
    if (n.anfrageId !== null && !latestMap.has(n.anfrageId)) {
      latestMap.set(n.anfrageId, { inhalt: n.inhalt, vonKuerzel: n.vonKuerzel, createdAt: n.createdAt });
    }
  }

  return anfrageIds.map((id) => ({
    anfrageId:       id,
    ungelesen:       ungeleseneRows.find((u) => u.anfrageId === id)?._count.id ?? 0,
    letzteNachricht: latestMap.get(id) ?? null,
    gesamtAnzahl:    gesamtRows.find((c) => c.anfrageId === id)?._count.id ?? 0,
  }));
}

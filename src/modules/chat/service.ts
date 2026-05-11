import { prisma }        from "@/core/db/prisma";
import { NachrichtTyp } from "@prisma/client";

// Empfänger-Konstante für die Admin-Gruppe
export const ADMIN_EMPF = "ADMIN";

// logId-Prefix damit Chat-Nachrichten von Legacy-Nachrichten trennbar bleiben
const CHAT_PREFIX = "chat:";

function toLogId(anfrageId: number): string {
  return `${CHAT_PREFIX}${anfrageId}`;
}

function fromLogId(logId: string | null | undefined): number | null {
  if (!logId?.startsWith(CHAT_PREFIX)) return null;
  const n = parseInt(logId.slice(CHAT_PREFIX.length), 10);
  return isNaN(n) ? null : n;
}

/**
 * Alle Chat-Nachrichten einer Anfrage (chronologisch).
 * Nutzt Nachricht.logId = "chat:{anfrageId}" statt separater Tabelle.
 */
export async function getByAnfrage(anfrageId: number) {
  return prisma.nachricht.findMany({
    where:   { logId: toLogId(anfrageId) },
    orderBy: { createdAt: "asc" },
    select:  { id: true, vonKuerzel: true, inhalt: true, createdAt: true },
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
 * Chat-Nachricht senden.
 * Erstellt Nachricht + NachrichtEmpf für den Empfänger.
 */
export async function senden(data: {
  anfrageId:   number;
  vonKuerzel:  string;
  empfKuerzel: string;
  inhalt:      string;
}) {
  return prisma.nachricht.create({
    data: {
      betreff:    data.inhalt.substring(0, 100),
      inhalt:     data.inhalt,
      vonKuerzel: data.vonKuerzel,
      typ:        NachrichtTyp.DIREKT,
      logId:      toLogId(data.anfrageId),
      empfaenger: {
        create: { empfKuerzel: data.empfKuerzel },
      },
    },
  });
}

/**
 * Alle ungelesenen Nachrichten eines Chats als gelesen markieren.
 */
export async function markGelesen(anfrageId: number, empfKuerzel: string) {
  const msgIds = await prisma.nachricht.findMany({
    where:  { logId: toLogId(anfrageId) },
    select: { id: true },
  });
  if (msgIds.length === 0) return;
  return prisma.nachrichtEmpf.updateMany({
    where: {
      nachrichtId: { in: msgIds.map((m) => m.id) },
      empfKuerzel,
      gelesen: false,
    },
    data: { gelesen: true, gelesenAt: new Date() },
  });
}

/**
 * Gesamtzahl ungelesener Chat-Nachrichten für den User → Glocken-Badge.
 */
export async function getUngelesenCount(empfKuerzel: string): Promise<number> {
  return prisma.nachrichtEmpf.count({
    where: {
      empfKuerzel,
      gelesen:   false,
      nachricht: { logId: { startsWith: CHAT_PREFIX } },
    },
  });
}

/**
 * Ungelesene Chat-Nachrichten pro Anfrage → Badges an Anfrage-Karten.
 */
export async function getUngelesenProAnfrage(
  empfKuerzel: string,
): Promise<{ anfrageId: number | null; count: number }[]> {
  const records = await prisma.nachrichtEmpf.findMany({
    where: {
      empfKuerzel,
      gelesen:   false,
      nachricht: { logId: { startsWith: CHAT_PREFIX } },
    },
    include: { nachricht: { select: { logId: true } } },
  });

  const map = new Map<number, number>();
  for (const r of records) {
    const id = fromLogId(r.nachricht.logId);
    if (id !== null) map.set(id, (map.get(id) ?? 0) + 1);
  }
  return Array.from(map.entries()).map(([anfrageId, count]) => ({ anfrageId, count }));
}

/**
 * Alle Stats einer Anfrage auf einmal:
 * ungelesen, letzte Nachricht, Gesamtanzahl.
 */
export async function getStatsForAnfrage(
  anfrageId: number,
  empfKuerzel: string,
): Promise<{
  ungelesen:       number;
  letzteNachricht: { inhalt: string; vonKuerzel: string; createdAt: Date } | null;
  gesamtAnzahl:    number;
}> {
  const logId = toLogId(anfrageId);
  const [nachrichten, ungelesen] = await Promise.all([
    prisma.nachricht.findMany({
      where:   { logId },
      orderBy: { createdAt: "desc" },
      select:  { inhalt: true, vonKuerzel: true, createdAt: true },
    }),
    prisma.nachrichtEmpf.count({
      where: { empfKuerzel, gelesen: false, nachricht: { logId } },
    }),
  ]);

  return {
    ungelesen,
    letzteNachricht: nachrichten[0]
      ? { inhalt: nachrichten[0].inhalt, vonKuerzel: nachrichten[0].vonKuerzel, createdAt: nachrichten[0].createdAt }
      : null,
    gesamtAnzahl: nachrichten.length,
  };
}

/**
 * Batch-Stats für mehrere Anfragen → Admin Anfragen-Liste.
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
  const logIds = anfrageIds.map(toLogId);

  const [nachrichten, empfRecords] = await Promise.all([
    prisma.nachricht.findMany({
      where:   { logId: { in: logIds } },
      orderBy: { createdAt: "desc" },
      select:  { logId: true, inhalt: true, vonKuerzel: true, createdAt: true },
    }),
    prisma.nachrichtEmpf.findMany({
      where: {
        empfKuerzel,
        gelesen:   false,
        nachricht: { logId: { in: logIds } },
      },
      include: { nachricht: { select: { logId: true } } },
    }),
  ]);

  // Neueste Nachricht + Gesamtanzahl pro Anfrage (nachrichten ist DESC sortiert)
  const latestMap = new Map<number, { inhalt: string; vonKuerzel: string; createdAt: Date }>();
  const countMap  = new Map<number, number>();
  for (const n of nachrichten) {
    const id = fromLogId(n.logId);
    if (id === null) continue;
    if (!latestMap.has(id)) latestMap.set(id, { inhalt: n.inhalt, vonKuerzel: n.vonKuerzel, createdAt: n.createdAt });
    countMap.set(id, (countMap.get(id) ?? 0) + 1);
  }

  const ungeleseneMap = new Map<number, number>();
  for (const r of empfRecords) {
    const id = fromLogId(r.nachricht.logId);
    if (id !== null) ungeleseneMap.set(id, (ungeleseneMap.get(id) ?? 0) + 1);
  }

  return anfrageIds.map((id) => ({
    anfrageId:       id,
    ungelesen:       ungeleseneMap.get(id) ?? 0,
    letzteNachricht: latestMap.get(id) ?? null,
    gesamtAnzahl:    countMap.get(id) ?? 0,
  }));
}

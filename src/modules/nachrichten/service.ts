import { NachrichtTyp, UserRolle } from "@prisma/client";
import { prisma } from "@/core/db/prisma";

export type SendeNachrichtData = {
  empfaenger: string[] | "ALL";
  betreff:    string;
  inhalt:     string;
  typ:        NachrichtTyp;
  vonKuerzel: string;
  logId?:     string;
};

export async function sendeNachricht(data: SendeNachrichtData) {
  let empfKuerzel: string[];

  if (data.empfaenger === "ALL") {
    const users = await prisma.user.findMany({
      where:  { aktiv: true, rolle: { in: [UserRolle.TECHNIKER, UserRolle.BETRACHTER] } },
      select: { kuerzel: true },
    });
    empfKuerzel = users.map((u) => u.kuerzel);
  } else {
    empfKuerzel = data.empfaenger;
  }

  // logId in inhalt einbetten damit Text-Suche funktioniert (kein DB-Schema-Upgrade nötig)
  const inhalt = data.logId && !data.inhalt.includes(data.logId)
    ? `${data.inhalt}\n\n[LogID: ${data.logId}]`
    : data.inhalt;

  return prisma.nachricht.create({
    data: {
      betreff:    data.betreff,
      inhalt,                    // enthält logId als eingebetteten Text
      vonKuerzel: data.vonKuerzel,
      typ:        data.typ,
      // logId als Spalte erst nach ALTER TABLE Nachricht ADD COLUMN logId VARCHAR(100) NULL;
      empfaenger: {
        create: empfKuerzel.map((kuerzel) => ({ empfKuerzel: kuerzel })),
      },
    },
    include: { empfaenger: true },
  });
}

/**
 * Ungelesene Nachrichten für eine LogID.
 * Primär: logId-Spalte (nach ALTER TABLE Nachricht ADD COLUMN logId VARCHAR(100) NULL)
 * Fallback: Text-Suche im inhalt (logId wird beim Senden eingebettet als "[LogID: XXX]")
 */
export async function getByLogId(kuerzel: string, logId: string) {
  const INCLUDE = {
    nachricht: { include: { antworten: { orderBy: { createdAt: "asc" as const } } } },
  } as const;
  const ORDER = { nachricht: { createdAt: "desc" as const } } as const;

  // Primär: exakter logId-Spalten-Match (schnell, präzise)
  try {
    const results = await prisma.nachrichtEmpf.findMany({
      where:   { empfKuerzel: kuerzel, gelesen: false, nachricht: { logId } },
      include: INCLUDE,
      orderBy: ORDER,
      take:    5,
    });
    // Wenn Spalte existiert aber keine Ergebnisse → Text-Suche als Ergänzung
    if (results.length > 0) return results;
  } catch {
    // Spalte existiert noch nicht → weiter zum Fallback
  }

  // Fallback: Text-Suche im inhalt (logId wurde beim Senden eingebettet)
  return prisma.nachrichtEmpf.findMany({
    where: {
      empfKuerzel: kuerzel,
      gelesen:     false,
      nachricht: {
        inhalt: { contains: logId },
      },
    },
    include: INCLUDE,
    orderBy: ORDER,
    take:    5,
  });
}

export async function sendeSystemNachricht(data: {
  empfKuerzel: string;
  betreff:     string;
  inhalt:      string;
}) {
  return sendeNachricht({
    empfaenger: [data.empfKuerzel],
    betreff:    data.betreff,
    inhalt:     data.inhalt,
    typ:        NachrichtTyp.SYSTEM,
    vonKuerzel: "SYSTEM",
  });
}

export async function getInbox(kuerzel: string) {
  const records = await prisma.nachrichtEmpf.findMany({
    where:   { empfKuerzel: kuerzel },
    include: {
      nachricht: {
        include: {
          antworten: { orderBy: { createdAt: "asc" } },
        },
      },
    },
    orderBy: [
      { gelesen:   "asc" },
      { nachricht: { createdAt: "desc" } },
    ],
  });

  const ungelesen = records.filter((r) => !r.gelesen).length;
  return { nachrichten: records, ungelesen };
}

export async function getUngelesen(kuerzel: string): Promise<number> {
  return prisma.nachrichtEmpf.count({
    where: { empfKuerzel: kuerzel, gelesen: false },
  });
}

export async function markGelesen(nachrichtId: number, kuerzel: string) {
  return prisma.nachrichtEmpf.updateMany({
    where: { nachrichtId, empfKuerzel: kuerzel },
    data:  { gelesen: true, gelesenAt: new Date() },
  });
}

export async function alleMarkierenGelesen(kuerzel: string) {
  return prisma.nachrichtEmpf.updateMany({
    where: { empfKuerzel: kuerzel, gelesen: false },
    data:  { gelesen: true, gelesenAt: new Date() },
  });
}

export async function erstelleAntwort(data: {
  nachrichtId: number;
  vonKuerzel:  string;
  inhalt:      string;
}) {
  return prisma.nachrichtAntwort.create({
    data: {
      nachrichtId: data.nachrichtId,
      vonKuerzel:  data.vonKuerzel,
      inhalt:      data.inhalt,
    },
  });
}

// Admin: alle Nachrichten im System (neueste zuerst)
export async function getAlleNachrichten() {
  return prisma.nachricht.findMany({
    include: {
      empfaenger: true,
      antworten:  { orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });
}

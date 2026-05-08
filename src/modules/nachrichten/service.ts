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

  return prisma.nachricht.create({
    data: {
      betreff:    data.betreff,
      inhalt:     data.inhalt,
      vonKuerzel: data.vonKuerzel,
      typ:        data.typ,
      logId:      data.logId ?? null,
      empfaenger: {
        create: empfKuerzel.map((kuerzel) => ({ empfKuerzel: kuerzel })),
      },
    },
    include: { empfaenger: true },
  });
}

/**
 * Alle ungelesenen Nachrichten eines Technikers für eine bestimmte LogID.
 */
export async function getByLogId(kuerzel: string, logId: string) {
  return prisma.nachrichtEmpf.findMany({
    where: {
      empfKuerzel: kuerzel,
      gelesen:     false,
      nachricht:   { logId },
    },
    include: {
      nachricht: {
        include: { antworten: { orderBy: { createdAt: "asc" } } },
      },
    },
    orderBy: { nachricht: { createdAt: "desc" } },
    take: 5,
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

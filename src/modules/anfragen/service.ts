import { AnfrageStatus, BuchungsTyp, type Anfrage } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { prisma } from "@/core/db/prisma";
import { bucheLager, syncBestandAusHistorie } from "@/modules/buchungen/service";
import { sendeSystemNachricht } from "@/modules/nachrichten/service";
import { emitToAdmins, emitToAll, emitToUser } from "@/modules/realtime/socket";
import { EVENTS } from "@/modules/realtime/events";

export type GruppenAnfrage = {
  gruppenNr:    string | null;
  korbId:       number | null;
  techniker:    string;
  logId:        string;
  geraeteName:  string | null;
  anfragen:     Anfrage[];
  gruppenStatus: AnfrageStatus;
  datum:        Date;
};

export type ErstelleAnfrageData = {
  techniker:   string;
  logId:       string;
  geraeteName?: string;
  geraet:      string;
  artikelId:   number;
  teil:        string;
  grading?:    string;
  kommentar?:  string;
  gruppenNr?:  string;
  korbId?:     number;
};

/**
 * Neue Ersatzteil-Anfrage erstellen.
 * Bestand > 0 → Status NEU
 * Bestand = 0 → Status BEDARF
 */
export async function erstelleAnfrage(data: ErstelleAnfrageData): Promise<Anfrage> {
  const artikel = await prisma.artikel.findUnique({
    where:  { id: data.artikelId },
    select: { id: true, kategorie: true, bestand: true },
  });

  if (!artikel) {
    throw new TRPCError({
      code:    "NOT_FOUND",
      message: `Artikel ${data.artikelId} nicht gefunden.`,
    });
  }

  const status: AnfrageStatus =
    artikel.bestand > 0 ? AnfrageStatus.NEU : AnfrageStatus.BEDARF;

  const anfrage = await prisma.anfrage.create({
    data: {
      techniker:   data.techniker.toUpperCase().trim(),
      logId:       data.logId.trim(),
      geraeteName: data.geraeteName,
      geraet:      data.geraet.toUpperCase().trim(),
      artikelId:   data.artikelId,
      teil:        data.teil,
      menge:       1,
      grading:     data.grading,
      kommentar:   data.kommentar,
      gruppenNr:   data.gruppenNr,
      korbId:      data.korbId,
      status,
    },
  });

  // Socket.io: neue Anfrage live an Admins pushen
  emitToAdmins(EVENTS.ANFRAGE_NEU, {
    id:          anfrage.id,
    techniker:   anfrage.techniker,
    logId:       anfrage.logId,
    geraeteName: anfrage.geraeteName,
    teil:        anfrage.teil,
    status:      anfrage.status,
  });

  return anfrage;
}

/**
 * Anfrage stornieren.
 * Matching: techniker + logId + teil (wie storniereAnfrageTechniker in code.gs).
 * Nur NEU oder BEDARF stornierbar.
 */
export async function storniereAnfrage(data: {
  techniker: string;
  logId:     string;
  teil:      string;
}): Promise<void> {
  const anfrage = await prisma.anfrage.findFirst({
    where: {
      techniker: data.techniker.toUpperCase().trim(),
      logId:     data.logId.trim(),
      teil:      data.teil.trim(),
      status:    { in: [AnfrageStatus.NEU, AnfrageStatus.BEDARF] },
    },
    select: { id: true, status: true, artikelId: true },
  });

  if (!anfrage) {
    throw new TRPCError({
      code:    "NOT_FOUND",
      message: "Keine stornierbare Anfrage gefunden (nur NEU oder BEDARF möglich).",
    });
  }

  await prisma.anfrage.update({
    where: { id: anfrage.id },
    data:  { status: AnfrageStatus.STORNIERT },
  });

  await syncBestandAusHistorie(anfrage.artikelId);
}

/**
 * Status einer Anfrage ändern (Admin).
 * Bei ABGESCHLOSSEN: Bestand wird synchronisiert.
 */
export async function setzeStatus(id: number, status: AnfrageStatus): Promise<Anfrage> {
  const anfrage = await prisma.anfrage.findUnique({
    where:  { id },
    select: { id: true, artikelId: true, status: true },
  });

  if (!anfrage) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Anfrage nicht gefunden." });
  }

  const aktualisiert = await prisma.anfrage.update({
    where: { id },
    data:  { status },
    include: { artikel: { select: { id: true, bezeichnung: true } } },
  });

  // Socket.io: Status-Update live broadcasten
  emitToAll(EVENTS.ANFRAGE_UPDATED, { id, status });
  emitToUser(aktualisiert.techniker, EVENTS.ANFRAGE_UPDATED, { id, status });

  if (status === AnfrageStatus.ABGESCHLOSSEN) {
    await syncBestandAusHistorie(anfrage.artikelId);
    // System-Nachricht an Techniker: Teil bereit
    await sendeSystemNachricht({
      empfKuerzel: aktualisiert.techniker,
      betreff:     "✅ Teil bereit zur Abholung",
      inhalt:
        `Dein angefragtes Teil "${aktualisiert.teil}" für Gerät ${aktualisiert.geraeteName ?? aktualisiert.geraet} ` +
        `(LogID: ${aktualisiert.logId}) liegt zur Abholung bereit.` +
        (aktualisiert.grading ? `\nGrading: ${aktualisiert.grading}` : ""),
    }).catch(() => { /* Nachricht ist nicht kritisch */ });
  }

  if (status === AnfrageStatus.BEDARF && anfrage.status !== AnfrageStatus.BEDARF) {
    // System-Nachricht an Techniker: Teil nicht verfügbar
    await sendeSystemNachricht({
      empfKuerzel: aktualisiert.techniker,
      betreff:     "⚠️ Teil nicht verfügbar",
      inhalt:
        `Das angefragte Teil "${aktualisiert.teil}" für ` +
        `${aktualisiert.geraeteName ?? aktualisiert.geraet} ist leider nicht auf Lager. ` +
        `Wir informieren dich sobald es verfügbar ist.`,
    }).catch(() => { /* Nachricht ist nicht kritisch */ });
  }

  return aktualisiert;
}

/**
 * Anfrage abschließen: erstellt AUSGANG-Buchung (Bestand -1), setzt Status ABGESCHLOSSEN,
 * sendet System-Nachricht. Gibt Daten für den Auslagerbeleg zurück.
 */
export async function schliesseAnfrageAb(id: number, mitarbeiter: string) {
  const anfrage = await prisma.anfrage.findUnique({
    where:   { id },
    include: { artikel: { select: { id: true, bezeichnung: true, lagerplatz: true, kategorie: true } } },
  });

  if (!anfrage) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Anfrage nicht gefunden." });
  }
  if (anfrage.status === AnfrageStatus.ABGESCHLOSSEN) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Anfrage bereits abgeschlossen." });
  }

  // AUSGANG Buchung erstellen (dekrementiert Bestand)
  await bucheLager({
    artikelId:   anfrage.artikelId,
    menge:       anfrage.menge,
    typ:         BuchungsTyp.AUSGANG,
    mitarbeiter,
    notiz:       `Anfrage #${id}`,
  });

  // Status setzen
  await prisma.anfrage.update({ where: { id }, data: { status: AnfrageStatus.ABGESCHLOSSEN } });

  // System-Nachricht an Techniker (non-blocking)
  sendeSystemNachricht({
    empfKuerzel: anfrage.techniker,
    betreff:     "✅ Teil bereit zur Abholung",
    inhalt:
      `Dein angefragtes Teil "${anfrage.teil}" für ` +
      `${anfrage.geraeteName ?? anfrage.geraet} (LogID: ${anfrage.logId}) liegt zur Abholung bereit.` +
      (anfrage.grading ? `\nGrading: ${anfrage.grading}` : ""),
  }).catch(() => {});

  // Aktuellen Bestand holen
  const aktuellerArtikel = await prisma.artikel.findUnique({
    where:  { id: anfrage.artikelId },
    select: { bestand: true },
  });

  return {
    anfrageId:   id,
    teilName:    anfrage.teil,
    techniker:   anfrage.techniker,
    logId:       anfrage.logId,
    geraeteName: anfrage.geraeteName,
    grading:     anfrage.grading,
    kommentar:   anfrage.kommentar,
    restBestand: aktuellerArtikel?.bestand ?? 0,
    artikel:     anfrage.artikel,
  };
}

/**
 * Anfragen eines Technikers.
 * showAll=false → nur NEU + BEDARF (offene Anfragen)
 * showAll=true  → alle inkl. Geschichte
 */
export async function getAnfragenByTechniker(data: {
  techniker: string;
  showAll:   boolean;
  limit?:    number;
  offset?:   number;
}) {
  const limit  = data.limit  ?? 20;
  const offset = data.offset ?? 0;

  const where = {
    techniker: data.techniker.toUpperCase().trim(),
    ...(!data.showAll && {
      status: { in: [AnfrageStatus.NEU, AnfrageStatus.BEDARF] },
    }),
  };

  const [anfragen, total] = await Promise.all([
    prisma.anfrage.findMany({
      where,
      orderBy: { datum: "desc" },
      take:    limit,
      skip:    offset,
      include: {
        artikel: { select: { id: true, bezeichnung: true, kategorie: true } },
      },
    }),
    prisma.anfrage.count({ where }),
  ]);

  return { anfragen, total, hasMore: offset + limit < total };
}

/**
 * Alle Anfragen gruppiert — für Admin-Ansicht.
 * Gruppen nach korbId oder gruppenNr, mit berechnetem Gruppen-Status.
 */
export async function getAnfragenGruppiert(input?: {
  status?:    AnfrageStatus;
  techniker?: string;
  von?:       Date;
  bis?:       Date;
}): Promise<GruppenAnfrage[]> {
  const where = {
    ...(input?.status    && { status: input.status }),
    ...(input?.techniker && { techniker: input.techniker.toUpperCase().trim() }),
    ...(input?.von || input?.bis
      ? { datum: {
            ...(input?.von && { gte: input.von }),
            ...(input?.bis && { lte: input.bis }),
          },
        }
      : {}),
  };

  const anfragen = await prisma.anfrage.findMany({
    where,
    orderBy: { datum: "desc" },
    include: { artikel: { select: { id: true, bezeichnung: true, kategorie: true } } },
  });

  // Gruppieren nach korbId > gruppenNr > einzeln
  const gruppenMap = new Map<string, GruppenAnfrage>();

  for (const a of anfragen) {
    const key = a.korbId
      ? `korb-${a.korbId}`
      : a.gruppenNr
        ? `gruppe-${a.gruppenNr}`
        : `einzeln-${a.id}`;

    if (!gruppenMap.has(key)) {
      gruppenMap.set(key, {
        gruppenNr:    a.gruppenNr,
        korbId:       a.korbId,
        techniker:    a.techniker,
        logId:        a.logId,
        geraeteName:  a.geraeteName,
        anfragen:     [],
        gruppenStatus: a.status,
        datum:        a.datum,
      });
    }

    const gruppe = gruppenMap.get(key)!;
    gruppe.anfragen.push(a);

    // Gruppen-Status: schlechtester Status gewinnt
    const rang: Record<AnfrageStatus, number> = {
      ABGESCHLOSSEN: 4,
      NEU:           3,
      BEDARF:        2,
      STORNIERT:     1,
    };

    if (rang[a.status] < rang[gruppe.gruppenStatus]) {
      gruppe.gruppenStatus = a.status;
    }
  }

  return Array.from(gruppenMap.values());
}

/**
 * Alle Anfragen für Admin mit Filter und Pagination.
 */
export async function getAnfragenAdmin(input: {
  status?:    AnfrageStatus;
  techniker?: string;
  von?:       Date;
  bis?:       Date;
  limit:      number;
  offset:     number;
}) {
  const where = {
    ...(input.status    && { status: input.status }),
    ...(input.techniker && { techniker: input.techniker.toUpperCase().trim() }),
    ...(input.von || input.bis
      ? { datum: {
            ...(input.von && { gte: input.von }),
            ...(input.bis && { lte: input.bis }),
          },
        }
      : {}),
  };

  const [anfragen, total] = await Promise.all([
    prisma.anfrage.findMany({
      where,
      orderBy: { datum: "desc" },
      take:    input.limit,
      skip:    input.offset,
      include: {
        artikel: {
          select: { id: true, bezeichnung: true, kategorie: true, lagerplatz: true },
        },
      },
    }),
    prisma.anfrage.count({ where }),
  ]);

  return { anfragen, total, hasMore: input.offset + input.limit < total };
}

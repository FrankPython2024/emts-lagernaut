import { AnfrageStatus, BuchungsTyp, type Anfrage } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { prisma } from "@/core/db/prisma";
import { bucheLager, syncBestandAusHistorie } from "@/modules/buchungen/service";
import { sendeSystemNachricht } from "@/modules/nachrichten/service";
import { emitToAdmins, emitToAll, emitToUser } from "@/modules/realtime/socket";
import { EVENTS } from "@/modules/realtime/events";
import { invalidateTechnikerCache } from "@/modules/statistik/service";
import { meilisearchSync } from "@/core/infra/meilisearchSync";

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
  techniker:        string;
  logId:            string;
  geraeteName?:     string;
  geraet:           string;
  artikelId:        number | null;
  teil:             string;
  grading?:         string;
  kommentar?:       string;
  gruppenNr?:       string;
  korbId?:          number;
  // Sonderanfragen
  istSonderAnfrage?: boolean;
  beschreibung?:     string;
  sonderKategorie?:  string;
};

/**
 * Neue Ersatzteil-Anfrage erstellen.
 */
export async function erstelleAnfrage(data: ErstelleAnfrageData): Promise<Anfrage> {
  let status: AnfrageStatus = AnfrageStatus.BEDARF;

  if (data.artikelId) {
    const artikel = await prisma.artikel.findUnique({
      where:  { id: data.artikelId },
      select: { id: true, kategorie: true, bestand: true },
    });
    if (!artikel) throw new TRPCError({ code: "NOT_FOUND", message: `Artikel ${data.artikelId} nicht gefunden.` });
    status = artikel.bestand > 0 ? AnfrageStatus.NEU : AnfrageStatus.BEDARF;
  }

  // Sonderanfragen sind immer BEDARF (kein Lagerartikel verknüpft)
  if (data.istSonderAnfrage) status = AnfrageStatus.BEDARF;

  const anfrage = await prisma.anfrage.create({
    data: {
      techniker:        data.techniker.toUpperCase().trim(),
      logId:            data.logId.trim(),
      geraeteName:      data.geraeteName,
      geraet:           data.geraet.toUpperCase().trim(),
      artikelId:        data.artikelId,
      teil:             data.teil,
      menge:            1,
      grading:          data.grading,
      kommentar:        data.kommentar,
      gruppenNr:        data.gruppenNr,
      korbId:           data.korbId,
      status,
      istSonderAnfrage: data.istSonderAnfrage ?? false,
      beschreibung:     data.beschreibung,
      sonderKategorie:  data.sonderKategorie,
    },
  });

  meilisearchSync.anfrage(anfrage.id);
  invalidateTechnikerCache(anfrage.techniker).catch(() => {});
  emitToAdmins(EVENTS.ANFRAGE_NEU, {
    id: anfrage.id, techniker: anfrage.techniker, logId: anfrage.logId,
    geraeteName: anfrage.geraeteName, teil: anfrage.teil, status: anfrage.status,
  });

  return anfrage;
}

/**
 * Anfrage stornieren — Techniker: nur eigene, nur NEU/BEDARF.
 *
 * Bevorzugte Variante: per `id` — eindeutig auch wenn mehrere Anfragen mit
 * gleichem Teil existieren (z.B. historische Wiederanfragen).
 * Legacy-Variante: per `logId + teil` — bleibt für Stresstest + AnfragenBox erhalten.
 */
export async function storniereAnfrage(
  data:
    | { id: number;     techniker: string }
    | { techniker: string; logId: string; teil: string }
): Promise<void> {
  const techniker = data.techniker.toUpperCase().trim();

  const anfrage = "id" in data
    ? await prisma.anfrage.findFirst({
        where: {
          id:        data.id,
          techniker,
          status:    { in: [AnfrageStatus.NEU, AnfrageStatus.BEDARF] },
        },
        select: { id: true, status: true, artikelId: true },
      })
    : await prisma.anfrage.findFirst({
        where: {
          techniker,
          logId:  data.logId.trim(),
          teil:   data.teil.trim(),
          status: { in: [AnfrageStatus.NEU, AnfrageStatus.BEDARF] },
        },
        select: { id: true, status: true, artikelId: true },
      });

  if (!anfrage) throw new TRPCError({ code: "NOT_FOUND", message: "Keine stornierbare Anfrage gefunden (nur NEU oder BEDARF möglich)." });

  await prisma.anfrage.update({ where: { id: anfrage.id }, data: { status: AnfrageStatus.STORNIERT } });
  meilisearchSync.anfrage(anfrage.id);
  if (anfrage.artikelId) await syncBestandAusHistorie(anfrage.artikelId);

  // Realtime + Cache (F-BE4): Admin- + Techniker-UI live aktualisieren
  const payload = { id: anfrage.id, status: AnfrageStatus.STORNIERT };
  emitToAdmins(EVENTS.ANFRAGE_UPDATED, payload);
  emitToUser(techniker, EVENTS.ANFRAGE_UPDATED, payload);
  invalidateTechnikerCache(techniker).catch(() => {});
}

// ── Lock-System ───────────────────────────────────────────────────────────────

/**
 * Gruppe von Anfragen in Bearbeitung nehmen (atomic, Race-Condition-sicher).
 * Gibt Anzahl gesperrter Anfragen zurück.
 */
export async function gruppeInBearbeitungNehmen(
  anfrageIds: number[],
  kuerzel:    string,
): Promise<number> {
  const result = await prisma.anfrage.updateMany({
    where: {
      id:            { in: anfrageIds },
      status:        { in: [AnfrageStatus.NEU, AnfrageStatus.BEDARF] },
      bearbeitetVon: null,
    },
    data: {
      status:         AnfrageStatus.IN_BEARBEITUNG,
      bearbeitetVon:  kuerzel,
      bearbeitetSeit: new Date(),
    },
  });

  for (const id of anfrageIds) meilisearchSync.anfrage(id);

  if (result.count === 0) {
    // Diagnose: prüfen warum
    const locked = await prisma.anfrage.findFirst({
      where: { id: { in: anfrageIds }, bearbeitetVon: { not: null } },
      select: { bearbeitetVon: true },
    });
    if (locked?.bearbeitetVon) {
      throw new TRPCError({
        code:    "CONFLICT",
        message: `Wird bereits von ${locked.bearbeitetVon} bearbeitet.`,
      });
    }
    throw new TRPCError({ code: "BAD_REQUEST", message: "Keine Anfrage kann in Bearbeitung genommen werden." });
  }

  return result.count;
}

/**
 * Gruppe freigeben (Fail-Safe — jeder Admin darf).
 * Stellt den Status vor der Sperre wieder her (anhand aktuellem Bestand).
 */
export async function gruppeFreigeben(
  anfrageIds: number[],
  kuerzel:    string,
  grund?:     string,
): Promise<{ vorBearbeiter: string | null; freigegeben: number }> {
  const anfragen = await prisma.anfrage.findMany({
    where:   { id: { in: anfrageIds }, status: AnfrageStatus.IN_BEARBEITUNG },
    include: { artikel: { select: { bestand: true } } },
  });

  const vorBearbeiter = anfragen[0]?.bearbeitetVon ?? null;

  let freigegeben = 0;
  for (const a of anfragen) {
    const neuerStatus = a.artikelId && (a.artikel?.bestand ?? 0) === 0
      ? AnfrageStatus.BEDARF
      : AnfrageStatus.NEU;
    await prisma.anfrage.update({
      where: { id: a.id },
      data:  { status: neuerStatus, bearbeitetVon: null, bearbeitetSeit: null },
    });
    meilisearchSync.anfrage(a.id);
    freigegeben++;
  }

  // Freigabe-Grund serverseitig festhalten (erscheint im Server-Log)
  if (grund) process.stdout.write(`[Freigeben] ${kuerzel} gibt Anfragen [${anfrageIds.join(",")}] frei. War: ${vorBearbeiter ?? "—"}. Grund: ${grund}\n`);

  return { vorBearbeiter, freigegeben };
}

/**
 * Gruppe zurückgeben — nur durch den aktuellen Bearbeiter selbst.
 */
export async function gruppeZurueckgeben(
  anfrageIds: number[],
  kuerzel:    string,
): Promise<number> {
  const anfragen = await prisma.anfrage.findMany({
    where:   { id: { in: anfrageIds }, status: AnfrageStatus.IN_BEARBEITUNG, bearbeitetVon: kuerzel },
    include: { artikel: { select: { bestand: true } } },
  });

  if (anfragen.length === 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Du bearbeitest diese Anfragen nicht." });
  }

  for (const a of anfragen) {
    const neuerStatus = a.artikelId && (a.artikel?.bestand ?? 0) === 0
      ? AnfrageStatus.BEDARF
      : AnfrageStatus.NEU;
    await prisma.anfrage.update({
      where: { id: a.id },
      data:  { status: neuerStatus, bearbeitetVon: null, bearbeitetSeit: null },
    });
    meilisearchSync.anfrage(a.id);
  }

  return anfragen.length;
}

// ── Status ────────────────────────────────────────────────────────────────────

/**
 * Status einer Anfrage ändern (Admin).
 * Bei ABGESCHLOSSEN/STORNIERT: Lock wird automatisch gelöscht.
 */
// Gültige Status-Übergänge — verhindert Rückwärts-Transitionen via API
const GUELTIGE_TRANSITIONEN: Partial<Record<AnfrageStatus, AnfrageStatus[]>> = {
  [AnfrageStatus.NEU]:            [AnfrageStatus.IN_BEARBEITUNG, AnfrageStatus.BEDARF,  AnfrageStatus.ABGESCHLOSSEN, AnfrageStatus.STORNIERT],
  [AnfrageStatus.BEDARF]:         [AnfrageStatus.IN_BEARBEITUNG, AnfrageStatus.NEU,     AnfrageStatus.ABGESCHLOSSEN, AnfrageStatus.STORNIERT],
  [AnfrageStatus.IN_BEARBEITUNG]: [AnfrageStatus.ABGESCHLOSSEN,  AnfrageStatus.BEDARF,  AnfrageStatus.NEU,           AnfrageStatus.STORNIERT],
  [AnfrageStatus.ABGESCHLOSSEN]:  [], // terminal — keine Änderung mehr möglich
  [AnfrageStatus.STORNIERT]:      [], // terminal
};

export async function setzeStatus(id: number, status: AnfrageStatus): Promise<Anfrage> {
  const anfrage = await prisma.anfrage.findUnique({
    where:  { id },
    select: { id: true, artikelId: true, status: true },
  });
  if (!anfrage) throw new TRPCError({ code: "NOT_FOUND", message: "Anfrage nicht gefunden." });

  const erlaubt = GUELTIGE_TRANSITIONEN[anfrage.status];
  if (erlaubt !== undefined && !erlaubt.includes(status)) {
    throw new TRPCError({
      code:    "BAD_REQUEST",
      message: `Statuswechsel von ${anfrage.status} → ${status} ist nicht erlaubt.`,
    });
  }

  const istAbschluss = status === AnfrageStatus.ABGESCHLOSSEN || status === AnfrageStatus.STORNIERT;

  const aktualisiert = await prisma.anfrage.update({
    where: { id },
    data: {
      status,
      // Lock bei Abschluss/Storno immer löschen
      ...(istAbschluss ? { bearbeitetVon: null, bearbeitetSeit: null } : {}),
    },
    include: { artikel: { select: { id: true, bezeichnung: true } } },
  });

  meilisearchSync.anfrage(id);
  invalidateTechnikerCache(aktualisiert.techniker).catch(() => {});
  emitToAll(EVENTS.ANFRAGE_UPDATED, { id, status });
  emitToUser(aktualisiert.techniker, EVENTS.ANFRAGE_UPDATED, { id, status });

  if (status === AnfrageStatus.ABGESCHLOSSEN && anfrage.artikelId) {
    await syncBestandAusHistorie(anfrage.artikelId);
    sendeSystemNachricht({
      empfKuerzel: aktualisiert.techniker,
      betreff:     "✅ Teil bereit zur Abholung",
      inhalt:
        `Dein angefragtes Teil "${aktualisiert.teil}" für ${aktualisiert.geraeteName ?? aktualisiert.geraet} ` +
        `(LogID: ${aktualisiert.logId}) liegt zur Abholung bereit.` +
        (aktualisiert.grading ? `\nGrading: ${aktualisiert.grading}` : ""),
    }).catch(() => {});
  }

  if (status === AnfrageStatus.BEDARF && anfrage.status !== AnfrageStatus.BEDARF) {
    sendeSystemNachricht({
      empfKuerzel: aktualisiert.techniker,
      betreff:     "⚠️ Teil nicht verfügbar",
      inhalt:
        `Das angefragte Teil "${aktualisiert.teil}" für ` +
        `${aktualisiert.geraeteName ?? aktualisiert.geraet} ist leider nicht auf Lager. ` +
        `Wir informieren dich sobald es verfügbar ist.`,
    }).catch(() => {});
  }

  return aktualisiert;
}

/**
 * Anfrage abschließen (Legacy-Route).
 */
export async function schliesseAnfrageAb(id: number, mitarbeiter: string) {
  const anfrage = await prisma.anfrage.findUnique({
    where:   { id },
    include: { artikel: { select: { id: true, bezeichnung: true, lagerplatz: true, kategorie: true } } },
  });
  if (!anfrage) throw new TRPCError({ code: "NOT_FOUND", message: "Anfrage nicht gefunden." });
  if (anfrage.status === AnfrageStatus.ABGESCHLOSSEN) throw new TRPCError({ code: "BAD_REQUEST", message: "Anfrage bereits abgeschlossen." });

  if (anfrage.artikelId) {
    await bucheLager({ artikelId: anfrage.artikelId, menge: anfrage.menge, typ: BuchungsTyp.AUSGANG, mitarbeiter, notiz: `Anfrage #${id}` });
  }
  await prisma.anfrage.update({
    where: { id },
    data:  { status: AnfrageStatus.ABGESCHLOSSEN, bearbeitetVon: null, bearbeitetSeit: null },
  });
  meilisearchSync.anfrage(id);

  sendeSystemNachricht({
    empfKuerzel: anfrage.techniker,
    betreff:     "✅ Teil bereit zur Abholung",
    inhalt:
      `Dein angefragtes Teil "${anfrage.teil}" für ` +
      `${anfrage.geraeteName ?? anfrage.geraet} (LogID: ${anfrage.logId}) liegt zur Abholung bereit.` +
      (anfrage.grading ? `\nGrading: ${anfrage.grading}` : ""),
  }).catch(() => {});

  const aktuellerArtikel = anfrage.artikelId
    ? await prisma.artikel.findUnique({ where: { id: anfrage.artikelId }, select: { bestand: true } })
    : null;

  return {
    anfrageId: id, teilName: anfrage.teil, techniker: anfrage.techniker,
    logId: anfrage.logId, geraeteName: anfrage.geraeteName,
    grading: anfrage.grading, kommentar: anfrage.kommentar,
    restBestand: aktuellerArtikel?.bestand ?? 0, artikel: anfrage.artikel ?? null,
  };
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getAnfragenByTechniker(data: {
  techniker:    string;
  showAll:      boolean;
  limit?:       number;
  offset?:      number;
  standortIds?: number[];
}) {
  const limit  = data.limit  ?? 20;
  const offset = data.offset ?? 0;

  const where = {
    techniker: data.techniker.toUpperCase().trim(),
    ...(!data.showAll && {
      status: { notIn: [AnfrageStatus.ABGESCHLOSSEN, AnfrageStatus.STORNIERT] as AnfrageStatus[] },
    }),
    // Standort-Filter (Techniker = nur eigener Standort, Admin = ohne Filter).
    // Anfragen ohne Artikel (BEDARF/Sonderanfrage) bleiben sichtbar — sie sind
    // (noch) nicht standort-zugeordnet.
    ...(data.standortIds && data.standortIds.length > 0 && {
      OR: [
        { artikel: { standortId: { in: data.standortIds } } },
        { artikelId: null },
      ],
    }),
  };

  const [anfragen, total] = await Promise.all([
    prisma.anfrage.findMany({
      where,
      orderBy: { datum: "desc" },
      take:    limit,
      skip:    offset,
      include: { artikel: { select: { id: true, bezeichnung: true, kategorie: true } } },
    }),
    prisma.anfrage.count({ where }),
  ]);

  return { anfragen, total, hasMore: offset + limit < total };
}

export async function getAnfragenGruppiert(input?: {
  status?:     AnfrageStatus;
  techniker?:  string;
  von?:        Date;
  bis?:        Date;
  standortId?: number | null;
}): Promise<GruppenAnfrage[]> {
  const where = {
    ...(input?.standortId != null && { artikel: { standortId: input.standortId } }),
    ...(input?.status    && { status: input.status }),
    ...(input?.techniker && { techniker: input.techniker.toUpperCase().trim() }),
    ...(input?.von || input?.bis
      ? { datum: { ...(input?.von && { gte: input.von }), ...(input?.bis && { lte: input.bis }) } }
      : {}),
  };

  const anfragen = await prisma.anfrage.findMany({
    where,
    orderBy: { datum: "desc" },
    include: { artikel: { select: { id: true, bezeichnung: true, kategorie: true } } },
  });

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

    // Gruppen-Status: niedrigster Rang "gewinnt" (zeigt schlechtesten Stand)
    const rang: Record<AnfrageStatus, number> = {
      STORNIERT:       1,
      BEDARF:          2,
      IN_BEARBEITUNG:  3,
      NEU:             4,
      ABGESCHLOSSEN:   5,
    };
    if (rang[a.status] < rang[gruppe.gruppenStatus]) {
      gruppe.gruppenStatus = a.status;
    }
  }

  return Array.from(gruppenMap.values());
}

export async function getAnfragenAdmin(input: {
  status?:     AnfrageStatus;
  techniker?:  string;
  von?:        Date;
  bis?:        Date;
  limit:       number;
  offset:      number;
  standortId?: number | null;
}) {
  const where = {
    ...(input.standortId != null && { artikel: { standortId: input.standortId } }),
    ...(input.status    && { status: input.status }),
    ...(input.techniker && { techniker: input.techniker.toUpperCase().trim() }),
    ...(input.von || input.bis
      ? { datum: { ...(input.von && { gte: input.von }), ...(input.bis && { lte: input.bis }) } }
      : {}),
  };

  const [anfragen, total] = await Promise.all([
    prisma.anfrage.findMany({
      where,
      orderBy: { datum: "desc" },
      take:    input.limit,
      skip:    input.offset,
      include: { artikel: { select: { id: true, bezeichnung: true, kategorie: true, lagerplatz: true } } },
    }),
    prisma.anfrage.count({ where }),
  ]);

  return { anfragen, total, hasMore: input.offset + input.limit < total };
}

import { KorbStatus } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { prisma } from "@/core/db/prisma";
import { normalizeLogId } from "@/lib/format/logId";
import { erstelleAnfrage } from "@/modules/anfragen/service";

// ── Shared include ──────────────────────────────────────────────────────────

const ITEMS_INCLUDE = {
  items: {
    include: {
      artikel: {
        select: { id: true, bezeichnung: true, kategorie: true, bestand: true },
      },
    },
    orderBy: { id: "asc" as const },
  },
} as const;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Alle aktiven Warenkörbe eines Technikers (je einer pro logId).
 */
export async function getAktiv(techniker: string) {
  return prisma.warenkorb.findMany({
    where:   { techniker: techniker.toUpperCase().trim(), status: KorbStatus.AKTIV },
    include: ITEMS_INCLUDE,
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Item hinzufügen. Gibt den aktualisierten kompletten Warenkorb zurück.
 * artikelId kann null sein (ZUSTAND C: kein Artikel verknüpft).
 */
export async function addItem(data: {
  techniker:    string;
  logId:        string;
  geraeteName?: string;
  artikelId:    number | null;
  teiltyp?:     string;
  grading?:     string;
  zusatzinfo?:  string;
}) {
  const techniker = data.techniker.toUpperCase().trim();
  const logId     = normalizeLogId(data.logId);

  if (data.artikelId) {
    const artikel = await prisma.artikel.findUnique({
      where:  { id: data.artikelId },
      select: { id: true },
    });
    if (!artikel) {
      throw new TRPCError({ code: "NOT_FOUND", message: `Artikel ${data.artikelId} nicht gefunden.` });
    }
  }

  // Freitext-Sonderanfragen (kein fester Teiltyp) dürfen mehrfach vorkommen
  const SONDERFALL_TEILTYPEN = ["Sonstiges", "Spezielle Anfrage"];

  const korbId = await prisma.$transaction(async (tx) => {
    let korb = await tx.warenkorb.findFirst({
      where: { techniker, logId, status: KorbStatus.AKTIV },
    });

    if (!korb) {
      korb = await tx.warenkorb.create({
        data: { techniker, logId, geraeteName: data.geraeteName, status: KorbStatus.AKTIV },
      });
    }

    // Safety-Net: Teiltyp darf pro Gerät max 1× im aktiven Korb sein
    if (data.teiltyp && !SONDERFALL_TEILTYPEN.includes(data.teiltyp)) {
      const existing = await tx.warenkorbItem.findFirst({
        where: { korbId: korb.id, teiltyp: data.teiltyp },
      });
      if (existing) {
        throw new TRPCError({
          code:    "CONFLICT",
          message: `${data.teiltyp} ist bereits in der Anfrage`,
        });
      }
    }

    await tx.warenkorbItem.create({
      data: {
        korbId:     korb.id,
        artikelId:  data.artikelId,
        teiltyp:    data.teiltyp,
        grading:    data.grading ?? null,
        zusatzinfo: data.zusatzinfo,
      },
    });

    return korb.id;
  });

  // Kompletten Warenkorb zurückgeben
  return prisma.warenkorb.findUnique({
    where:   { id: korbId },
    include: ITEMS_INCLUDE,
  });
}

/**
 * Mehrere Items in einer Transaktion hinzufügen.
 *
 * Atomar: entweder alle Items werden geschrieben oder keiner. Verhindert den
 * Edge-Case dass bei Crash zwischen mehreren `addItem`-Calls ein halb-befüllter
 * Korb zurückbleibt, der bei der nächsten Anfrage zum selben Gerät mit-versendet
 * wird.
 *
 * Items werden pro logId in den jeweils aktiven Korb geschrieben. Doppel-Teiltyp-
 * Check pro Korb (gleiche Safety-Net-Regel wie `addItem`).
 */
export async function addItemsBulk(data: {
  techniker:   string;
  geraeteName?: string;
  items: Array<{
    logId:      string;
    artikelId:  number | null;
    teiltyp?:   string;
    grading?:   string;
    zusatzinfo?: string;
  }>;
}) {
  if (data.items.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Keine Items zum Hinzufügen." });
  }

  const techniker = data.techniker.toUpperCase().trim();
  const SONDERFALL_TEILTYPEN = ["Sonstiges", "Spezielle Anfrage"];

  // Artikel-IDs einmalig validieren (vor der Transaktion, kein Lock nötig)
  const artikelIds = Array.from(new Set(data.items.map(i => i.artikelId).filter((id): id is number => !!id)));
  if (artikelIds.length > 0) {
    const found = await prisma.artikel.findMany({
      where:  { id: { in: artikelIds } },
      select: { id: true },
    });
    if (found.length !== artikelIds.length) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Mindestens ein Artikel nicht gefunden." });
    }
  }

  const korbIds = await prisma.$transaction(async (tx) => {
    // Items nach logId gruppieren — pro logId ein Korb (normalisiert auf Punkt-Format)
    const byLogId = new Map<string, typeof data.items>();
    for (const item of data.items) {
      const key = normalizeLogId(item.logId);
      if (!byLogId.has(key)) byLogId.set(key, []);
      byLogId.get(key)!.push(item);
    }

    const erstellteKorbIds: number[] = [];

    for (const [logId, items] of byLogId) {
      let korb = await tx.warenkorb.findFirst({
        where: { techniker, logId, status: KorbStatus.AKTIV },
      });
      if (!korb) {
        korb = await tx.warenkorb.create({
          data: { techniker, logId, geraeteName: data.geraeteName, status: KorbStatus.AKTIV },
        });
      }

      // Doppel-Teiltyp-Check: bestehende + neue Items zusammen
      const bestehend = await tx.warenkorbItem.findMany({
        where:  { korbId: korb.id },
        select: { teiltyp: true },
      });
      const teiltypen = new Map<string, number>();
      for (const b of bestehend) {
        if (b.teiltyp && !SONDERFALL_TEILTYPEN.includes(b.teiltyp)) {
          teiltypen.set(b.teiltyp, (teiltypen.get(b.teiltyp) ?? 0) + 1);
        }
      }
      for (const i of items) {
        if (i.teiltyp && !SONDERFALL_TEILTYPEN.includes(i.teiltyp)) {
          const next = (teiltypen.get(i.teiltyp) ?? 0) + 1;
          if (next > 1) {
            throw new TRPCError({
              code:    "CONFLICT",
              message: `${i.teiltyp} ist bereits in der Anfrage`,
            });
          }
          teiltypen.set(i.teiltyp, next);
        }
      }

      await tx.warenkorbItem.createMany({
        data: items.map(i => ({
          korbId:     korb!.id,
          artikelId:  i.artikelId,
          teiltyp:    i.teiltyp,
          grading:    i.grading ?? null,
          zusatzinfo: i.zusatzinfo,
        })),
      });

      erstellteKorbIds.push(korb.id);
    }

    return erstellteKorbIds;
  });

  return { count: data.items.length, korbIds };
}

/**
 * Sonderanfrage-Item hinzufügen (kein Lagerartikel verknüpft).
 * Immer mit istSonderAnfrage = true und artikelId = null.
 */
export async function addSonderItem(data: {
  techniker:       string;
  logId:           string;
  geraeteName?:    string;
  beschreibung:    string;
  sonderKategorie: string;
  grading?:        string | null;
}) {
  const techniker = data.techniker.toUpperCase().trim();
  const logId     = normalizeLogId(data.logId);

  const korbId = await prisma.$transaction(async (tx) => {
    let korb = await tx.warenkorb.findFirst({
      where: { techniker, logId, status: KorbStatus.AKTIV },
    });
    if (!korb) {
      korb = await tx.warenkorb.create({
        data: { techniker, logId, geraeteName: data.geraeteName, status: KorbStatus.AKTIV },
      });
    }
    await tx.warenkorbItem.create({
      data: {
        korbId:          korb.id,
        artikelId:       null,
        teiltyp:         data.sonderKategorie,
        grading:         data.grading ?? null,
        zusatzinfo:      null,
        istSonderAnfrage: true,
        beschreibung:    data.beschreibung,
        sonderKategorie: data.sonderKategorie,
      },
    });
    return korb.id;
  });

  return prisma.warenkorb.findUnique({ where: { id: korbId }, include: ITEMS_INCLUDE });
}

/**
 * Item entfernen.
 */
export async function removeItem(itemId: number): Promise<void> {
  const item = await prisma.warenkorbItem.findUnique({ where: { id: itemId } });
  if (!item) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Warenkorb-Item nicht gefunden." });
  }
  await prisma.warenkorbItem.delete({ where: { id: itemId } });

  // Leeren Warenkorb automatisch löschen
  const remaining = await prisma.warenkorbItem.count({ where: { korbId: item.korbId } });
  if (remaining === 0) {
    await prisma.warenkorb.delete({ where: { id: item.korbId } });
  }
}

/**
 * Einen Warenkorb absenden → erstellt Anfragen, löscht danach Korb + Items.
 * Kein ABGESENDET-Status — Korb wird komplett gelöscht (kein Unique-Konflikt).
 */
export async function submit(data: {
  korbId:      number;
  zusatzinfo?: string;
  testModus?:  boolean;
}): Promise<{ anzahl: number; gruppenNr: string }> {
  const korb = await prisma.warenkorb.findUnique({
    where:   { id: data.korbId },
    include: { items: { include: { artikel: { select: { id: true, kategorie: true, bezeichnung: true } } } } },
  });

  if (!korb) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Warenkorb nicht gefunden." });
  }

  if (korb.status !== KorbStatus.AKTIV) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Warenkorb wurde bereits abgesendet." });
  }

  if (korb.items.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Warenkorb ist leer." });
  }

  // GruppenNr generieren — EIN fortlaufender Zähler je (Techniker, Tag).
  // Bewusst NICHT mehr durch korb.items.length teilen: das erzeugte für Körbe mit
  // unterschiedlicher Item-Anzahl denselben seq → identische gruppenNr für verschiedene
  // Geräte. Stattdessen die Anzahl der HEUTE bereits vergebenen DISTINCT gruppenNr
  // dieses Technikers + 1. Lesen + Kollisionsprüfung laufen in einer Transaktion,
  // damit der Zähler konsistent ermittelt wird.
  const datumStr   = new Date().toISOString().slice(0, 10);
  const heuteStart = new Date(datumStr);
  const heuteEnde  = new Date(heuteStart);
  heuteEnde.setDate(heuteEnde.getDate() + 1);

  const gruppenNr = await prisma.$transaction(async (tx) => {
    const heuteVergeben = await tx.anfrage.findMany({
      where:    { techniker: korb.techniker, gruppenNr: { not: null }, datum: { gte: heuteStart, lt: heuteEnde } },
      select:   { gruppenNr: true },
      distinct: ["gruppenNr"],
    });
    // Set der heute bereits vergebenen Nummern (für den Zähler UND das Sicherheitsnetz).
    const vergeben = new Set(heuteVergeben.map((a) => a.gruppenNr));

    // Fortlaufende Nummer = Anzahl bisheriger Gruppen + 1.
    let seq = vergeben.size + 1;
    let nr  = `${datumStr}-${korb.techniker}-${String(seq).padStart(3, "0")}`;
    // Sicherheitsnetz gegen Restraces/Lücken: solange die Nummer heute schon existiert,
    // hochzählen, bis sie frei ist (kein @@unique auf gruppenNr → defensiv prüfen).
    while (vergeben.has(nr)) {
      seq += 1;
      nr   = `${datumStr}-${korb.techniker}-${String(seq).padStart(3, "0")}`;
    }
    return nr;
  });

  await Promise.all(
    korb.items.map((item) =>
      erstelleAnfrage({
        techniker:        korb.techniker,
        logId:            korb.logId,
        geraeteName:      korb.geraeteName ?? undefined,
        geraet:           korb.geraeteName ?? (korb.logId !== "unbekannt" ? korb.logId : "Unbekannt"),
        artikelId:        item.artikelId,
        // Sonderanfragen: Teil = erste 50 Zeichen der Beschreibung
        teil:             item.istSonderAnfrage && item.beschreibung
          ? item.beschreibung.slice(0, 50)
          : (item.teiltyp ?? item.artikel?.kategorie ?? "Unbekannt"),
        grading:          item.grading ?? undefined,
        kommentar:        item.zusatzinfo ?? data.zusatzinfo,
        gruppenNr,
        korbId:           korb.id,
        istSonderAnfrage: item.istSonderAnfrage ?? false,
        beschreibung:     item.beschreibung ?? undefined,
        sonderKategorie:  item.sonderKategorie ?? undefined,
        testModus:        data.testModus ?? false,
      }),
    ),
  );

  // Korb + Items löschen (kein ABGESENDET → kein Unique-Konflikt bei Neuanlage)
  await prisma.warenkorbItem.deleteMany({ where: { korbId: korb.id } });
  await prisma.warenkorb.delete({ where: { id: korb.id } });

  return { anzahl: korb.items.length, gruppenNr };
}

/**
 * Alle aktiven Körbe eines Technikers auf einmal absenden.
 */
export async function submitAlle(data: {
  techniker:   string;
  zusatzinfo?: string;
  testModus?:  boolean;
}): Promise<{ anzahl: number; gruppenNrs: string[] }> {
  const techniker = data.techniker.toUpperCase().trim();
  const koerbe    = await prisma.warenkorb.findMany({
    where:   { techniker, status: KorbStatus.AKTIV },
    select:  { id: true, items: { select: { id: true } } },
  });

  const mitItems = koerbe.filter((k) => k.items.length > 0);
  if (mitItems.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Warenkorb ist leer." });
  }

  let totalAnzahl  = 0;
  const gruppenNrs: string[] = [];

  for (const korb of mitItems) {
    const result = await submit({ korbId: korb.id, zusatzinfo: data.zusatzinfo, testModus: data.testModus });
    totalAnzahl += result.anzahl;
    gruppenNrs.push(result.gruppenNr);
  }

  return { anzahl: totalAnzahl, gruppenNrs };
}

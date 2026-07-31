import { TRPCError } from "@trpc/server";
import { prisma } from "@/core/db/prisma";

/**
 * Alle Lagerplätze mit Artikel-Anzahl.
 * Zusammenführung aus:
 *   1. Distinct Artikel.lagerplatz Strings (reale Belegung)
 *   2. LagerplatzConfig Einträge (manuell angelegte, auch leere)
 */
export async function getAlleLagerplaetze(filter?: { bereich?: string }) {
  const [gruppen, configs] = await Promise.all([
    prisma.artikel.groupBy({
      by:      ["lagerplatz"],
      where:   { lagerplatz: { not: null } },
      _count:  { lagerplatz: true },
      orderBy: { lagerplatz: "asc" },
    }),
    prisma.lagerplatzConfig.findMany({ orderBy: { code: "asc" } }),
  ]);

  // Map: code → artikelAnzahl
  const anzahlMap = new Map<string, number>(
    gruppen.filter((g) => g.lagerplatz !== null).map((g) => [g.lagerplatz!, g._count.lagerplatz]),
  );

  // Alle bekannten Codes (aus DB + Config)
  const alleCodes = new Set<string>([
    ...anzahlMap.keys(),
    ...configs.map((c) => c.code),
  ]);

  const configMap = new Map(configs.map((c) => [c.code, c]));

  const result = Array.from(alleCodes)
    .sort()
    .map((code) => ({
      code,
      lagerplatz:    code,                               // Alias für Backward-Compat
      artikelAnzahl: anzahlMap.get(code) ?? 0,
      bereich:       configMap.get(code)?.bereich ?? erkenneBereiche(code),
      beschreibung:  configMap.get(code)?.beschreibung ?? null,
      ausConfig:     configMap.has(code),                // true = manuell angelegt
    }));

  if (filter?.bereich) {
    return result.filter((r) => r.bereich === filter.bereich);
  }

  return result;
}

/**
 * Neuen Lagerplatz manuell anlegen.
 * Speichert in LagerplatzConfig — unabhängig ob Artikel existieren.
 */
export async function createLagerplatz(input: {
  code:         string;
  beschreibung?: string;
  bereich?:     string;
}) {
  const code = input.code.toUpperCase().trim();

  if (!code) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Code darf nicht leer sein." });
  }

  // Duplikat-Check gegen Config UND Artikel
  const [inConfig, inArtikeln] = await Promise.all([
    prisma.lagerplatzConfig.findUnique({ where: { code } }),
    prisma.artikel.findFirst({ where: { lagerplatz: code }, select: { id: true } }),
  ]);

  if (inConfig || inArtikeln) {
    throw new TRPCError({
      code:    "CONFLICT",
      message: `Lagerplatz '${code}' existiert bereits.`,
    });
  }

  return prisma.lagerplatzConfig.create({
    data: {
      code,
      beschreibung: input.beschreibung?.trim() || null,
      bereich:      input.bereich?.trim() || erkenneBereiche(code),
    },
  });
}

/**
 * Lagerplatz bearbeiten — Beschreibung/Bereich und optional den Code selbst.
 *
 * Beim Umbenennen ziehen die Artikel MIT: `Artikel.lagerplatz` ist ein reiner
 * String ohne Fremdschlüssel — bliebe er stehen, zeigten die Artikel auf einen
 * Code, den es nicht mehr gibt, und würden aus jeder Lagerplatz-Ansicht fallen.
 * Deshalb beides in EINER Transaktion.
 *
 * Codes, die es nur über Artikel gibt (noch kein Config-Eintrag), bekommen beim
 * Bearbeiten einen angelegt — sonst ließe sich an ihnen nichts speichern.
 */
export async function updateLagerplatz(input: {
  code:          string;
  neuerCode?:    string;
  beschreibung?: string | null;
  bereich?:      string | null;
}) {
  const alt = input.code.toUpperCase().trim();
  const neu = input.neuerCode?.toUpperCase().trim() || alt;

  if (!alt) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Code darf nicht leer sein." });
  }

  if (neu !== alt) {
    // Zielcode darf noch nicht existieren — weder als Eintrag noch an Artikeln.
    const [inConfig, inArtikeln] = await Promise.all([
      prisma.lagerplatzConfig.findUnique({ where: { code: neu } }),
      prisma.artikel.findFirst({ where: { lagerplatz: neu }, select: { id: true } }),
    ]);
    if (inConfig || inArtikeln) {
      throw new TRPCError({
        code:    "CONFLICT",
        message: `Lagerplatz '${neu}' existiert bereits. Zum Zusammenlegen bitte „Alle verschieben" nutzen.`,
      });
    }
  }

  const daten = {
    code:         neu,
    beschreibung: input.beschreibung?.trim() || null,
    bereich:      input.bereich?.trim() || erkenneBereiche(neu),
  };

  const [, verschobene] = await prisma.$transaction([
    // upsert deckt beide Fälle ab: bestehenden Eintrag ändern (dabei ggf. den Code
    // umschreiben) ODER einen anlegen für Codes, die es bisher nur an Artikeln gab.
    prisma.lagerplatzConfig.upsert({
      where:  { code: alt },
      update: daten,
      create: daten,
    }),
    prisma.artikel.updateMany({ where: { lagerplatz: alt }, data: { lagerplatz: neu } }),
  ]);

  return { code: neu, umbenannt: neu !== alt, artikelVerschoben: verschobene.count };
}

/**
 * Lagerplatz löschen.
 *
 * Nur möglich, wenn KEINE Artikel mehr darauf stehen — sonst hätten die Artikel
 * einen Lagerplatz-String ohne Eintrag und wären faktisch unauffindbar.
 * Der Bestand selbst wird nie angetastet (historische Daten sind heilig).
 */
export async function loescheLagerplatz(code: string) {
  const c = code.toUpperCase().trim();

  const artikelAnzahl = await prisma.artikel.count({ where: { lagerplatz: c } });
  if (artikelAnzahl > 0) {
    throw new TRPCError({
      code:    "BAD_REQUEST",
      message: `Auf '${c}' stehen noch ${artikelAnzahl} Artikel. Bitte zuerst alle verschieben, dann löschen.`,
    });
  }

  const geloescht = await prisma.lagerplatzConfig.deleteMany({ where: { code: c } });
  if (geloescht.count === 0) {
    throw new TRPCError({
      code:    "NOT_FOUND",
      message: `Lagerplatz '${c}' ist kein manuell angelegter Eintrag — es gibt nichts zu löschen.`,
    });
  }

  return { code: c };
}

/**
 * Alle einzigartigen Bereiche (für Filter-Dropdown).
 */
export async function getBereiche(): Promise<string[]> {
  const alle = await getAlleLagerplaetze();
  return [...new Set(alle.map((l) => l.bereich))].sort();
}

/**
 * Lagerplatz-Details: alle Artikel mit diesem Lagerplatz-String.
 */
export async function getLagerplatzDetails(code: string) {
  const artikel = await prisma.artikel.findMany({
    where:   { lagerplatz: code },
    select:  { id: true, bezeichnung: true, kategorie: true, bestand: true },
    orderBy: { bezeichnung: "asc" },
  });

  return { code, bereich: erkenneBereiche(code), artikel };
}

/**
 * Einzelnen Artikel auf neuen Lagerplatz verschieben.
 * Erstellt DIREKT-Buchung als Audit-Trail (kein Bestandseinfluss).
 */
export async function verschiebeArtikel(input: {
  artikelId:     number;
  neuerLagerplatz: string;
  mitarbeiter:   string;
}) {
  const artikel = await prisma.artikel.findUnique({
    where:  { id: input.artikelId },
    select: { id: true, bezeichnung: true, lagerplatz: true },
  });

  if (!artikel) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Artikel nicht gefunden." });
  }

  const alterLagerplatz = artikel.lagerplatz ?? "–";
  const notiz = `Verschiebung von ${alterLagerplatz} nach ${input.neuerLagerplatz}`;

  await prisma.$transaction(async (tx) => {
    await tx.artikel.update({
      where: { id: artikel.id },
      data:  { lagerplatz: input.neuerLagerplatz },
    });

    // DIREKT-Buchung = 2 Einträge (Eingang + Ausgang), Netto 0 → kein Bestandseinfluss
    await tx.buchung.createMany({
      data: [
        { artikelId: artikel.id, bezeichnung: artikel.bezeichnung, typ: "EINGANG", menge: 1, mitarbeiter: input.mitarbeiter, notiz },
        { artikelId: artikel.id, bezeichnung: artikel.bezeichnung, typ: "AUSGANG", menge: 1, mitarbeiter: input.mitarbeiter, notiz },
      ],
    });
  });

  return { success: true, von: alterLagerplatz, nach: input.neuerLagerplatz };
}

/**
 * ALLE Artikel eines Lagerplatzes verschieben.
 */
export async function verschiebeAlle(input: {
  alterLagerplatz:  string;
  neuerLagerplatz:  string;
  mitarbeiter:      string;
}) {
  if (input.alterLagerplatz === input.neuerLagerplatz) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Quell- und Ziel-Lagerplatz sind identisch." });
  }

  const artikel = await prisma.artikel.findMany({
    where:  { lagerplatz: input.alterLagerplatz },
    select: { id: true, bezeichnung: true },
  });

  if (!artikel.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Lagerplatz '${input.alterLagerplatz}' ist leer.` });
  }

  const notiz = `Verschiebung von ${input.alterLagerplatz} nach ${input.neuerLagerplatz}`;

  await prisma.$transaction(async (tx) => {
    await tx.artikel.updateMany({
      where: { lagerplatz: input.alterLagerplatz },
      data:  { lagerplatz: input.neuerLagerplatz },
    });

    const buchungen = artikel.flatMap((a) => [
      { artikelId: a.id, bezeichnung: a.bezeichnung, typ: "EINGANG" as const, menge: 1, mitarbeiter: input.mitarbeiter, notiz },
      { artikelId: a.id, bezeichnung: a.bezeichnung, typ: "AUSGANG" as const, menge: 1, mitarbeiter: input.mitarbeiter, notiz },
    ]);
    await tx.buchung.createMany({ data: buchungen });
  });

  return { success: true, verschoben: artikel.length, von: input.alterLagerplatz, nach: input.neuerLagerplatz };
}

// Bereich aus Code-Präfix erkennen
function erkenneBereiche(code: string): string {
  const prefix = code.split("-")[0]?.toUpperCase() ?? "";
  const map: Record<string, string> = { HP: "HP", L: "Lenovo", D: "Dell", A: "Acer" };
  return map[prefix] ?? "Sonstiges";
}

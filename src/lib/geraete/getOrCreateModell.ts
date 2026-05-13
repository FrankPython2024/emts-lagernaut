import { prisma } from "@/core/db/prisma";
import { bereinigeBezeichnung } from "./bezeichnungBereinigen";
import { checkHersteller } from "./herstellerFilter";
import type { ErlaubterHersteller } from "./herstellerFilter";

export interface AehnlichesModell {
  id:               number;
  modell:           string;
  hersteller:       string;
  inaktiv:          boolean;
  deaktiviertGrund?: string | null;
}

export interface ModellLookupResult {
  modell:      { id: number; modell: string; hersteller: string } | null;
  istNeu:      boolean;
  istUnsicher: boolean;
  aehnliche:   AehnlichesModell[];
  fehler?:     string;
}

/**
 * Sucht ein GeraeteModell case-insensitiv (MySQL-Default), mit UND ohne Prefix.
 * Nur aktive Modelle werden als Treffer gewertet.
 * Hersteller MUSS in der Whitelist sein — bei Verstoß: fehler-Feld, kein Throw.
 * Legt nur an wenn allowCreate=true UND adminBestaetigt=true.
 *
 * Suchreihenfolge:
 *  1. Bereinigter Name exact (aktiv=true)
 *  2. Roh-Name exact (backward compat für DB-Einträge mit Prefix, aktiv=true)
 *  3. Hersteller-Prefix + bereinigter Name (aktiv=true)
 *  4. Ähnlichkeitscheck (erste 2 Wörter) → istUnsicher wenn Treffer ohne Bestätigung
 *     (inkl. inaktive mit deaktiviertGrund für Admin-Info)
 *  5. Neu anlegen wenn allowCreate + adminBestaetigt
 */
export async function getOrCreateModell(
  rohBezeichnung: string,
  rohHersteller:  string,
  options: { allowCreate?: boolean; adminBestaetigt?: boolean } = {},
): Promise<ModellLookupResult> {
  // Hersteller-Validierung (kein Throw — fehler-Feld für Caller)
  const check = checkHersteller(rohHersteller, rohBezeichnung);
  if (!check.erlaubt) {
    return { modell: null, istNeu: false, istUnsicher: false, aehnliche: [], fehler: check.grund };
  }
  const hersteller: ErlaubterHersteller = check.kanonisch!;

  const sauber = bereinigeBezeichnung(hersteller, rohBezeichnung);
  if (!sauber) {
    return { modell: null, istNeu: false, istUnsicher: false, aehnliche: [], fehler: "Bezeichnung leer nach Bereinigung" };
  }

  // 1) Bereinigter Name (nur aktive)
  const exaktClean = await prisma.geraeteModell.findFirst({
    where: { hersteller, modell: sauber, aktiv: true },
  });
  if (exaktClean) return { modell: exaktClean, istNeu: false, istUnsicher: false, aehnliche: [] };

  // 2) Roh-Name (backward compat, nur aktive)
  const rohTrimmed = rohBezeichnung.trim();
  if (rohTrimmed !== sauber) {
    const exaktRoh = await prisma.geraeteModell.findFirst({
      where: { hersteller, modell: rohTrimmed, aktiv: true },
    });
    if (exaktRoh) return { modell: exaktRoh, istNeu: false, istUnsicher: false, aehnliche: [] };
  }

  // 3) Hersteller + bereinigter Name (backward compat, nur aktive)
  const mitPrefix = `${hersteller} ${sauber}`;
  if (mitPrefix !== rohTrimmed) {
    const exaktMitPrefix = await prisma.geraeteModell.findFirst({
      where: { hersteller, modell: mitPrefix, aktiv: true },
    });
    if (exaktMitPrefix) return { modell: exaktMitPrefix, istNeu: false, istUnsicher: false, aehnliche: [] };
  }

  // 4) Ähnlichkeitscheck: erste 2 Wörter (aktive + inaktive für Admin-Info)
  const ersteWoerter = sauber.split(" ").slice(0, 2).join(" ");
  const aehnlicheRaw = ersteWoerter.length >= 3
    ? await prisma.geraeteModell.findMany({
        where: {
          hersteller,
          modell: { contains: ersteWoerter },
        },
        select: { id: true, modell: true, hersteller: true, aktiv: true, deaktiviertGrund: true },
        take:   8,
      })
    : [];

  const aehnliche: AehnlichesModell[] = aehnlicheRaw.map((m) => ({
    id:               m.id,
    modell:           m.modell,
    hersteller:       m.hersteller,
    inaktiv:          !m.aktiv,
    deaktiviertGrund: m.deaktiviertGrund,
  }));

  const aehnlicheAktiv = aehnliche.filter((m) => !m.inaktiv);

  if (aehnlicheAktiv.length > 0 && !options.adminBestaetigt) {
    return { modell: null, istNeu: false, istUnsicher: true, aehnliche };
  }

  // 5) Neu anlegen — nur mit allowCreate UND adminBestaetigt
  if (!options.allowCreate || !options.adminBestaetigt) {
    // "Würde neu sein" — kein Fehler, nur Signal für Caller
    return { modell: null, istNeu: true, istUnsicher: false, aehnliche };
  }

  const neu = await prisma.geraeteModell.create({
    data: { modell: sauber, hersteller, aktiv: true },
  });
  return { modell: neu, istNeu: true, istUnsicher: false, aehnliche };
}

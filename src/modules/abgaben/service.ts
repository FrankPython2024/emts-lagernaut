import { BuchungsTyp } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { prisma } from "@/core/db/prisma";
import { bucheLager } from "@/modules/buchungen/service";

// ── Material-Abgaben an andere Niederlassungen ───────────────────────────────
//
// Anlass: Festplatten und Arbeitsspeicher werden in Sömmerda erfasst, gehen aber
// regelmäßig an andere Niederlassungen der Gruppe. Das ist weder eine
// Techniker-Anfrage (die hängt an einer LogID und einem Gerät) noch eine interne
// Umlagerung (das Material verlässt das Haus). Deshalb ein eigener Vorgang.
//
// Technisch ist es eine ganz normale AUSGANG-Buchung — nur zusätzlich mit
// `niederlassungId` markiert. Dadurch bleibt die Bestandsführung unverändert
// (bedingtes Dekrement in der Transaktion, kein negativer Bestand), und die
// Abgaben lassen sich sauber getrennt auswerten.

/** Preis eines Artikels: Einzelpreis schlägt Kategoriepreis. */
export async function ermittlePreis(artikelId: number): Promise<number | null> {
  const artikel = await prisma.artikel.findUnique({
    where:  { id: artikelId },
    select: { preis: true, kategorie: true },
  });
  if (!artikel) return null;
  if (artikel.preis != null) return Number(artikel.preis);

  const kat = await prisma.kategoriePreis.findUnique({
    where:  { kategorie: artikel.kategorie },
    select: { preis: true },
  });
  return kat ? Number(kat.preis) : null;
}

export async function abgeben(data: {
  artikelId:       number;
  menge:           number;
  niederlassungId: number;
  mitarbeiter:     string;
  notiz?:          string;
}) {
  const [artikel, niederlassung] = await Promise.all([
    prisma.artikel.findUnique({
      where:  { id: data.artikelId },
      select: { id: true, bezeichnung: true, bestand: true },
    }),
    prisma.niederlassung.findUnique({
      where:  { id: data.niederlassungId },
      select: { id: true, name: true, aktiv: true },
    }),
  ]);

  if (!artikel)       throw new TRPCError({ code: "NOT_FOUND", message: "Artikel nicht gefunden." });
  if (!niederlassung) throw new TRPCError({ code: "NOT_FOUND", message: "Niederlassung nicht gefunden." });
  if (!niederlassung.aktiv) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `„${niederlassung.name}" ist nicht mehr aktiv.` });
  }
  // Frühe, verständliche Meldung. Die verbindliche Prüfung passiert trotzdem
  // in bucheLager innerhalb der Transaktion — zwischen hier und dort kann sich
  // der Bestand ändern.
  if (artikel.bestand < data.menge) {
    throw new TRPCError({
      code:    "CONFLICT",
      message: `Nicht genug Bestand für „${artikel.bezeichnung}": vorhanden ${artikel.bestand}, benötigt ${data.menge}.`,
    });
  }

  const buchung = await bucheLager({
    artikelId:   data.artikelId,
    menge:       data.menge,
    typ:         BuchungsTyp.AUSGANG,
    mitarbeiter: data.mitarbeiter,
    notiz:       [`Abgabe an ${niederlassung.name}`, data.notiz].filter(Boolean).join(" | "),
  });

  // Ziel nachtragen — `bucheLager` kennt bewusst keine Niederlassungen, damit die
  // Buchungs-Kernlogik frei von Sonderfällen bleibt.
  await prisma.buchung.update({
    where: { id: buchung.id },
    data:  { niederlassungId: niederlassung.id },
  });

  const neuerBestand = await prisma.artikel.findUnique({
    where: { id: data.artikelId }, select: { bestand: true },
  });

  return {
    buchungId:    buchung.id,
    artikel:      artikel.bezeichnung,
    menge:        data.menge,
    niederlassung: niederlassung.name,
    neuerBestand: neuerBestand?.bestand ?? 0,
  };
}

/**
 * Auswertung: Was ging in welche Niederlassung — Menge und Wert.
 * Wert = Menge × (Einzelpreis des Artikels ?? Kategoriepreis). Artikel ohne
 * jeden Preis werden separat ausgewiesen, damit die Summe nicht still zu klein wird.
 */
export async function auswertung(opts?: { tage?: number | null }) {
  const cutoff = opts?.tage ? new Date(Date.now() - opts.tage * 86_400_000) : null;

  const buchungen = await prisma.buchung.findMany({
    where: {
      niederlassungId: { not: null },
      typ:             BuchungsTyp.AUSGANG,
      ...(cutoff ? { datum: { gte: cutoff } } : {}),
    },
    select: {
      menge: true, datum: true,
      niederlassung: { select: { id: true, name: true } },
      artikel:       { select: { id: true, bezeichnung: true, kategorie: true, preis: true } },
    },
    orderBy: { datum: "desc" },
  });

  // Kategoriepreise einmal laden statt je Zeile nachzufragen
  const kategorien = Array.from(new Set(buchungen.map((b) => b.artikel.kategorie)));
  const katPreise = new Map(
    (await prisma.kategoriePreis.findMany({
      where: { kategorie: { in: kategorien } }, select: { kategorie: true, preis: true },
    })).map((k) => [k.kategorie, Number(k.preis)]),
  );

  type Zeile = { id: number; name: string; menge: number; wert: number; ohnePreis: number };
  const proNiederlassung = new Map<number, Zeile>();
  let gesamtWert = 0, gesamtMenge = 0, ohnePreisGesamt = 0;

  for (const b of buchungen) {
    if (!b.niederlassung) continue;
    const stueckpreis = b.artikel.preis != null
      ? Number(b.artikel.preis)
      : katPreise.get(b.artikel.kategorie) ?? null;

    const zeile = proNiederlassung.get(b.niederlassung.id)
      ?? { id: b.niederlassung.id, name: b.niederlassung.name, menge: 0, wert: 0, ohnePreis: 0 };

    zeile.menge  += b.menge;
    gesamtMenge  += b.menge;
    if (stueckpreis == null) {
      zeile.ohnePreis += b.menge;
      ohnePreisGesamt += b.menge;
    } else {
      const w = Math.round(b.menge * stueckpreis * 100) / 100;
      zeile.wert += w;
      gesamtWert += w;
    }
    proNiederlassung.set(b.niederlassung.id, zeile);
  }

  return {
    gesamtWert:  Math.round(gesamtWert * 100) / 100,
    gesamtMenge,
    ohnePreis:   ohnePreisGesamt,
    proNiederlassung: Array.from(proNiederlassung.values())
      .map((z) => ({ ...z, wert: Math.round(z.wert * 100) / 100 }))
      .sort((a, b) => b.wert - a.wert),
  };
}

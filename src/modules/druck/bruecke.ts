// ── Druckbrücke ↔ Lagernaut-Server (3D-Druck Paket 3, Stufe 3) ───────────────
//
// Die Brücke am Laptop beim Drucker meldet sich alle 5 s (NUR ausgehend, wie
// ein Browser) und holt dabei höchstens einen wartenden Druckauftrag ab. So
// kann ein Admin an jedem PC drucken, ohne dass im Firmennetz etwas geöffnet
// wird (Laptop hängt im „öffentlichen" Gast-WLAN, Firewall blockt eingehend).
// Anmeldung per Schlüssel: In der DB steht nur sein SHA-256; der Schlüssel
// selbst steht nur in der Einstellungsdatei am Laptop.

import crypto from "crypto";
import type { NextApiRequest } from "next";
import { prisma } from "@/core/db/prisma";
import { darfStarten, haengt, platteNachBericht } from "@/lib/druck/warteschlange";

export const STAND_ID = 1;

export function hashSchluessel(schluessel: string): string {
  return crypto.createHash("sha256").update(schluessel, "utf8").digest("hex");
}

export function neuerSchluessel(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/** Bearer-Schlüssel der Brücke prüfen (zeitkonstant). */
export async function brueckeAngemeldet(req: NextApiRequest): Promise<boolean> {
  const kopf = String(req.headers.authorization ?? "");
  const m = /^Bearer\s+(\S+)$/.exec(kopf);
  if (!m) return false;
  const stand = await prisma.druckerStand.findUnique({ where: { id: STAND_ID }, select: { schluesselHash: true } });
  if (!stand?.schluesselHash) return false;
  const a = Buffer.from(hashSchluessel(m[1]!), "hex");
  const b = Buffer.from(stand.schluesselHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

type Meldung = {
  version?: unknown;
  verbindung?: unknown;
  fehler?: unknown;
  drucker?: unknown;
};

const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);

/**
 * Stand speichern, hängende Aufträge aufräumen und — wenn alles passt — den
 * ältesten wartenden Auftrag abgeben. Die Abgabe belegt die Platte sofort, damit
 * nie zwei Aufträge nacheinander auf dieselbe Platte gehen.
 */
export async function meldenUndAbholen(m: Meldung) {
  const jetzt = new Date();
  const drucker = m.drucker && typeof m.drucker === "object" ? (m.drucker as Record<string, unknown>) : null;
  const zustand = typeof drucker?.zustand === "string" ? drucker.zustand : null;
  const verbindung = text(m.verbindung, 20);

  const alt = await prisma.druckerStand.findUnique({ where: { id: STAND_ID } });
  const platteFrei = platteNachBericht(alt?.platteFrei ?? false, zustand);
  await prisma.druckerStand.update({
    where: { id: STAND_ID },
    data: {
      gemeldetAm: jetzt,
      version:    text(m.version, 20),
      verbindung,
      fehler:     text(m.fehler, 500),
      drucker:    drucker ? (drucker as object) : undefined,
      // Nur „belegt" schreiben, nie „frei": Sonst überschriebe diese Meldung einen
      // Knopfdruck „Platte ist leer", der zwischen Lesen und Schreiben kam.
      ...(platteFrei ? {} : { platteFrei: false }),
    },
  });

  // Abgeholt, aber nie ein Ergebnis gemeldet (Brücke abgestürzt, Laptop zu).
  const offen = await prisma.druckAuftrag.findMany({ where: { status: "ABGEHOLT" }, select: { id: true, abgeholtAm: true } });
  for (const a of offen) {
    if (haengt(a.abgeholtAm, jetzt)) {
      await prisma.druckAuftrag.updateMany({
        where: { id: a.id, status: "ABGEHOLT" },
        data:  { status: "FEHLER", meldung: "Die Druckbrücke hat kein Ergebnis gemeldet — bitte am Drucker nachsehen.", beendetAm: jetzt },
      });
    }
  }
  if (offen.some((a) => !haengt(a.abgeholtAm, jetzt))) return { auftrag: null };

  const ok = darfStarten({ gemeldetAm: jetzt, verbindung, zustand, platteFrei, jetzt });
  if (!ok.ok) return { auftrag: null };

  const naechster = await prisma.druckAuftrag.findFirst({ where: { status: "WARTET" }, orderBy: { createdAt: "asc" } });
  if (!naechster) return { auftrag: null };
  const genommen = await prisma.druckAuftrag.updateMany({
    where: { id: naechster.id, status: "WARTET" },
    data:  { status: "ABGEHOLT", abgeholtAm: jetzt },
  });
  if (genommen.count !== 1) return { auftrag: null };
  await prisma.druckerStand.update({ where: { id: STAND_ID }, data: { platteFrei: false } });
  return { auftrag: { id: naechster.id, titel: naechster.titel, vorlageId: naechster.vorlageId } };
}

/** Ergebnis eines abgeholten Auftrags. Bei Fehler war die Platte nie im Einsatz → wieder frei. */
export async function ergebnisMelden(e: { auftragId: number; ok: boolean; bestaetigt?: boolean; meldung?: string | null }) {
  const jetzt = new Date();
  const a = await prisma.druckAuftrag.findUnique({ where: { id: e.auftragId } });
  if (!a || a.status !== "ABGEHOLT") return false;
  if (e.ok) {
    await prisma.druckAuftrag.update({
      where: { id: a.id },
      data:  {
        status: "GESTARTET", gestartetAm: jetzt,
        meldung: e.bestaetigt === false ? "Gesendet — der Drucker hat den Start nicht ausdrücklich bestätigt." : null,
      },
    });
  } else {
    await prisma.$transaction([
      prisma.druckAuftrag.update({
        where: { id: a.id },
        data:  { status: "FEHLER", beendetAm: jetzt, meldung: (e.meldung ?? "Unbekannter Fehler").slice(0, 500) },
      }),
      prisma.druckerStand.update({ where: { id: STAND_ID }, data: { platteFrei: true } }),
    ]);
  }
  return true;
}

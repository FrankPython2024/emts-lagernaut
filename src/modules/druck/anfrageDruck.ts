// ── Welche offenen Anfragen sind gerade im 3D-Druck? (Admin-Anfragenliste) ────
// Text-Regel: src/lib/druck/anfrageDruck.ts. Eine Sammelabfrage für die ganze
// Liste (sie lädt alle 5 s neu) — ohne laufende Druckaufträge sofort leer.

import { prisma } from "@/core/db/prisma";
import { anfrageSchluesselFuer } from "@/modules/teilespender/service";
import { teiltypenAus } from "@/lib/druck/druckliste";
import { AUTO_DECKT_MS, autoStartGrund } from "@/lib/druck/autoDruck";
import { BRUECKE_STILL_MS, darfStarten, istDerAuftrag } from "@/lib/druck/warteschlange";
import { druckHinweis, type DruckHinweis } from "@/lib/druck/anfrageDruck";
import { STAND_ID } from "@/modules/druck/bruecke";

export async function druckFuerAnfragen(anfrageIds: number[]): Promise<Record<number, DruckHinweis>> {
  const jetzt = new Date();
  const auftraege = await prisma.druckAuftrag.findMany({
    where: {
      OR: [
        { status: { in: ["WARTET", "ABGEHOLT"] } },
        { status: "GESTARTET", erledigtAm: null, gestartetAm: { gte: new Date(jetzt.getTime() - AUTO_DECKT_MS) } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, status: true, titel: true, dateiname: true, automatisch: true, anfrageId: true,
      vorlage: { select: { teiltypen: true, material: true, modelle: { select: { modellKey: true } } } },
    },
  });
  if (auftraege.length === 0 || anfrageIds.length === 0) return {};

  const [anfragen, stand] = await Promise.all([
    prisma.anfrage.findMany({
      where:  { id: { in: anfrageIds } },
      select: { id: true, logId: true, geraeteName: true, geraet: true, teil: true },
    }),
    prisma.druckerStand.findUnique({ where: { id: STAND_ID } }),
  ]);
  const schluessel = await anfrageSchluesselFuer(anfragen);
  const drucker = (stand?.drucker ?? null) as null | {
    zustand?: string | null; datei?: string | null; fortschritt?: number | null; restMinuten?: number | null;
    spule?: { typ?: string | null } | null;
  };
  const online = !!stand?.gemeldetAm && jetzt.getTime() - stand.gemeldetAm.getTime() <= BRUECKE_STILL_MS;
  const start = darfStarten({
    gemeldetAm: stand?.gemeldetAm ?? null, verbindung: stand?.verbindung ?? null,
    zustand: drucker?.zustand ?? null, platteFrei: stand?.platteFrei ?? false, jetzt,
  });

  const raus: Record<number, DruckHinweis> = {};
  for (const a of anfragen) {
    const key = schluessel.get(a.id);
    if (!key) continue;
    const passend = auftraege.filter((x) =>
      x.vorlage && teiltypenAus(x.vorlage.teiltypen).includes(a.teil) && x.vorlage.modelle.some((m) => m.modellKey === key));
    if (passend.length === 0) continue;
    // Der von genau dieser Anfrage ausgelöste zuerst, sonst der älteste.
    const x = passend.find((p) => p.anfrageId === a.id) ?? passend[0]!;
    const wartegrund = x.status !== "WARTET" ? null
      : (x.automatisch ? autoStartGrund({ jetzt, vorlageMaterial: x.vorlage?.material, spule: drucker?.spule?.typ ?? null }) : null)
        ?? (start.ok ? null : start.grund);
    raus[a.id] = druckHinweis({
      auftragId: x.id, status: x.status,
      istAktuell: online && istDerAuftrag(x.titel, x.dateiname, drucker?.datei ?? null),
      zustand: drucker?.zustand ?? null, fortschritt: drucker?.fortschritt ?? null,
      restMinuten: drucker?.restMinuten ?? null, wartegrund, jetzt,
    });
  }
  return raus;
}

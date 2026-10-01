// ── Halbautomatischer Druck: Auftrag aus einer Anfrage ohne Bestand ───────────
// Regeln: src/lib/druck/autoDruck.ts. Aufgerufen nach `erstelleAnfrage`
// (src/modules/anfragen/service.ts) — darf die Anfrage NIE scheitern lassen.
//
// Anfrage BEDARF → Gerätetyp über die Roh-Bezeichnung (wie Druckliste/Teilespender)
// → aktive Vorlage mit diesem Modell + Teiltyp und einer Druckdatei → noch kein
// Auftrag für diese Vorlage offen → DruckAuftrag WARTET, `automatisch`.
// Ob und wann er startet, entscheidet die Warteschlange (src/modules/druck/bruecke.ts):
// Platte per Knopf frei, Drucker bereit, Mo–Fr 6–16 Uhr, Spule passt.

import { prisma } from "@/core/db/prisma";
import { anfrageSchluesselFuer } from "@/modules/teilespender/service";
import { teiltypenAus } from "@/lib/druck/druckliste";
import { brauchtNeuenAuftrag } from "@/lib/druck/autoDruck";

// Anfragen kommen beim Absenden gleichzeitig (Promise.all) — nacheinander prüfen,
// sonst legten zwei Füße-Anfragen derselben Vorlage zwei Aufträge an.
let kette: Promise<unknown> = Promise.resolve();

export function autoDruckFuerAnfrage(anfrageId: number): Promise<number | null> {
  const lauf = kette.then(() => pruefe(anfrageId)).catch((err) => {
    console.error("[autoDruck] Anfrage", anfrageId, (err as Error).message);
    return null;
  });
  kette = lauf;
  return lauf;
}

async function pruefe(anfrageId: number): Promise<number | null> {
  const a = await prisma.anfrage.findUnique({
    where:  { id: anfrageId },
    select: { id: true, logId: true, geraeteName: true, geraet: true, teil: true, status: true, testModus: true, istSonderAnfrage: true },
  });
  if (!a || a.status !== "BEDARF" || a.testModus || a.istSonderAnfrage) return null;

  const key = (await anfrageSchluesselFuer([a])).get(a.id);
  if (!key) return null;

  const vorlagen = await prisma.druckvorlage.findMany({
    where:   { aktiv: true, modelle: { some: { modellKey: key } } },
    orderBy: { updatedAt: "desc" },
    select:  {
      id: true, name: true, teiltypen: true,
      dateien: { where: { art: "DRUCK" }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, dateiname: true } },
    },
  });
  const v = vorlagen.find((x) => teiltypenAus(x.teiltypen).includes(a.teil) && x.dateien.length > 0);
  if (!v) return null;

  const offen = await prisma.druckAuftrag.findMany({
    where:  { vorlageId: v.id, status: { in: ["WARTET", "ABGEHOLT", "GESTARTET"] } },
    select: { status: true, erledigtAm: true, gestartetAm: true },
  });
  if (!brauchtNeuenAuftrag(offen, new Date())) return null;

  const datei = v.dateien[0]!;
  const auftrag = await prisma.druckAuftrag.create({
    data: {
      vorlageId: v.id, dateiId: datei.id, titel: v.name.slice(0, 100), dateiname: datei.dateiname,
      status: "WARTET", erstelltVon: "AUTO", automatisch: true, anfrageId: a.id,
    },
  });
  console.log(`[autoDruck] Anfrage #${a.id} (${a.teil}, ${a.geraeteName ?? a.geraet}) → Druckauftrag #${auftrag.id} „${v.name}"`);
  return auftrag.id;
}

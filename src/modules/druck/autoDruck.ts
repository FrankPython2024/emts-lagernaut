// ── Halbautomatischer Druck: Auftrag aus einer Anfrage ohne Bestand ───────────
// Regeln: src/lib/druck/autoDruck.ts. Aufgerufen nach `erstelleAnfrage`
// (src/modules/anfragen/service.ts) — darf die Anfrage NIE scheitern lassen.
//
// Anfrage BEDARF → Gerätetyp über die Roh-Bezeichnung (wie Druckliste/Teilespender)
// → aktive Vorlage mit diesem Modell + Teiltyp und einer Druckdatei → noch kein
// Auftrag für diese Vorlage offen → DruckAuftrag WARTET, `automatisch`.
// Ob und wann er startet, entscheidet die Warteschlange (src/modules/druck/bruecke.ts):
// Platte per Knopf frei, Drucker bereit, Spule passt (keine Zeitsperre mehr, 09.10.2026).

import { prisma } from "@/core/db/prisma";
import { anfrageSchluesselFuer, modellSchluessel } from "@/modules/teilespender/service";
import { teiltypenAus } from "@/lib/druck/druckliste";
import { brauchtNeuenAuftrag, nachdruckFehlt } from "@/lib/druck/autoDruck";

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

/**
 * Nach dem Einbuchen eines Drucks: Reicht der Bestand jetzt für alle offenen
 * Anfragen dieser Vorlage? Wenn nicht (und kein Auftrag offen) → nächster
 * automatischer Auftrag. Startet wie immer erst nach „Platte ist leer".
 */
export function nachdruckFuerVorlage(vorlageId: number): Promise<number | null> {
  const lauf = kette.then(() => pruefeNachdruck(vorlageId)).catch((err) => {
    console.error("[autoDruck] Nachdruck Vorlage", vorlageId, (err as Error).message);
    return null;
  });
  kette = lauf;
  return lauf;
}

async function pruefeNachdruck(vorlageId: number): Promise<number | null> {
  const v = await prisma.druckvorlage.findUnique({
    where:  { id: vorlageId },
    select: {
      id: true, name: true, aktiv: true, teiltypen: true, modelle: { select: { modellKey: true } },
      dateien: { where: { art: "DRUCK" }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, dateiname: true } },
    },
  });
  if (!v || !v.aktiv || v.dateien.length === 0 || v.modelle.length === 0) return null;
  const keys = new Set(v.modelle.map((m) => m.modellKey));
  const teiltypen = teiltypenAus(v.teiltypen);

  // Offene Anfragen dieser Modelle + Teiltypen (Gerätetyp über die Roh-Bezeichnung).
  const kandidaten = await prisma.anfrage.findMany({
    where:   { teil: { in: teiltypen }, testModus: false, istSonderAnfrage: false, status: { in: ["NEU", "BEDARF", "IN_BEARBEITUNG"] } },
    orderBy: { datum: "asc" },
    select:  { id: true, logId: true, geraeteName: true, geraet: true, teil: true, menge: true, status: true },
  });
  const schluessel = await anfrageSchluesselFuer(kandidaten);
  const offen = kandidaten.filter((a) => keys.has(schluessel.get(a.id) ?? ""));
  if (!offen.some((a) => a.status === "BEDARF")) return null;

  // Bestand: Artikel dieser Modelle + Teiltypen samt Pool-Partner, jeder einmal.
  const kompat = await prisma.kompatibilitaet.findMany({
    where:  { teiltyp: { in: teiltypen }, artikel: { kategorie: { in: teiltypen } } },
    select: { geraet: true, teiltyp: true, artikel: { select: { id: true, bestand: true, poolPartnerId: true } } },
  });
  const artikelJeTeil = new Map<string, Map<number, number>>();
  const partnerIds = new Set<number>();
  for (const k of kompat) {
    if (!keys.has(modellSchluessel(k.geraet))) continue;
    const m = artikelJeTeil.get(k.teiltyp) ?? new Map<number, number>();
    m.set(k.artikel.id, k.artikel.bestand);
    artikelJeTeil.set(k.teiltyp, m);
    if (k.artikel.poolPartnerId) partnerIds.add(k.artikel.poolPartnerId);
  }
  const partner = partnerIds.size === 0 ? [] : await prisma.artikel.findMany({
    where: { id: { in: [...partnerIds] } }, select: { id: true, bestand: true },
  });
  const partnerBestand = new Map(partner.map((p) => [p.id, p.bestand]));
  const poolVon = new Map(kompat.map((k) => [k.artikel.id, k.artikel.poolPartnerId]));

  const je = teiltypen.map((teiltyp) => {
    const ids = new Map(artikelJeTeil.get(teiltyp) ?? []);
    for (const id of [...ids.keys()]) {
      const p = poolVon.get(id);
      if (p && !ids.has(p) && partnerBestand.has(p)) ids.set(p, partnerBestand.get(p)!);
    }
    return {
      teiltyp,
      offenStueck: offen.filter((a) => a.teil === teiltyp).reduce((s, a) => s + Math.max(1, a.menge), 0),
      bestand: [...ids.values()].reduce((s, b) => s + Math.max(0, b), 0),
    };
  });
  const fehlt = nachdruckFehlt(je);
  if (fehlt.length === 0) return null;

  const auftraege = await prisma.druckAuftrag.findMany({
    where:  { vorlageId: v.id, status: { in: ["WARTET", "ABGEHOLT", "GESTARTET"] } },
    select: { status: true, erledigtAm: true, gestartetAm: true },
  });
  if (!brauchtNeuenAuftrag(auftraege, new Date())) return null;

  const ausloeser = offen.find((a) => a.status === "BEDARF" && fehlt.includes(a.teil)) ?? offen[0]!;
  const datei = v.dateien[0]!;
  const auftrag = await prisma.druckAuftrag.create({
    data: {
      vorlageId: v.id, dateiId: datei.id, titel: v.name.slice(0, 100), dateiname: datei.dateiname,
      status: "WARTET", erstelltVon: "AUTO", automatisch: true, anfrageId: ausloeser.id,
    },
  });
  console.log(`[autoDruck] Nachdruck „${v.name}": ${je.map((z) => `${z.teiltyp} offen ${z.offenStueck}/Bestand ${z.bestand}`).join(", ")} → Druckauftrag #${auftrag.id}`);
  return auftrag.id;
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

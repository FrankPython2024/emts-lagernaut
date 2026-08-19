import { prisma } from "@/core/db/prisma";

export async function getAktiveTeiltypen() {
  return prisma.teiltyp.findMany({
    where:   { aktiv: true },
    orderBy: { sortierung: "asc" },
  });
}

export async function getAlleTeiltypen() {
  return prisma.teiltyp.findMany({
    orderBy: [{ aktiv: "desc" }, { sortierung: "asc" }],
  });
}

export async function erstelleTeiltyp(data: {
  name:        string;
  icon?:       string;
  sortierung?: number;
}) {
  return prisma.teiltyp.create({
    data: {
      name:        data.name.trim(),
      icon:        data.icon?.trim() || null,
      sortierung:  data.sortierung ?? 999,
      istStandard: false,
      aktiv:       true,
    },
  });
}

export async function aktualisiereTeiltyp(id: number, data: {
  name?:       string;
  icon?:       string | null;
  sortierung?: number;
  aktiv?:      boolean;
}) {
  return prisma.teiltyp.update({
    where: { id },
    data: {
      ...(data.name       !== undefined && { name: data.name.trim() }),
      ...(data.icon       !== undefined && { icon: data.icon?.trim() || null }),
      ...(data.sortierung !== undefined && { sortierung: data.sortierung }),
      ...(data.aktiv      !== undefined && { aktiv: data.aktiv }),
    },
  });
}

// ── Modell-spezifische Teiltypen ────────────────────────────────────────────────

/**
 * Alle für ein Modell verfügbaren Teiltypen: Standards + modell-spezifische,
 * dedupliziert nach id, sortiert nach `sortierung`.
 *
 * Standards (istStandard=true, aktiv=true) gelten implizit für ALLE Modelle.
 * Zusätzlich werden in ModellTeiltyp verknüpfte Custom-Teiltypen geliefert.
 */
export async function getTeiltypenForModell(modellId: number) {
  const [standards, modellSpezifisch] = await Promise.all([
    prisma.teiltyp.findMany({
      where:   { aktiv: true, istStandard: true },
      orderBy: { sortierung: "asc" },
    }),
    prisma.modellTeiltyp.findMany({
      where:   { modellId, teiltyp: { aktiv: true } },
      include: { teiltyp: true },
    }),
  ]);

  const map = new Map<number, typeof standards[number]>();
  for (const t of standards) map.set(t.id, t);
  for (const m of modellSpezifisch) map.set(m.teiltyp.id, m.teiltyp);

  return Array.from(map.values()).sort((a, b) => a.sortierung - b.sortierung);
}

/**
 * IDs der modell-spezifisch verknüpften Custom-Teiltypen.
 * Standards werden NICHT geliefert — sie sind global, nicht modell-gebunden.
 */
export async function getModellTeiltypIds(modellId: number): Promise<number[]> {
  const verknuepfungen = await prisma.modellTeiltyp.findMany({
    where:  { modellId },
    select: { teiltypId: true },
  });
  return verknuepfungen.map(v => v.teiltypId);
}

/**
 * Verknüpfungen für ein Modell vollständig ersetzen.
 * Akzeptiert nur Custom-Teiltypen (istStandard=false) — Standards werden
 * ignoriert weil sie implizit global gelten.
 */
export async function setzeModellTeiltypen(modellId: number, teiltypIds: number[]) {
  return prisma.$transaction(async (tx) => {
    await tx.modellTeiltyp.deleteMany({ where: { modellId } });

    if (teiltypIds.length > 0) {
      const customs = await tx.teiltyp.findMany({
        where:  { id: { in: teiltypIds }, istStandard: false },
        select: { id: true },
      });
      if (customs.length > 0) {
        await tx.modellTeiltyp.createMany({
          data:           customs.map(t => ({ modellId, teiltypId: t.id })),
          skipDuplicates: true,
        });
      }
      return { gespeichert: customs.length };
    }
    return { gespeichert: 0 };
  });
}

// ── Massenzuordnung: ein Custom-Teiltyp für ALLE Gerätemodelle ────────────────
//
// Hintergrund: Ein Teiltyp wie „Thermalmodul" steckt in praktisch jedem Laptop.
// Ihn einzeln an ~200 Modellen anzuhaken ist nicht zumutbar. Diese Funktionen
// setzen bzw. entfernen die Verknüpfung für alle aktiven Modelle auf einmal.
//
// ⚠️ Das ist eine MOMENTAUFNAHME: Modelle, die später neu angelegt werden,
// bekommen den Teiltyp NICHT automatisch. Wer das braucht, hätte einen echten
// Standard-Teiltyp (istStandard=true) — der gilt implizit immer und für alle,
// auch für Geräte, die gar kein Modell in der Tabelle haben.
//
// Standards sind hier bewusst gesperrt: Für sie wären ModellTeiltyp-Zeilen
// wirkungslose Karteileichen, weil sie ohnehin global gelten.

async function ladeCustomTeiltyp(teiltypId: number) {
  const teiltyp = await prisma.teiltyp.findUnique({
    where:  { id: teiltypId },
    select: { id: true, name: true, istStandard: true, aktiv: true },
  });
  if (!teiltyp) throw new Error("Teiltyp nicht gefunden.");
  if (teiltyp.istStandard) {
    throw new Error(`„${teiltyp.name}" ist ein Standard-Teiltyp und gilt bereits für alle Modelle.`);
  }
  return teiltyp;
}

/**
 * Trockenlauf: wie viele aktive Modelle gibt es, wie viele haben den Teiltyp
 * schon? Damit steht vor dem Klick fest, was die Aktion bewirkt.
 */
export async function zuordnungsStand(teiltypId: number): Promise<{
  name:            string;
  aktiv:           boolean;
  modelleGesamt:   number;
  bereitsZugeordnet: number;
  fehlend:         number;
}> {
  const teiltyp = await ladeCustomTeiltyp(teiltypId);

  const [modelleGesamt, bereitsZugeordnet] = await Promise.all([
    prisma.geraeteModell.count({ where: { aktiv: true } }),
    prisma.modellTeiltyp.count({
      where: { teiltypId, modell: { aktiv: true } },
    }),
  ]);

  return {
    name:              teiltyp.name,
    aktiv:             teiltyp.aktiv,
    modelleGesamt,
    bereitsZugeordnet,
    fehlend:           modelleGesamt - bereitsZugeordnet,
  };
}

/**
 * Teiltyp allen AKTIVEN Modellen zuordnen. Idempotent (skipDuplicates), kann
 * also gefahrlos erneut laufen, wenn später Modelle dazugekommen sind.
 * Deaktivierte Modelle bleiben außen vor — sie tauchen im Techniker-Portal
 * ohnehin nicht auf.
 */
export async function ordneTeiltypAllenModellenZu(teiltypId: number): Promise<{
  name: string; zugeordnet: number; modelleGesamt: number;
}> {
  const teiltyp = await ladeCustomTeiltyp(teiltypId);

  const modelle = await prisma.geraeteModell.findMany({
    where:  { aktiv: true },
    select: { id: true },
  });

  if (modelle.length === 0) return { name: teiltyp.name, zugeordnet: 0, modelleGesamt: 0 };

  const r = await prisma.modellTeiltyp.createMany({
    data:           modelle.map((m) => ({ modellId: m.id, teiltypId })),
    skipDuplicates: true,
  });

  return { name: teiltyp.name, zugeordnet: r.count, modelleGesamt: modelle.length };
}

/**
 * Gegenstück: Verknüpfung von allen Modellen lösen. Trifft bewusst AUCH
 * deaktivierte Modelle — sonst blieben unsichtbare Reste zurück, die beim
 * Reaktivieren eines Modells wieder auftauchen.
 */
export async function entferneTeiltypVonAllenModellen(teiltypId: number): Promise<{
  name: string; entfernt: number;
}> {
  const teiltyp = await ladeCustomTeiltyp(teiltypId);
  const r = await prisma.modellTeiltyp.deleteMany({ where: { teiltypId } });
  return { name: teiltyp.name, entfernt: r.count };
}

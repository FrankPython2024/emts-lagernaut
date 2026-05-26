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

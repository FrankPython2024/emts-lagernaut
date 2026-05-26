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

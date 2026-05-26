import { TRPCError } from "@trpc/server";
import { prisma } from "@/core/db/prisma";

export async function listRollen() {
  return prisma.rolle.findMany({
    orderBy: [{ istSystem: "desc" }, { name: "asc" }],
    include: {
      permissions: { include: { permission: true } },
      _count:      { select: { permissions: true } },
    },
  });
}

export async function getRolle(id: number) {
  return prisma.rolle.findUnique({
    where:   { id },
    include: { permissions: { include: { permission: true } } },
  });
}

export async function listPermissions() {
  return prisma.permission.findMany({
    orderBy: [{ kategorie: "asc" }, { bezeichnung: "asc" }],
  });
}

export async function erstelleRolle(data: {
  name:          string;
  bezeichnung:   string;
  beschreibung?: string;
}) {
  return prisma.rolle.create({
    data: {
      name:         data.name.trim().toUpperCase(),
      bezeichnung:  data.bezeichnung.trim(),
      beschreibung: data.beschreibung?.trim() || null,
      istSystem:    false,
      aktiv:        true,
    },
  });
}

export async function aktualisiereRolle(id: number, data: {
  bezeichnung?:  string;
  beschreibung?: string | null;
  aktiv?:        boolean;
}) {
  return prisma.rolle.update({
    where: { id },
    data: {
      ...(data.bezeichnung  !== undefined && { bezeichnung: data.bezeichnung.trim() }),
      ...(data.beschreibung !== undefined && { beschreibung: data.beschreibung?.trim() || null }),
      ...(data.aktiv        !== undefined && { aktiv: data.aktiv }),
    },
  });
}

export async function loescheRolle(id: number) {
  const rolle = await prisma.rolle.findUnique({ where: { id } });
  if (!rolle) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Rolle nicht gefunden." });
  }
  if (rolle.istSystem) {
    throw new TRPCError({
      code:    "BAD_REQUEST",
      message: "System-Rollen können nicht gelöscht werden.",
    });
  }
  await prisma.rolle.delete({ where: { id } });
  return { geloescht: rolle.name };
}

export async function setzeRollePermissions(rolleId: number, permissionIds: number[]) {
  return prisma.$transaction(async (tx) => {
    await tx.rollePermission.deleteMany({ where: { rolleId } });
    if (permissionIds.length > 0) {
      await tx.rollePermission.createMany({
        data:           permissionIds.map(pid => ({ rolleId, permissionId: pid })),
        skipDuplicates: true,
      });
    }
    return { gespeichert: permissionIds.length };
  });
}

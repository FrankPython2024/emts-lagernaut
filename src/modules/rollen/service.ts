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

/**
 * Effektive Rechte eines Users = Rollen-Rechte ∪ Zusatz-Rechte (distinct).
 * Wird live aus der DB aufgelöst (NICHT im Session-Token gecacht) → Änderungen
 * greifen ohne Re-Login. `userId` optional, damit Alt-Aufrufer (nur Rolle)
 * weiter funktionieren; ohne userId gibt es keine Zusatz-Rechte.
 *
 * Hinweis: Zusatz-Rechte verweisen per FK auf existierende Permissions; gelöschte
 * Rechte räumt der Cascade weg, daher entstehen hier keine ungültigen Codes.
 */
export async function getMeinePermissions(rolleName: string, userId?: number): Promise<string[]> {
  const [rolle, extra, deny] = await Promise.all([
    prisma.rolle.findUnique({
      where:   { name: rolleName },
      include: { permissions: { include: { permission: true } } },
    }),
    userId
      ? prisma.userPermission.findMany({ where: { userId }, include: { permission: true } })
      : Promise.resolve([] as { permission: { key: string } }[]),
    userId
      ? prisma.userPermissionDeny.findMany({ where: { userId }, select: { permission: true } })
      : Promise.resolve([] as { permission: string }[]),
  ]);

  // 1) Additive Vereinigung: Rollen-Rechte ∪ Zusatz-Rechte.
  const rollenKeys  = (rolle && rolle.aktiv) ? rolle.permissions.map(rp => rp.permission.key) : [];
  const extraKeys   = extra.map(up => up.permission.key);
  const vereinigung = new Set([...rollenKeys, ...extraKeys]);

  // 2) Entzug gewinnt: Deny-Keys abziehen. AUSNAHME: SYSTEM_ADMIN ist NIE entziehbar
  //    (Lockout-Sicherung) — ein versehentlich gesetztes Deny darauf wird ignoriert,
  //    damit ein Admin über die Wildcard immer handlungsfähig bleibt.
  for (const d of deny) {
    if (d.permission === "SYSTEM_ADMIN") continue;
    vereinigung.delete(d.permission);
  }

  return [...vereinigung];
}

export function hasPermission(permissions: string[], key: string): boolean {
  return permissions.includes("SYSTEM_ADMIN") || permissions.includes(key);
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

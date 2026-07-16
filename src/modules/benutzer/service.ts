import { type UserRolle } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/core/db/prisma";

const BCRYPT_ROUNDS = 12;

export type CreateUserData = {
  name:     string;
  kuerzel:  string;
  email:    string;
  password: string;
  rolle?:   UserRolle;
};

/**
 * Neuen Benutzer anlegen. Passwort wird mit bcrypt gehasht (rounds: 12).
 */
export async function createUser(data: CreateUserData) {
  const kuerzel = data.kuerzel.toUpperCase().trim();
  const email   = data.email.toLowerCase().trim();

  const bestehendes = await prisma.user.findFirst({
    where: { OR: [{ kuerzel }, { email }] },
    select: { kuerzel: true, email: true },
  });

  if (bestehendes) {
    const feld = bestehendes.kuerzel === kuerzel ? "Kürzel" : "E-Mail";
    throw new TRPCError({
      code:    "CONFLICT",
      message: `${feld} '${bestehendes.kuerzel === kuerzel ? kuerzel : email}' ist bereits vergeben.`,
    });
  }

  const hash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);

  return prisma.user.create({
    data: {
      name:     data.name.trim(),
      kuerzel,
      email,
      password: hash,
      rolle:    data.rolle ?? "TECHNIKER",
      aktiv:    true,
    },
    select: { id: true, name: true, kuerzel: true, email: true, rolle: true, aktiv: true, createdAt: true },
  });
}

/**
 * Login-Validierung — für NextAuth Credentials Provider.
 * Gibt null zurück wenn ungültig (kein Error-Leak nach außen).
 */
export async function validateUser(kuerzel: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { kuerzel: kuerzel.toUpperCase().trim() },
  });

  if (!user || !user.aktiv) return null;

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return null;

  await prisma.user.update({
    where: { id: user.id },
    data:  { lastLogin: new Date() },
  });

  return {
    id:      user.id,
    name:    user.name,
    kuerzel: user.kuerzel,
    email:   user.email,
    rolle:   user.rolle,
  };
}

/**
 * Alle Benutzer auflisten (Admin).
 */
export async function getAllUsers() {
  return prisma.user.findMany({
    select: {
      id: true, name: true, kuerzel: true, email: true,
      rolle: true, aktiv: true, lastLogin: true, createdAt: true,
    },
    orderBy: { name: "asc" },
  });
}

/**
 * Benutzer aktualisieren (Admin).
 */
export async function updateUser(
  id:   number,
  data: Partial<{ name: string; email: string; rolle: UserRolle }>,
) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Benutzer nicht gefunden." });
  }

  // Letzten aktiven ADMIN nicht degradieren — sonst sperrt sich das System selbst
  // aus (adminProcedure haengt an rolle==='ADMIN'; danach nur noch DB-Eingriff).
  if (data.rolle && data.rolle !== "ADMIN" && user.rolle === "ADMIN") {
    const adminsAktiv = await prisma.user.count({ where: { rolle: "ADMIN", aktiv: true } });
    if (adminsAktiv <= 1) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Der letzte aktive Admin kann nicht herabgestuft werden." });
    }
  }

  return prisma.user.update({
    where: { id },
    data: {
      ...(data.name  && { name:  data.name.trim() }),
      ...(data.email && { email: data.email.toLowerCase().trim() }),
      ...(data.rolle && { rolle: data.rolle }),
    },
    select: { id: true, name: true, kuerzel: true, email: true, rolle: true, aktiv: true },
  });
}

/**
 * Benutzer deaktivieren (kein Hard-Delete — Buchungshistorie bleibt erhalten).
 * Legacy-Wrapper; nutzt aktiviereDeaktiviere(id, false).
 */
export async function deactivateUser(id: number): Promise<void> {
  await aktiviereDeaktiviere(id, false);
}

/**
 * Bidirektionaler Soft-Toggle: aktiv = true ⇒ reaktivieren, false ⇒ deaktivieren.
 */
export async function aktiviereDeaktiviere(id: number, aktiv: boolean): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!user) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Benutzer nicht gefunden." });
  }
  await prisma.user.update({ where: { id }, data: { aktiv } });
}

/**
 * User unwiderruflich löschen — nur wenn keine Anfragen/Buchungen verknüpft sind.
 * CASCADE räumt UserStandortAccess automatisch weg.
 * Historische Daten sind heilig: bei verknüpften Datensätzen wird BAD_REQUEST geworfen.
 */
export async function loescheUser(id: number): Promise<{ geloescht: string }> {
  const user = await prisma.user.findUnique({
    where:  { id },
    select: { kuerzel: true, name: true },
  });
  if (!user) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Benutzer nicht gefunden." });
  }

  const [anfragenCount, buchungenCount] = await Promise.all([
    prisma.anfrage.count({ where: { techniker:   user.kuerzel } }),
    prisma.buchung.count({ where: { mitarbeiter: user.kuerzel } }),
  ]);

  if (anfragenCount > 0 || buchungenCount > 0) {
    throw new TRPCError({
      code:    "BAD_REQUEST",
      message: `User hat ${anfragenCount} Anfragen / ${buchungenCount} Buchungen — bitte deaktivieren statt löschen.`,
    });
  }

  await prisma.user.delete({ where: { id } });
  return { geloescht: user.name };
}

/**
 * Passwort zurücksetzen (Admin) — setzt auf übergebenes Passwort.
 */
export async function resetPassword(id: number, newPassword: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Benutzer nicht gefunden." });
  }
  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await prisma.user.update({ where: { id }, data: { password: hash } });
}

const DEFAULT_PW = "techniker123";

/**
 * Passwort auf Standard zurücksetzen (Admin-Aktion).
 * Gibt kuerzel des betroffenen Users zurück.
 */
export async function resetPasswordToDefault(id: number): Promise<{ kuerzel: string; rolle: string }> {
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, rolle: true, kuerzel: true } });
  if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Benutzer nicht gefunden." });
  // Rolle ZUERST pruefen — sonst wird das Admin-Passwort auf den oeffentlich
  // bekannten Default gesetzt, bevor die Sperre greift (Sicherheitsluecke).
  if (user.rolle === "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin-Passwörter können nicht auf den Standard zurückgesetzt werden." });
  }
  const hash = await bcrypt.hash(DEFAULT_PW, BCRYPT_ROUNDS);
  await prisma.user.update({ where: { id }, data: { password: hash } });
  return { kuerzel: user.kuerzel, rolle: user.rolle };
}

/**
 * Eigenes Passwort ändern (Self-Service).
 * Prüft zuerst das aktuelle Passwort via bcrypt.compare.
 */
export async function changePassword(
  userId:            number,
  aktuellesPasswort: string,
  neuesPasswort:     string,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Benutzer nicht gefunden." });

  const valid = await bcrypt.compare(aktuellesPasswort, user.password);
  if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "Aktuelles Passwort ist falsch." });

  if (neuesPasswort === DEFAULT_PW) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Bitte ein anderes Passwort wählen." });
  }

  const hash = await bcrypt.hash(neuesPasswort, BCRYPT_ROUNDS);
  await prisma.user.update({ where: { id: userId }, data: { password: hash } });
}

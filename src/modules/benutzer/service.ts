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
 */
export async function deactivateUser(id: number): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Benutzer nicht gefunden." });
  }
  await prisma.user.update({ where: { id }, data: { aktiv: false } });
}

/**
 * Passwort zurücksetzen (Admin).
 */
export async function resetPassword(id: number, newPassword: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Benutzer nicht gefunden." });
  }
  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await prisma.user.update({ where: { id }, data: { password: hash } });
}

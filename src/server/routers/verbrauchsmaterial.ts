import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";
import type { Prisma } from "@prisma/client";

// Verbrauchsmaterial / Kartonage. Lesen: MATERIAL_VIEW, Schreiben:
// MATERIAL_MANAGE. SYSTEM_ADMIN-Wildcard deckt beides ab. Eigene
// Materialwirtschaft — KEIN Effekt auf das Geräte-/Teile-Lager.
const view   = permissionProcedure("MATERIAL_VIEW");
const manage = permissionProcedure("MATERIAL_MANAGE");

// Stabiler Etiketten-/QR-Code aus der id: "VM-" + 4-stellig (mind. 4 Stellen,
// wächst bei Bedarf). Eindeutig, weil id eindeutig ist.
function vmCode(id: number): string {
  return `VM-${String(id).padStart(4, "0")}`;
}

// Freitext defensiv aufs Spaltenlimit kappen (Lehre aus PickupPosition.bezeichnung:
// eine zu lange Zelle darf NIE den Insert sprengen). Trimmt + null bei leer.
function cap(v: string | null | undefined, max: number): string | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

// Spaltenlimits (prisma/schema.prisma → VerbrauchsArtikel).
const LIM = { name: 255, merkmale: 255, kategorie: 100, aan: 100, standort: 191, bemerkung: 10_000 } as const;

// Gemeinsame Feld-Bereinigung für Anlegen/Bearbeiten/Import.
type RoheFelder = {
  name:             string;
  merkmale?:        string | null;
  kategorie?:       string | null;
  mindestbestand?:  number;
  aktuellerBestand?: number;
  aan?:             string | null;
  gebindegroesse?:  number | null;
  standort?:        string | null;
  bemerkung?:       string | null;
};
function bereinige(f: RoheFelder) {
  return {
    name:             cap(f.name, LIM.name) ?? "",
    merkmale:         cap(f.merkmale, LIM.merkmale),
    kategorie:        cap(f.kategorie, LIM.kategorie),
    mindestbestand:   Math.max(0, Math.trunc(f.mindestbestand ?? 0)),
    aktuellerBestand: Math.max(0, Math.trunc(f.aktuellerBestand ?? 0)),
    aan:              cap(f.aan, LIM.aan),
    gebindegroesse:   f.gebindegroesse != null && f.gebindegroesse > 0 ? Math.trunc(f.gebindegroesse) : null,
    standort:         cap(f.standort, LIM.standort),
    bemerkung:        cap(f.bemerkung, LIM.bemerkung),
  };
}

// Artikel anlegen + Code aus der frischen id ableiten (2-Schritt, transaktional).
async function createMitCode(
  tx: Prisma.TransactionClient,
  data: ReturnType<typeof bereinige>,
) {
  const created = await tx.verbrauchsArtikel.create({
    // temporär eindeutiger Platzhalter, sofort durch vmCode(id) ersetzt
    data: { ...data, code: `TMP-${crypto.randomUUID()}` },
  });
  return tx.verbrauchsArtikel.update({
    where: { id: created.id },
    data:  { code: vmCode(created.id) },
  });
}

// Status aus Beständen ableiten (Mindestbestand-Warnung).
function status(aktuellerBestand: number, mindestbestand: number): "OK" | "NACHBESTELLEN" {
  return aktuellerBestand >= mindestbestand ? "OK" : "NACHBESTELLEN";
}

const positionInput = z.object({
  name:             z.string().trim().min(1),
  merkmale:         z.string().nullish(),
  kategorie:        z.string().nullish(),
  mindestbestand:   z.number().int().min(0).default(0),
  aktuellerBestand: z.number().int().min(0).default(0),
  aan:              z.string().nullish(),
  gebindegroesse:   z.number().int().positive().nullish(),
  standort:         z.string().nullish(),
  bemerkung:        z.string().nullish(),
});

export const verbrauchsmaterialRouter = createTRPCRouter({

  // Liste mit Filter (Suchtext / Kategorie / Standort) + abgeleitetem Status.
  liste: view
    .input(z.object({
      suche:     z.string().trim().optional(),
      kategorie: z.string().trim().optional(),
      standort:  z.string().trim().optional(),
      nurAktive: z.boolean().default(true),
    }).optional())
    .query(async ({ input }) => {
      const where: Prisma.VerbrauchsArtikelWhereInput = {};
      if (input?.nurAktive !== false) where.aktiv = true;
      if (input?.kategorie) where.kategorie = input.kategorie;
      if (input?.standort)  where.standort  = input.standort;
      if (input?.suche) {
        const q = input.suche;
        where.OR = [
          { name:     { contains: q } },
          { merkmale: { contains: q } },
          { code:     { contains: q } },
          { aan:      { contains: q } },
        ];
      }

      const artikel = await prisma.verbrauchsArtikel.findMany({
        where,
        orderBy: [{ aktiv: "desc" }, { name: "asc" }],
      });

      return artikel.map((a) => ({
        ...a,
        status: status(a.aktuellerBestand, a.mindestbestand),
      }));
    }),

  // Distinct-Werte für die Filter-Dropdowns (nur nicht-leere).
  filterOptionen: view.query(async () => {
    const rows = await prisma.verbrauchsArtikel.findMany({
      select: { kategorie: true, standort: true },
    });
    const kategorien = [...new Set(rows.map((r) => r.kategorie).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, "de"));
    const standorte  = [...new Set(rows.map((r) => r.standort).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, "de"));
    return { kategorien, standorte };
  }),

  // Neuen Artikel anlegen (Code wird automatisch vergeben).
  anlegen: manage
    .input(positionInput)
    .mutation(async ({ input }) => {
      const data = bereinige(input);
      if (!data.name) throw new TRPCError({ code: "BAD_REQUEST", message: "Name fehlt" });
      const artikel = await prisma.$transaction((tx) => createMitCode(tx, data));
      return { id: artikel.id, code: artikel.code };
    }),

  // Bestehenden Artikel bearbeiten (ALLE Felder; Code bleibt unverändert).
  bearbeiten: manage
    .input(positionInput.extend({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const { id, ...rest } = input;
      const data = bereinige(rest);
      if (!data.name) throw new TRPCError({ code: "BAD_REQUEST", message: "Name fehlt" });
      await prisma.verbrauchsArtikel.update({ where: { id }, data });
      return { ok: true };
    }),

  // Soft-Delete / Reaktivieren — kein Hard-Delete (Zähl-Historie bleibt erhalten).
  setAktiv: manage
    .input(z.object({ id: z.number().int().positive(), aktiv: z.boolean() }))
    .mutation(async ({ input }) => {
      await prisma.verbrauchsArtikel.update({ where: { id: input.id }, data: { aktiv: input.aktiv } });
      return { ok: true };
    }),

  // Bestands-Import (Excel). Match bestehender Artikel nach Name (case-insensitive):
  //   vorhanden  → Felder + aktueller Bestand aktualisieren
  //   neu        → anlegen (+ automatischer Code)
  // Freitext wird in bereinige() aufs Spaltenlimit gekappt → eine lange Zelle
  // kann den Import nie sprengen. Standort kommt aus der Excel nicht und bleibt.
  importBestand: manage
    .input(z.object({ zeilen: z.array(positionInput).min(1) }))
    .mutation(async ({ input }) => {
      // Bestehende einmal laden, nach normalisiertem Namen indexieren.
      const bestehende = await prisma.verbrauchsArtikel.findMany({
        select: { id: true, name: true, standort: true },
      });
      const byName = new Map<string, { id: number; standort: string | null }>();
      for (const a of bestehende) byName.set(a.name.trim().toLowerCase(), { id: a.id, standort: a.standort });

      let neu = 0, aktualisiert = 0, uebersprungen = 0;

      await prisma.$transaction(async (tx) => {
        for (const zeile of input.zeilen) {
          const data = bereinige(zeile);
          if (!data.name) { uebersprungen++; continue; }

          const match = byName.get(data.name.toLowerCase());
          if (match) {
            // Standort aus Excel ist leer → bestehenden Standort NICHT überschreiben.
            const { standort: _ignored, ...rest } = data;
            await tx.verbrauchsArtikel.update({ where: { id: match.id }, data: rest });
            aktualisiert++;
          } else {
            const created = await createMitCode(tx, data);
            byName.set(data.name.toLowerCase(), { id: created.id, standort: created.standort });
            neu++;
          }
        }
      }, { timeout: 120_000 });

      return { neu, aktualisiert, uebersprungen, gesamt: input.zeilen.length };
    }),
});

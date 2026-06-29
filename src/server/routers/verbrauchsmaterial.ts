import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";
import type { Prisma } from "@prisma/client";
import type { SessionUser } from "@/core/types";

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

// Start der laufenden Zählwoche (Montag 00:00). Eine Zählung pro Artikel pro
// Woche; alle Wochen-Lookups (artikelByCode, zaehlen, dieseWoche) nutzen das.
function wochenStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Mo=0 … So=6
  return d;
}

// Zeitraum-Auswahl für die Auswertung. "all" → kein Datums-Filter.
const zeitraumEnum = z.enum(["4w", "3m", "12m", "all"]).default("3m");

function seitDatum(zeitraum: z.infer<typeof zeitraumEnum>): Date | null {
  if (zeitraum === "all") return null;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (zeitraum === "4w")  d.setDate(d.getDate() - 28);
  else if (zeitraum === "3m")  d.setMonth(d.getMonth() - 3);
  else /* 12m */               d.setMonth(d.getMonth() - 12);
  return d;
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

  // ── Handheld-Zählflow ───────────────────────────────────────────────────────

  // Scan: Artikel-Code (z.B. "VM-0001") exakt auflösen. code ist @unique, die
  // MySQL-Default-Collation ist case-insensitive → getrimmter Vergleich genügt.
  // Unbekannt → { gefunden: false } (kein Throw, damit der Scanflow sauber weiterläuft).
  artikelByCode: view
    .input(z.object({ code: z.string().trim().min(1) }))
    .query(async ({ input }) => {
      const code = input.code.trim();
      const a = await prisma.verbrauchsArtikel.findUnique({ where: { code } });
      if (!a) return { gefunden: false as const, code };

      const [letzte, woche] = await Promise.all([
        prisma.verbrauchsZaehlung.findFirst({
          where: { artikelId: a.id }, orderBy: { datum: "desc" }, select: { datum: true },
        }),
        // Zählung DIESER Woche (falls vorhanden) → Handheld kann „dazuzählen?" anbieten.
        prisma.verbrauchsZaehlung.findFirst({
          where: { artikelId: a.id, datum: { gte: wochenStart() } },
          orderBy: { datum: "desc" }, select: { id: true, vorher: true, bestand: true },
        }),
      ]);
      return {
        gefunden: true as const,
        artikel: {
          id:                a.id,
          code:              a.code,
          name:              a.name,
          kategorie:         a.kategorie,
          standort:          a.standort,
          aktuellerBestand:  a.aktuellerBestand, // = letzter Bestand
          mindestbestand:    a.mindestbestand,
          aktiv:             a.aktiv,
          letztesZaehldatum: letzte?.datum ?? null,
          status:            status(a.aktuellerBestand, a.mindestbestand),
          // null = diese Woche noch nicht gezählt; sonst der bisher erfasste Wochenstand.
          wocheBereits:      woche ? { bestand: woche.bestand } : null,
        },
      };
    }),

  // Zählung speichern — EINE Zählung pro Artikel pro Woche:
  //   • erste Zählung der Woche → create (vorher = aktuellerBestand = Vorwochenwert).
  //   • diese Woche schon gezählt → UPDATE der Wochen-Zeile; `vorher` (Vorwochenwert)
  //     bleibt IMMER erhalten, nur bestand/verbrauch/datum ändern sich.
  // Modus:
  //   • "addieren"  → Teilmenge eines weiteren Lagerorts dazu (bestand += input.bestand).
  //   • "ersetzen"  → Gesamtwert korrigieren/überschreiben (bestand = input.bestand).
  // Atomar in einer Transaktion.
  zaehlen: manage
    .input(z.object({
      artikelId: z.number().int().positive(),
      bestand:   z.number().int().min(0),
      modus:     z.enum(["ersetzen", "addieren"]).default("ersetzen"),
    }))
    .mutation(async ({ input, ctx }) => {
      const user     = ctx.session.user as SessionUser;
      const benutzer = cap(user.kuerzel ?? user.name ?? null, 100);

      return prisma.$transaction(async (tx) => {
        const artikel = await tx.verbrauchsArtikel.findUnique({
          where: { id: input.artikelId }, select: { aktuellerBestand: true },
        });
        if (!artikel) throw new TRPCError({ code: "NOT_FOUND", message: "Artikel nicht gefunden" });

        const woche = await tx.verbrauchsZaehlung.findFirst({
          where: { artikelId: input.artikelId, datum: { gte: wochenStart() } },
          orderBy: { datum: "desc" }, select: { id: true, vorher: true, bestand: true },
        });

        // vorher = Vorwochenwert. Bei vorhandener Wochen-Zählung NIEMALS neu aus
        // aktuellerBestand ableiten (sonst würde der Teilbestand zum „vorher").
        const vorher = woche ? woche.vorher : artikel.aktuellerBestand;
        const neu    = woche && input.modus === "addieren"
          ? woche.bestand + input.bestand   // Teilmenge dazu (4 + 6 = 10)
          : input.bestand;                  // erste Zählung ODER Gesamtwert ersetzen
        const verbrauch = Math.max(0, vorher - neu);

        if (woche) {
          await tx.verbrauchsZaehlung.update({
            where: { id: woche.id },
            data:  { bestand: neu, verbrauch, datum: new Date(), benutzer },
          });
        } else {
          await tx.verbrauchsZaehlung.create({
            data: { artikelId: input.artikelId, datum: new Date(), vorher, bestand: neu, verbrauch, benutzer },
          });
        }
        await tx.verbrauchsArtikel.update({
          where: { id: input.artikelId }, data: { aktuellerBestand: neu },
        });
        return { vorher, neu, verbrauch };
      });
    }),

  // Diese Woche (ab Montag 00:00) bereits gezählte Artikel — jüngste Zählung je
  // Artikel — als Fortschritts-/Orientierungsliste. Plus die Gegenliste „offen":
  // aktive Artikel ohne Zählung diese Woche (= noch zu scannen).
  dieseWoche: view.query(async () => {
    const start = wochenStart();

    const [zaehlungen, aktiveGesamt] = await Promise.all([
      prisma.verbrauchsZaehlung.findMany({
        where:   { datum: { gte: start } },
        orderBy: { datum: "desc" },
        include: { artikel: { select: { name: true, code: true } } },
      }),
      prisma.verbrauchsArtikel.count({ where: { aktiv: true } }),
    ]);

    // Jüngste Zählung je Artikel (Liste ist bereits absteigend sortiert).
    const gesehen = new Set<number>();
    const erfasst = [];
    for (const z of zaehlungen) {
      if (gesehen.has(z.artikelId)) continue;
      gesehen.add(z.artikelId);
      erfasst.push({
        artikelId: z.artikelId,
        name:      z.artikel.name,
        code:      z.artikel.code,
        bestand:   z.bestand,
        verbrauch: z.verbrauch,
        datum:     z.datum,
        benutzer:  z.benutzer,
      });
    }

    // Noch offen: aktive Artikel, die diese Woche keine Zählung haben. notIn mit
    // leerem Array ist in Prisma unkritisch (= keine Ausschlüsse).
    const offen = await prisma.verbrauchsArtikel.findMany({
      where:   { aktiv: true, id: { notIn: [...gesehen] } },
      select:  { id: true, code: true, name: true, kategorie: true, standort: true, aktuellerBestand: true, mindestbestand: true },
      orderBy: [{ kategorie: "asc" }, { name: "asc" }],
    });

    return { erfasst, anzahl: erfasst.length, aktiveGesamt, offen, offenAnzahl: offen.length };
  }),

  // ── Auswertung (alles MATERIAL_VIEW) ────────────────────────────────────────

  // Top 10 Artikel nach Summe Verbrauch im Zeitraum.
  topVerbrauch: view
    .input(z.object({ zeitraum: zeitraumEnum }).optional())
    .query(async ({ input }) => {
      const since = seitDatum(input?.zeitraum ?? "3m");
      const where: Prisma.VerbrauchsZaehlungWhereInput = since ? { datum: { gte: since } } : {};

      const grouped = await prisma.verbrauchsZaehlung.groupBy({
        by: ["artikelId"], where, _sum: { verbrauch: true },
      });
      const sortiert = grouped
        .map((g) => ({ artikelId: g.artikelId, verbrauch: g._sum.verbrauch ?? 0 }))
        .filter((g) => g.verbrauch > 0)
        .sort((a, b) => b.verbrauch - a.verbrauch)
        .slice(0, 10);

      const arts = await prisma.verbrauchsArtikel.findMany({
        where:  { id: { in: sortiert.map((s) => s.artikelId) } },
        select: { id: true, name: true, code: true, kategorie: true },
      });
      const map = new Map(arts.map((a) => [a.id, a]));

      return sortiert.map((s) => ({
        artikelId: s.artikelId,
        name:      map.get(s.artikelId)?.name ?? "—",
        code:      map.get(s.artikelId)?.code ?? "",
        kategorie: map.get(s.artikelId)?.kategorie ?? null,
        verbrauch: s.verbrauch,
      }));
    }),

  // Verbrauchs-/Bestandsverlauf eines Artikels (chronologisch, je Zählung).
  verlauf: view
    .input(z.object({ artikelId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const [artikel, eintraege] = await Promise.all([
        prisma.verbrauchsArtikel.findUnique({
          where: { id: input.artikelId }, select: { name: true, code: true },
        }),
        prisma.verbrauchsZaehlung.findMany({
          where:   { artikelId: input.artikelId },
          orderBy: { datum: "asc" },
          select:  { datum: true, verbrauch: true, bestand: true },
        }),
      ]);
      return { name: artikel?.name ?? "—", code: artikel?.code ?? "", eintraege };
    }),

  // Nachbestell-Liste: aktive Artikel unter Mindestbestand, sortiert nach „fehlt".
  // Spaltenvergleich (aktuellerBestand < mindestbestand) macht Prisma nicht direkt
  // → mindestbestand>0 vorfiltern, Rest in JS.
  nachbestellen: view.query(async () => {
    const arts = await prisma.verbrauchsArtikel.findMany({
      where:  { aktiv: true, mindestbestand: { gt: 0 } },
      select: { id: true, name: true, kategorie: true, standort: true, aktuellerBestand: true, mindestbestand: true, aan: true },
    });
    return arts
      .filter((a) => a.aktuellerBestand < a.mindestbestand)
      .map((a) => ({ ...a, fehlt: a.mindestbestand - a.aktuellerBestand }))
      .sort((a, b) => b.fehlt - a.fehlt);
  }),

  // KPIs: aktive Artikel, davon unter Mindestbestand, Gesamtverbrauch im Zeitraum.
  kpis: view
    .input(z.object({ zeitraum: zeitraumEnum }).optional())
    .query(async ({ input }) => {
      const since = seitDatum(input?.zeitraum ?? "3m");
      const [aktivGesamt, unterMindestRows, sumAgg] = await Promise.all([
        prisma.verbrauchsArtikel.count({ where: { aktiv: true } }),
        prisma.verbrauchsArtikel.findMany({
          where: { aktiv: true, mindestbestand: { gt: 0 } },
          select: { aktuellerBestand: true, mindestbestand: true },
        }),
        prisma.verbrauchsZaehlung.aggregate({
          _sum: { verbrauch: true },
          where: since ? { datum: { gte: since } } : {},
        }),
      ]);
      const unterMindest = unterMindestRows.filter((a) => a.aktuellerBestand < a.mindestbestand).length;
      return { aktivGesamt, unterMindest, gesamtverbrauch: sumAgg._sum.verbrauch ?? 0 };
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

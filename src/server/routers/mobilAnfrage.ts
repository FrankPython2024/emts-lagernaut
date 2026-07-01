import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "@prisma/client";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";
import { MOBIL_TEILTYPEN } from "@/lib/mobil/parser";
import type { SessionUser } from "@/core/types";

// Mobil-Anfragen (Techniker fragt ein mobiles Ersatzteil an).
// Eigenes, technikerseitiges Modul — getrennt vom Admin-Mobil-Browsing (MOBIL_VIEW)
// und vom Laptop-Anfrage-System. Recht: ANFRAGE_MOBIL_CREATE (pro Nutzer vergebbar).
const req = permissionProcedure("ANFRAGE_MOBIL_CREATE");
// Admin-Bearbeitung der Mobil-Anfragen: Lesen MOBIL_VIEW, Aktionen MOBIL_MANAGE.
const view   = permissionProcedure("MOBIL_VIEW");
const manage = permissionProcedure("MOBIL_MANAGE");

const BEREICHE = ["STANDARD", "DIGITAL_EDUCATION"] as const;
const bereichInput = z.enum(BEREICHE).default("STANDARD");

function n(v: unknown): number {
  if (v == null) return 0;
  const x = typeof v === "bigint" ? Number(v) : Number(v as number | string);
  return Number.isFinite(x) ? x : 0;
}

function kuerzelVon(user: SessionUser): string {
  return (user.kuerzel ?? user.name ?? String(user.id)).trim();
}

export const mobilAnfrageRouter = createTRPCRouter({

  // Hersteller mit aktivem Bestand im Bereich (für die Modell-Auswahl).
  hersteller: req
    .input(z.object({ bereich: bereichInput }))
    .query(async ({ input }) => {
      const rows = await prisma.$queryRaw<Array<{ hersteller: string; modelle: bigint; teile: bigint }>>`
        SELECT m.hersteller AS hersteller,
               COUNT(DISTINCT m.id)      AS modelle,
               COUNT(DISTINCT tm.teilId) AS teile
        FROM \`MobilModell\` m
        JOIN \`MobilTeilModell\` tm ON tm.modellId = m.id
        JOIN \`MobilTeil\` t        ON t.id = tm.teilId AND t.ausgeschieden = false AND t.bereich = ${input.bereich}
        GROUP BY m.hersteller
        ORDER BY teile DESC, m.hersteller ASC`;
      return rows.map((r) => ({ hersteller: r.hersteller, modelle: n(r.modelle), teile: n(r.teile) }));
    }),

  // Modelle eines Herstellers mit aktivem Bestand im Bereich.
  modelle: req
    .input(z.object({ bereich: bereichInput, hersteller: z.string().trim().min(1) }))
    .query(async ({ input }) => {
      const rows = await prisma.$queryRaw<Array<{ id: number; modell: string; stueck: bigint }>>`
        SELECT m.id AS id, m.modell AS modell, COUNT(DISTINCT tm.teilId) AS stueck
        FROM \`MobilModell\` m
        JOIN \`MobilTeilModell\` tm ON tm.modellId = m.id
        JOIN \`MobilTeil\` t        ON t.id = tm.teilId AND t.ausgeschieden = false AND t.bereich = ${input.bereich}
        WHERE m.hersteller = ${input.hersteller}
        GROUP BY m.id, m.modell`;
      return rows
        .map((r) => ({ id: r.id, modell: r.modell, stueck: n(r.stueck) }))
        .sort((a, b) => a.modell.localeCompare(b.modell, "de", { numeric: true }));
    }),

  // Alle Standard-Teiltypen für ein Modell+Bereich, jeweils mit Bestand + Status
  // (NEU = Bestand>0, BEDARF = 0). Bewusst die FESTE Teiltyp-Liste, damit der
  // Techniker auch ein nicht vorrätiges Teil (BEDARF) anfragen kann.
  teiltypen: req
    .input(z.object({ bereich: bereichInput, modellId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const rows = await prisma.$queryRaw<Array<{ teiltyp: string | null; anzahl: bigint }>>`
        SELECT tt.name AS teiltyp, COUNT(*) AS anzahl
        FROM \`MobilTeilModell\` tm
        JOIN \`MobilTeil\` t      ON t.id = tm.teilId
        LEFT JOIN \`MobilTeiltyp\` tt ON tt.id = t.teiltypId
        WHERE tm.modellId = ${input.modellId} AND t.ausgeschieden = false AND t.bereich = ${input.bereich}
        GROUP BY tt.name`;
      const bestandByName = new Map(
        rows.filter((r) => r.teiltyp).map((r) => [r.teiltyp as string, n(r.anzahl)]),
      );
      // Mobilteile: NUR Teiltypen MIT Bestand zeigen — es gibt kein BEDARF (anders
      // als bei Laptop-Teilen). Was nicht auf Lager ist, ist nicht anfragbar.
      return MOBIL_TEILTYPEN
        .map((name) => ({ teiltyp: name, bestand: bestandByName.get(name) ?? 0 }))
        .filter((t) => t.bestand > 0);
    }),

  // Anfrage anlegen. Status wird aus dem aktuellen Bestand abgeleitet (NEU/BEDARF),
  // analog zur Laptop-Regel. Kein Bestandseffekt — die Ausgabe erfolgt erst beim
  // Erledigen durch den Admin (Etappe B).
  erstellen: req
    .input(z.object({
      bereich:   bereichInput,
      modellId:  z.number().int().positive(),
      teiltyp:   z.string().trim().min(1).max(100),
      menge:     z.number().int().min(1).max(99).default(1),
      kommentar: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session.user as SessionUser;

      const [row] = await prisma.$queryRaw<Array<{ anzahl: bigint }>>`
        SELECT COUNT(*) AS anzahl
        FROM \`MobilTeilModell\` tm
        JOIN \`MobilTeil\` t      ON t.id = tm.teilId
        LEFT JOIN \`MobilTeiltyp\` tt ON tt.id = t.teiltypId
        WHERE tm.modellId = ${input.modellId} AND t.ausgeschieden = false
          AND t.bereich = ${input.bereich} AND tt.name = ${input.teiltyp}`;
      const bestand = n(row?.anzahl);
      // Mobilteile kennen kein BEDARF: nicht (mehr) vorrätige Teile sind nicht anfragbar.
      if (bestand <= 0) {
        throw new TRPCError({
          code:    "BAD_REQUEST",
          message: "Dieses Teil ist nicht (mehr) auf Lager und kann nicht angefragt werden.",
        });
      }
      const status = "NEU" as const;

      const a = await prisma.mobilAnfrage.create({
        data: {
          techniker: kuerzelVon(user),
          bereich:   input.bereich,
          modellId:  input.modellId,
          teiltyp:   input.teiltyp,
          menge:     input.menge,
          kommentar: input.kommentar?.trim() || null,
          status,
        },
      });
      return { id: a.id, status };
    }),

  // Eigene Anfragen des angemeldeten Technikers (neueste zuerst).
  meine: req.query(async ({ ctx }) => {
    const kuerzel = kuerzelVon(ctx.session.user as SessionUser);
    const rows = await prisma.mobilAnfrage.findMany({
      where:   { techniker: kuerzel },
      orderBy: { datum: "desc" },
      take:    50,
      include: { modell: { select: { hersteller: true, modell: true } } },
    });
    return rows.map((r) => ({
      id:         r.id,
      datum:      r.datum,
      bereich:    r.bereich,
      hersteller: r.modell.hersteller,
      modell:     r.modell.modell,
      teiltyp:    r.teiltyp,
      menge:      r.menge,
      status:     r.status,
      kommentar:  r.kommentar,
    }));
  }),

  // ── Admin-Bearbeitung ────────────────────────────────────────────────────────

  // Liste aller Mobil-Anfragen (Filter Status/Bereich), paginiert.
  adminListe: view
    .input(z.object({
      status:  z.enum(["ALLE", "NEU", "BEDARF", "IN_BEARBEITUNG", "ABGESCHLOSSEN", "STORNIERT"]).default("ALLE"),
      bereich: z.enum(["ALLE", "STANDARD", "DIGITAL_EDUCATION"]).default("ALLE"),
      offset:  z.number().int().min(0).default(0),
      limit:   z.number().int().min(1).max(200).default(50),
    }))
    .query(async ({ input }) => {
      const bereichWhere: Prisma.MobilAnfrageWhereInput =
        input.bereich !== "ALLE" ? { bereich: input.bereich } : {};
      const where: Prisma.MobilAnfrageWhereInput = {
        ...bereichWhere,
        ...(input.status !== "ALLE" ? { status: input.status } : {}),
      };
      const [gesamt, rows, offen] = await Promise.all([
        prisma.mobilAnfrage.count({ where }),
        prisma.mobilAnfrage.findMany({
          where, orderBy: { datum: "desc" }, skip: input.offset, take: input.limit,
          include: { modell: { select: { hersteller: true, modell: true } } },
        }),
        // Offen = noch nicht erledigt/storniert (für Badge) — im GLEICHEN Bereich wie die Liste.
        prisma.mobilAnfrage.count({ where: { ...bereichWhere, status: { in: ["NEU", "BEDARF", "IN_BEARBEITUNG"] } } }),
      ]);
      return {
        gesamt,
        offen,
        zeilen: rows.map((r) => ({
          id:            r.id,
          datum:         r.datum,
          techniker:     r.techniker,
          bereich:       r.bereich,
          modellId:      r.modellId,
          hersteller:    r.modell.hersteller,
          modell:        r.modell.modell,
          teiltyp:       r.teiltyp,
          menge:         r.menge,
          kommentar:     r.kommentar,
          status:        r.status,
          bearbeitetVon: r.bearbeitetVon,
          erledigtLogId: r.erledigtLogId,
        })),
      };
    }),

  // Verfügbare Teile (LogIDs) für eine Anfrage — zum Ausgeben auswählen.
  verfuegbareTeile: view
    .input(z.object({ modellId: z.number().int().positive(), teiltyp: z.string().trim().min(1), bereich: bereichInput }))
    .query(async ({ input }) => {
      return prisma.mobilTeil.findMany({
        where: {
          ausgeschieden: false,
          bereich:       input.bereich,
          teiltyp:       { name: input.teiltyp },
          modelle:       { some: { modellId: input.modellId } },
        },
        select:  { logId: true, colli: true, stellplatz: true, farbe: true },
        orderBy: [{ colli: { sort: "asc", nulls: "last" } }, { logId: "asc" }],
        take:    200,
      });
    }),

  // Status setzen (In Bearbeitung / Storniert / zurück auf NEU). bearbeitetVon = Admin.
  setStatus: manage
    .input(z.object({
      id:     z.number().int().positive(),
      status: z.enum(["NEU", "BEDARF", "IN_BEARBEITUNG", "STORNIERT"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session.user as SessionUser;
      await prisma.mobilAnfrage.update({
        where: { id: input.id },
        data:  { status: input.status, bearbeitetVon: kuerzelVon(user) },
      });
      return { ok: true };
    }),

  // Erledigen/Ausgeben. Mit logId → das konkrete Teil als ausgeschieden (ausgegeben)
  // markieren (Abgangs-Mechanismus); ohne logId → nur als abgeschlossen markieren
  // (z.B. BEDARF ohne verfügbares Teil). Verifiziert, dass die LogID zu Modell+
  // Teiltyp+Bereich passt und noch aktiv ist.
  erledigen: manage
    .input(z.object({ id: z.number().int().positive(), logId: z.string().trim().min(1).optional() }))
    .mutation(async ({ ctx, input }) => {
      const user    = ctx.session.user as SessionUser;
      const anfrage = await prisma.mobilAnfrage.findUnique({ where: { id: input.id } });
      if (!anfrage) throw new TRPCError({ code: "NOT_FOUND", message: "Anfrage nicht gefunden." });

      let erledigtLogId: string | null = null;
      if (input.logId) {
        const teil = await prisma.mobilTeil.findFirst({
          where: {
            logId:         input.logId,
            ausgeschieden: false,
            bereich:       anfrage.bereich,
            teiltyp:       { name: anfrage.teiltyp },
            modelle:       { some: { modellId: anfrage.modellId } },
          },
          select: { id: true },
        });
        if (!teil) {
          throw new TRPCError({
            code:    "BAD_REQUEST",
            message: "LogID passt nicht (falsches Modell/Teiltyp/Bereich oder bereits ausgeschieden).",
          });
        }
        // Atomar ausbuchen: nur flippen, wenn noch aktiv. Verhindert Doppel-Ausgabe
        // desselben Teils durch zwei parallel arbeitende Admins (Race).
        const flip = await prisma.mobilTeil.updateMany({
          where: { id: teil.id, ausgeschieden: false },
          data:  { ausgeschieden: true, ausgeschiedenAm: new Date() },
        });
        if (flip.count === 0) {
          throw new TRPCError({
            code:    "BAD_REQUEST",
            message: "Teil wurde inzwischen ausgegeben. Bitte ein anderes wählen.",
          });
        }
        erledigtLogId = input.logId;
      }

      await prisma.mobilAnfrage.update({
        where: { id: input.id },
        data:  { status: "ABGESCHLOSSEN", bearbeitetVon: kuerzelVon(user), erledigtLogId },
      });
      return { ok: true, erledigtLogId };
    }),
});

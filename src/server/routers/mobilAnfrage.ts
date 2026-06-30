import { z } from "zod";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";
import { MOBIL_TEILTYPEN } from "@/lib/mobil/parser";
import type { SessionUser } from "@/core/types";

// Mobil-Anfragen (Techniker fragt ein mobiles Ersatzteil an).
// Eigenes, technikerseitiges Modul — getrennt vom Admin-Mobil-Browsing (MOBIL_VIEW)
// und vom Laptop-Anfrage-System. Recht: ANFRAGE_MOBIL_CREATE (pro Nutzer vergebbar).
const req = permissionProcedure("ANFRAGE_MOBIL_CREATE");

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
      return MOBIL_TEILTYPEN.map((name) => {
        const bestand = bestandByName.get(name) ?? 0;
        return { teiltyp: name, bestand, status: bestand > 0 ? "NEU" : "BEDARF" } as const;
      });
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
      const status: "NEU" | "BEDARF" = bestand > 0 ? "NEU" : "BEDARF";

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
});

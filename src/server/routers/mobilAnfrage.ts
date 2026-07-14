import { z } from "zod";
import { randomUUID } from "crypto";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
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

  // Teiltypen für ein Modell+Bereich, die AKTUELL Bestand haben (nur diese sind
  // anfragbar — Mobil kennt kein BEDARF). Aus den echten Teilen abgeleitet, also
  // inkl. manuell angelegter Teiltypen (z. B. „Back Glass").
  teiltypen: req
    .input(z.object({ bereich: bereichInput, modellId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const rows = await prisma.$queryRaw<Array<{ teiltyp: string | null; farbe: string | null; anzahl: bigint }>>`
        SELECT tt.name AS teiltyp, t.farbe AS farbe, COUNT(*) AS anzahl
        FROM \`MobilTeilModell\` tm
        JOIN \`MobilTeil\` t      ON t.id = tm.teilId
        LEFT JOIN \`MobilTeiltyp\` tt ON tt.id = t.teiltypId
        WHERE tm.modellId = ${input.modellId} AND t.ausgeschieden = false AND t.bereich = ${input.bereich}
        GROUP BY tt.name, t.farbe`;
      // Je Teiltyp: Gesamtbestand + Farb-Aufschlüsselung (farbe=null → „ohne Farbe").
      const byTeiltyp = new Map<string, { bestand: number; farben: Map<string | null, number> }>();
      for (const r of rows) {
        if (!r.teiltyp) continue;
        const e = byTeiltyp.get(r.teiltyp) ?? { bestand: 0, farben: new Map<string | null, number>() };
        const anz = n(r.anzahl);
        e.bestand += anz;
        e.farben.set(r.farbe, (e.farben.get(r.farbe) ?? 0) + anz);
        byTeiltyp.set(r.teiltyp, e);
      }
      // Mobilteile: NUR Teiltypen MIT Bestand (kein BEDARF). ALLE vorhandenen
      // Teiltypen — auch manuell angelegte wie „Back Glass" (NICHT auf die feste
      // Parser-Liste beschränken, sonst sind Custom-Teiltypen für den Techniker
      // unsichtbar). Reihenfolge: kanonische zuerst, Custom danach alphabetisch.
      const rang = (name: string) => {
        const i = (MOBIL_TEILTYPEN as readonly string[]).indexOf(name);
        return i === -1 ? MOBIL_TEILTYPEN.length : i;
      };
      return [...byTeiltyp.keys()]
        .sort((a, b) => rang(a) - rang(b) || a.localeCompare(b, "de"))
        .flatMap((name) => {
          const e = byTeiltyp.get(name)!;
          if (e.bestand <= 0) return [];
          const farben = [...e.farben.entries()]
            .map(([farbe, anzahl]) => ({ farbe, anzahl }))
            .sort((a, b) => b.anzahl - a.anzahl);
          return [{ teiltyp: name, bestand: e.bestand, farben }];
        });
    }),

  // ReForm-Original-Bezeichnung(en) der Teile hinter EINER Teiltyp/Farbe-Kachel —
  // für den Detail-Klick im Techniker-Portal („wie heißt das Teil in ReForm?").
  // farbe = null trifft exakt die Kachel „ohne Farbe" (Prisma: farbe IS NULL).
  // Distinct + Anzahl, damit identische Wortlaute nicht mehrfach erscheinen.
  teilBezeichnungen: req
    .input(z.object({
      bereich:  bereichInput,
      modellId: z.number().int().positive(),
      teiltyp:  z.string().trim().min(1).max(100),
      farbe:    z.string().trim().max(32).nullable(),
    }))
    .query(async ({ input }) => {
      const teile = await prisma.mobilTeil.findMany({
        where: {
          ausgeschieden: false,
          bereich:       input.bereich,
          teiltyp:       { name: input.teiltyp },
          modelle:       { some: { modellId: input.modellId } },
          farbe:         input.farbe, // String → equals, null → IS NULL (passt zur Kachel)
        },
        select: { originalBezeichnung: true },
      });
      const map = new Map<string, number>();
      for (const t of teile) {
        const b = (t.originalBezeichnung ?? "").trim() || "(keine Bezeichnung hinterlegt)";
        map.set(b, (map.get(b) ?? 0) + 1);
      }
      return [...map.entries()]
        .map(([bezeichnung, anzahl]) => ({ bezeichnung, anzahl }))
        .sort((a, b) => b.anzahl - a.anzahl || a.bezeichnung.localeCompare(b.bezeichnung, "de"));
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

  // Warenkorb-Sendung: mehrere Teile eines Modells als EINE Anfrage (gemeinsame
  // gruppenNr). Nur vorrätige Teiltypen (kein BEDARF); 0-Bestand-Teile werden
  // abgelehnt und separat gemeldet (Race-Schutz — Bestand kann sich geändert haben).
  erstellenSammel: req
    .input(z.object({
      bereich:  bereichInput,
      modellId: z.number().int().positive(),
      items: z.array(z.object({
        teiltyp:   z.string().trim().min(1).max(100),
        farbe:     z.string().trim().max(32).nullable().optional(),
        menge:     z.number().int().min(1).max(99).default(1),
        kommentar: z.string().max(2000).optional(),
      })).min(1).max(30),
    }))
    .mutation(async ({ ctx, input }) => {
      const user      = ctx.session.user as SessionUser;
      const techniker = kuerzelVon(user);
      const gruppenNr = randomUUID();

      const erstellt: string[]  = [];
      const abgelehnt: string[] = [];
      for (const item of input.items) {
        const farbe = item.farbe || null;
        const farbeFilter = farbe ? Prisma.sql`AND t.farbe = ${farbe}` : Prisma.empty;
        const [row] = await prisma.$queryRaw<Array<{ anzahl: bigint }>>(Prisma.sql`
          SELECT COUNT(*) AS anzahl
          FROM \`MobilTeilModell\` tm
          JOIN \`MobilTeil\` t      ON t.id = tm.teilId
          LEFT JOIN \`MobilTeiltyp\` tt ON tt.id = t.teiltypId
          WHERE tm.modellId = ${input.modellId} AND t.ausgeschieden = false
            AND t.bereich = ${input.bereich} AND tt.name = ${item.teiltyp} ${farbeFilter}`);
        if (n(row?.anzahl) <= 0) { abgelehnt.push(item.teiltyp + (farbe ? ` (${farbe})` : "")); continue; }
        await prisma.mobilAnfrage.create({
          data: {
            techniker, bereich: input.bereich, modellId: input.modellId,
            teiltyp: item.teiltyp, farbe, menge: item.menge, kommentar: item.kommentar?.trim() || null,
            status: "NEU", gruppenNr,
          },
        });
        erstellt.push(item.teiltyp);
      }
      return { gruppenNr, erstellt: erstellt.length, abgelehnt };
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
      farbe:      r.farbe,
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
          include: {
            modell: { select: { hersteller: true, modell: true } },
            picks:  { select: { logId: true }, orderBy: { gescanntAm: "asc" } },
          },
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
          gruppenNr:     r.gruppenNr,
          modellId:      r.modellId,
          hersteller:    r.modell.hersteller,
          modell:        r.modell.modell,
          teiltyp:       r.teiltyp,
          farbe:         r.farbe,
          menge:         r.menge,
          kommentar:     r.kommentar,
          status:        r.status,
          bearbeitetVon: r.bearbeitetVon,
          erledigtLogId: r.erledigtLogId,
          gefundenAnzahl: r.picks.length,
          logIds:        r.picks.map((p) => p.logId),
        })),
      };
    }),

  // Verfügbare Teile (LogIDs) für eine Anfrage — zum Ausgeben auswählen.
  verfuegbareTeile: view
    .input(z.object({
      modellId: z.number().int().positive(),
      teiltyp:  z.string().trim().min(1),
      bereich:  bereichInput,
      farbe:    z.string().trim().max(32).nullable().optional(), // gewünschte Farbe der Anfrage
    }))
    .query(async ({ input }) => {
      return prisma.mobilTeil.findMany({
        where: {
          ausgeschieden: false,
          bereich:       input.bereich,
          teiltyp:       { name: input.teiltyp },
          modelle:       { some: { modellId: input.modellId } },
          ...(input.farbe ? { farbe: input.farbe } : {}),
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

  // ── Handheld-Pick-Liste ──────────────────────────────────────────────────────

  // Offene Anfragen (NEU/IN_BEARBEITUNG) für den Picker, mit Pick-Fortschritt.
  // gefundenAnzahl = erfasste LogIDs; komplett = manuell ODER picks >= menge.
  pickliste: view
    .input(z.object({ bereich: z.enum(["ALLE", "STANDARD", "DIGITAL_EDUCATION"]).default("ALLE") }))
    .query(async ({ input }) => {
      const where: Prisma.MobilAnfrageWhereInput = {
        status: { in: ["NEU", "IN_BEARBEITUNG"] },
        ...(input.bereich !== "ALLE" ? { bereich: input.bereich } : {}),
      };
      const rows = await prisma.mobilAnfrage.findMany({
        where,
        orderBy: { datum: "asc" },
        include: {
          modell: { select: { hersteller: true, modell: true } },
          picks:  { select: { logId: true }, orderBy: { gescanntAm: "asc" } },
        },
      });
      const zeilen = rows.map((r) => {
        const gefundenAnzahl = r.picks.length;
        const komplett = r.gefunden || gefundenAnzahl >= r.menge;
        return {
          id: r.id, techniker: r.techniker, bereich: r.bereich,
          hersteller: r.modell.hersteller, modell: r.modell.modell,
          teiltyp: r.teiltyp, farbe: r.farbe, menge: r.menge, kommentar: r.kommentar,
          gefundenAnzahl, komplett, manuell: r.gefunden,
          logIds: r.picks.map((p) => p.logId),
        };
      });
      // Offene (nicht komplett) zuerst; innerhalb stabil nach Datum (orderBy oben).
      zeilen.sort((a, b) => Number(a.komplett) - Number(b.komplett));
      return { zeilen, gesamt: zeilen.length, komplett: zeilen.filter((z) => z.komplett).length };
    }),

  // Teil-LogID scannen → EIN Stück der passenden offenen Zeile abhaken (LogID erfasst).
  // Menge>1 braucht entsprechend viele Scans. Bereits erfasste LogID (irgendeine offene
  // Anfrage) → abgelehnt. Nur aktive Teile (ausgeschieden=false).
  pickScan: manage
    .input(z.object({
      logId:   z.string().trim().min(1),
      bereich: z.enum(["ALLE", "STANDARD", "DIGITAL_EDUCATION"]).default("ALLE"),
    }))
    .mutation(async ({ ctx, input }) => {
      const user    = ctx.session.user as SessionUser;
      const roh     = input.logId.trim();
      const ziffern = roh.replace(/\D/g, "");
      const punkt   = ziffern.replace(/(\d{3})(?=\d)/g, "$1.");
      const kandidaten = [...new Set([roh, ziffern, punkt].filter(Boolean))];

      const teil = await prisma.mobilTeil.findFirst({
        where:  { logId: { in: kandidaten }, ausgeschieden: false },
        select: {
          logId: true, bereich: true, farbe: true,
          teiltyp: { select: { name: true } },
          modelle: { select: { modellId: true } },
        },
      });
      if (!teil || !teil.teiltyp) return { status: "unbekannt" as const };
      if (input.bereich !== "ALLE" && teil.bereich !== input.bereich) {
        return { status: "andererBereich" as const, bereich: teil.bereich };
      }

      // Diese LogID schon an einer offenen Anfrage erfasst? (ein Teil = ein Bedarf)
      const schon = await prisma.mobilAnfragePick.findFirst({
        where:  { logId: teil.logId, anfrage: { status: { in: ["NEU", "IN_BEARBEITUNG"] } } },
        select: { id: true },
      });
      if (schon) return { status: "schonErfasst" as const };

      const modellIds = teil.modelle.map((m) => m.modellId);
      const kandidatAnfragen = await prisma.mobilAnfrage.findMany({
        where: {
          status:   { in: ["NEU", "IN_BEARBEITUNG"] },
          gefunden: false,
          bereich:  teil.bereich,
          teiltyp:  teil.teiltyp.name,
          modellId: { in: modellIds },
          // Farbe muss passen ODER die Anfrage ist farb-neutral (farbe = null).
          OR: [{ farbe: teil.farbe }, { farbe: null }],
        },
        orderBy: { datum: "asc" },
        include: { _count: { select: { picks: true } }, modell: { select: { modell: true } } },
      });
      // Restbedarf; exakte Farbe zuerst, sonst farb-neutrale Anfrage.
      const offen = kandidatAnfragen.filter((a) => a._count.picks < a.menge);
      const ziel = offen.find((a) => a.farbe === teil.farbe) ?? offen.find((a) => a.farbe === null);
      if (!ziel) return { status: "keinBedarf" as const, teiltyp: teil.teiltyp.name };

      await prisma.mobilAnfragePick.create({
        data: { anfrageId: ziel.id, logId: teil.logId, gescanntVon: kuerzelVon(user) },
      });
      const neu = ziel._count.picks + 1;
      return {
        status:  "gefunden" as const,
        anfrage: { id: ziel.id, modell: ziel.modell.modell, teiltyp: ziel.teiltyp, farbe: ziel.farbe, menge: ziel.menge, gefunden: neu, komplett: neu >= ziel.menge, logId: teil.logId },
      };
    }),

  // Einen erfassten Pick (LogID) wieder entfernen (Fehlscan korrigieren).
  pickEntfernen: manage
    .input(z.object({ anfrageId: z.number().int().positive(), logId: z.string().trim().min(1) }))
    .mutation(async ({ input }) => {
      await prisma.mobilAnfragePick.deleteMany({ where: { anfrageId: input.anfrageId, logId: input.logId } });
      return { ok: true };
    }),

  // Manuell „komplett" umschalten (Tap-Fallback ohne Scan — z.B. schon in der Hand).
  setGefunden: manage
    .input(z.object({ id: z.number().int().positive(), gefunden: z.boolean() }))
    .mutation(async ({ input }) => {
      await prisma.mobilAnfrage.update({
        where: { id: input.id },
        data:  { gefunden: input.gefunden, gefundenAm: input.gefunden ? new Date() : null },
      });
      return { ok: true };
    }),

  // Umbuchen: die erfassten LogIDs der Anfrage ausbuchen (jedes Teil → ausgeschieden),
  // Anfrage → ABGESCHLOSSEN. Nur Teile, die noch aktiv + im richtigen Bereich sind.
  ausbuchenPicks: manage
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const user    = ctx.session.user as SessionUser;
      const anfrage = await prisma.mobilAnfrage.findUnique({
        where:   { id: input.id },
        include: { picks: { select: { logId: true } } },
      });
      if (!anfrage) throw new TRPCError({ code: "NOT_FOUND", message: "Anfrage nicht gefunden." });
      if (anfrage.picks.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Keine erfassten LogIDs zum Umbuchen." });
      }
      const logIds = anfrage.picks.map((p) => p.logId);
      const res = await prisma.mobilTeil.updateMany({
        where: { logId: { in: logIds }, ausgeschieden: false, bereich: anfrage.bereich },
        data:  { ausgeschieden: true, ausgeschiedenAm: new Date() },
      });
      await prisma.mobilAnfrage.update({
        where: { id: input.id },
        data:  { status: "ABGESCHLOSSEN", bearbeitetVon: kuerzelVon(user), erledigtLogId: logIds[0] ?? null },
      });
      return { ok: true, ausgebucht: res.count, logIds };
    }),
});

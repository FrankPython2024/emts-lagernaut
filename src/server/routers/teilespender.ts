import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";
import { VerwertungsEntnahmeArt } from "@prisma/client";
import {
  sucheSpender,
  spenderModelle,
  geraeteAkte,
  modellSchluessel,
  hinweiseFuerAnfragen,
  spenderFuerGruppe,
} from "@/modules/teilespender/service";
import { bewerteFrische } from "@/lib/teilespender/frische";
import type { SessionUser } from "@/core/types";

// ── Teilespender — „Wo steckt mein Teil noch drin?" ──────────────────────────
//
// Sucht Ersatzteile in Geräten, die es nicht in den Verkauf geschafft haben,
// und sagt, wo sie stehen. Aus dem Ergebnis entsteht direkt ein Pickup-Auftrag.
//
// Rechte getrennt wie bei „Gleiches Gerät finden": Suchen ist Alltagsarbeit,
// der Import ersetzt den kompletten Spender-Bestand.
const suchen = permissionProcedure("TEILESPENDER_VIEW");
const pflegen = permissionProcedure("TEILESPENDER_IMPORT");
// ⚠️ Entnahmen zu vermerken ist ein SCHREIBVORGANG: Er nimmt ein Gerät für alle
// aus der Trefferliste. Er darf deshalb nicht am Leserecht hängen — sonst könnte
// ADMIN_READONLY (Latifa) Daten verändern, obwohl die Rolle ausdrücklich keine
// Schreibrechte haben soll. `ARTIKEL_EINLAGERN` ist die passende Wiederverwendung:
// Wer Teile aus Spendergeräten ausbaut, bucht sie auch ein. Kein neues Recht,
// kein seed-rbac; ADMIN hat es über die Wildcard.
const vermerken = permissionProcedure("ARTIKEL_EINLAGERN");

export const teilespenderRouter = createTRPCRouter({
  /** Modelle, für die es überhaupt Spender gibt (für die Auswahl). */
  modelle: suchen
    .input(z.object({ suche: z.string().trim().max(120).optional() }).optional())
    .query(({ input }) => spenderModelle(input?.suche)),

  /**
   * Die Hauptsuche: Modell + Teiltyp → Geräte mit Fundort, in Laufreihenfolge.
   */
  suche: suchen
    .input(
      z.object({
        modellKey: z.string().trim().max(191).optional(),
        geraeteName: z.string().trim().max(300).optional(),
        hersteller: z.string().trim().max(64).nullish(),
        teiltyp: z.string().trim().min(1).max(191),
        limit: z.number().int().positive().max(500).optional(),
        /** Bei Suche aus einer Anfrage heraus: das Zielgerät ausschließen. */
        ausschliessen: z.array(z.string().trim().max(100)).max(20).optional(),
      }),
    )
    .query(({ input }) =>
      sucheSpender({
        modellKey: input.modellKey,
        geraeteName: input.geraeteName,
        hersteller: input.hersteller,
        teiltyp: input.teiltyp,
        limit: input.limit,
        ausschliessen: input.ausschliessen,
      }),
    ),

  /**
   * Für die Anfragen-Liste: Zu welchen Anfragen steckt das Teil noch in einem
   * Verwertungsgerät? Eine Abfrage für die ganze Liste.
   */
  hinweiseFuerAnfragen: suchen
    .input(z.object({ anfrageIds: z.array(z.number().int().positive()).min(1).max(200) }))
    .query(({ input }) => hinweiseFuerAnfragen(input.anfrageIds)),

  /**
   * Alle Teile einer Anfrage-Gruppe auf einmal — sortiert nach dem Gerät, das
   * die meisten offenen Teile abdeckt.
   */
  fuerGruppe: suchen
    .input(
      z.object({
        geraeteName: z.string().trim().min(1).max(300),
        teiltypen: z.array(z.string().trim().min(1).max(191)).min(1).max(30),
        // Zielgerät der Anfrage — es darf sich nicht selbst vorschlagen.
        zielLogId: z.string().trim().max(100).nullish(),
      }),
    )
    .query(async ({ input }) => {
      const [ergebnis, letzter] = await Promise.all([
        spenderFuerGruppe(input),
        prisma.verwertungsImport.findFirst({
          where: { status: "fertig" },
          orderBy: { importiertAm: "desc" },
          select: { importiertAm: true },
        }),
      ]);
      return { ...ergebnis, frische: bewerteFrische(letzter?.importiertAm ?? null) };
    }),

  /** Suchschlüssel zu einem Gerätenamen — damit die Oberfläche vorbelegen kann. */
  schluessel: suchen
    .input(z.object({ geraeteName: z.string().trim().max(300), hersteller: z.string().trim().max(64).nullish() }))
    .query(({ input }) => ({ modellKey: modellSchluessel(input.geraeteName, input.hersteller) })),

  /** Was steckt in DIESEM Gerät noch drin? Rückwärtssuche über die LogID. */
  akte: suchen
    .input(z.object({ logId: z.string().trim().min(1).max(100) }))
    .query(({ input }) => geraeteAkte(input.logId)),

  /**
   * Ein Teil von Hand als heraus melden.
   *
   * ⚠️ Der Normalfall braucht das NICHT: Wer ein Teil über den Einlager-
   * Assistenten bucht, wird automatisch erkannt (`Buchung.herkunftLogId`).
   * Diese Prozedur ist für den Fall „Karton auf, Teil war schon weg".
   */
  entnahmeMelden: vermerken
    .input(
      z.object({
        logId: z.string().trim().min(1).max(100),
        teiltyp: z.string().trim().min(1).max(191),
        art: z.nativeEnum(VerwertungsEntnahmeArt).default(VerwertungsEntnahmeArt.NICHT_VORHANDEN),
        notiz: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      const geraet = await prisma.verwertungsGeraet.findUnique({
        where: { logId: input.logId },
        select: { logId: true },
      });
      if (!geraet) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `LogID ${input.logId} steht nicht im Verwertungs-Bestand.`,
        });
      }
      const von = user.kuerzel ?? user.name ?? null;
      await prisma.verwertungsEntnahme.upsert({
        where: { logId_teiltyp: { logId: input.logId, teiltyp: input.teiltyp } },
        update: { art: input.art, notiz: input.notiz ?? null, von, am: new Date() },
        create: {
          logId: input.logId,
          teiltyp: input.teiltyp,
          art: input.art,
          notiz: input.notiz ?? null,
          von,
        },
      });
      return { ok: true };
    }),

  /**
   * Mehrere Entnahmen auf einmal melden — aus dem Auslager-Dialog heraus.
   *
   * ⚠️ Wird NACH der Auslagerung aufgerufen, nie davor. Schlägt das hier fehl,
   * ist die Anfrage trotzdem abgeschlossen und das Teil beim Techniker. Ein
   * fehlender Vermerk kostet einen unnötigen Weg; eine abgebrochene Ausgabe
   * kostet die Reparatur.
   */
  entnahmeMeldenViele: vermerken
    .input(
      z.object({
        eintraege: z
          .array(
            z.object({
              logId: z.string().trim().min(1).max(100),
              teiltyp: z.string().trim().min(1).max(191),
              notiz: z.string().trim().max(500).optional(),
            }),
          )
          .min(1)
          .max(50),
        art: z.nativeEnum(VerwertungsEntnahmeArt).default(VerwertungsEntnahmeArt.ENTNOMMEN),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      const von = user.kuerzel ?? user.name ?? null;

      // Nur LogIDs, die es im Verwertungsbestand wirklich gibt — ein Tippfehler
      // soll keine Karteileiche anlegen, die nie jemand wiederfindet.
      const bekannt = await prisma.verwertungsGeraet.findMany({
        where: { logId: { in: input.eintraege.map((e) => e.logId) } },
        select: { logId: true },
      });
      const gueltig = new Set(bekannt.map((b) => b.logId));

      let gespeichert = 0;
      const unbekannt: string[] = [];
      for (const e of input.eintraege) {
        if (!gueltig.has(e.logId)) {
          unbekannt.push(e.logId);
          continue;
        }
        await prisma.verwertungsEntnahme.upsert({
          where: { logId_teiltyp: { logId: e.logId, teiltyp: e.teiltyp } },
          update: { art: input.art, notiz: e.notiz ?? null, von, am: new Date() },
          create: { logId: e.logId, teiltyp: e.teiltyp, art: input.art, notiz: e.notiz ?? null, von },
        });
        gespeichert++;
      }
      return { gespeichert, unbekannt };
    }),

  /** Eine von Hand gemeldete Entnahme zurücknehmen (Fehlklick). */
  entnahmeZuruecknehmen: vermerken
    .input(z.object({ logId: z.string().trim().min(1).max(100), teiltyp: z.string().trim().min(1).max(191) }))
    .mutation(async ({ input }) => {
      // deleteMany statt delete: ein nicht vorhandener Eintrag ist kein Fehler,
      // sondern genau der Zustand, den der Aufrufer haben wollte.
      const { count } = await prisma.verwertungsEntnahme.deleteMany({
        where: { logId: input.logId, teiltyp: input.teiltyp },
      });
      return { entfernt: count };
    }),

  /** Kopfzahlen für die Seite. */
  stand: suchen.query(async () => {
    const [gesamt, freigegeben, letzterImport] = await Promise.all([
      prisma.verwertungsGeraet.count({ where: { ausgeschieden: false } }),
      prisma.verwertungsGeraet.count({ where: { ausgeschieden: false, verwertungFrei: true } }),
      prisma.verwertungsImport.findFirst({
        where: { status: "fertig" },
        orderBy: { importiertAm: "desc" },
        select: { importiertAm: true, dateiname: true, anzahlZeilen: true },
      }),
    ]);
    const modelle = await prisma.verwertungsGeraet.groupBy({
      by: ["modellKey"],
      where: { ausgeschieden: false, verwertungFrei: true },
      _count: { _all: true },
    });
    return {
      gesamt,
      freigegeben,
      modelle: modelle.length,
      letzterImport,
      // Wie alt sind die Daten? Der Export kommt von Hand — ohne sichtbares
      // Alter merkt niemand, wenn er zu lange her ist.
      frische: bewerteFrische(letzterImport?.importiertAm ?? null),
    };
  }),

  /** Import-Protokoll (auch laufende Läufe, für die Fortschrittsanzeige). */
  importe: pflegen
    .input(z.object({ limit: z.number().int().positive().max(50).default(10) }).optional())
    .query(({ input }) =>
      prisma.verwertungsImport.findMany({
        orderBy: { importiertAm: "desc" },
        take: input?.limit ?? 10,
      }),
    ),
});

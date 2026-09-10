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
      }),
    )
    .query(({ input }) =>
      sucheSpender({
        modellKey: input.modellKey,
        geraeteName: input.geraeteName,
        hersteller: input.hersteller,
        teiltyp: input.teiltyp,
        limit: input.limit,
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
  entnahmeMelden: suchen
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

  /** Eine von Hand gemeldete Entnahme zurücknehmen (Fehlklick). */
  entnahmeZuruecknehmen: suchen
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

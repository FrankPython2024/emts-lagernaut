/**
 * Auslager-Wizard Backend — Phase A
 *
 * Architektur-Notizen:
 * - 1 Anfrage = 1 Teil (kein AnfrageTeil-Table, each Anfrage.artikelId → Artikel)
 * - Gruppen: gemeinsames gruppenNr-Feld ODER techniker+logId als Fallback
 * - Lagerplatz: aus Artikel.lagerplatz (Phase 3e per Modell-Lagerplatz synchronisiert)
 * - Grading: aus letzter EINGANG-Buchung (notiz "Grading: A+")
 * - AUSGANG-Buchung direkt in Transaktion (nicht via bucheLager(), das hat eigene TX)
 * - Bestand: direkt in TX reduziert; syncBestandAusHistorie() bleibt für Storno/Korrektur
 *
 * Phase A: full delivery only (keine Teilmenge-Override)
 * Phase B: UI-Wizard
 * Phase C: Auslager-Beleg PDF
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, adminProcedure } from "@/server/trpc";
import { BuchungsTyp, AnfrageStatus } from "@prisma/client";
import type { SessionUser } from "@/core/types";

// ── Grading aus letzter EINGANG-Buchung extrahieren ───────────────────────────

function extractGrading(notiz: string | null | undefined): string | null {
  const m = notiz?.match(/Grading:\s*(A\+|A|B|C)/i);
  return m?.[1] ?? null;
}

// ── Router ────────────────────────────────────────────────────────────────────

export const auslagernRouter = createTRPCRouter({

  /**
   * Aktive Anfragen mit Live-Bestandsprüfung.
   * Gibt nur Gruppen zurück, die mindestens 1 verfügbares Teil haben.
   */
  listAnfragen: adminProcedure.query(async ({ ctx }) => {
    const anfragen = await ctx.prisma.anfrage.findMany({
      where: {
        status:    { in: [AnfrageStatus.NEU, AnfrageStatus.BEDARF, AnfrageStatus.IN_BEARBEITUNG] },
        artikelId: { not: null },
      },
      include: {
        artikel: {
          select: { id: true, bezeichnung: true, kategorie: true, bestand: true, lagerplatz: true },
        },
      },
      orderBy: { datum: "desc" },
    });

    // ── Gruppen aufbauen ─────────────────────────────────────────────────────
    const groupMap = new Map<string, typeof anfragen>();
    for (const a of anfragen) {
      const key = a.gruppenNr ?? `${a.techniker}__${a.logId}`;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(a);
    }

    const result = [];

    for (const [gruppenKey, anfragenInGruppe] of groupMap) {
      // ── Pro Anfrage: Grading + Verfügbarkeit ───────────────────────────────
      const teile = await Promise.all(
        anfragenInGruppe.map(async (a) => {
          if (!a.artikel || a.artikelId === null) return null;

          const letzteBuchung = await ctx.prisma.buchung.findFirst({
            where:   { artikelId: a.artikelId!, typ: BuchungsTyp.EINGANG },
            orderBy: { datum: "desc" },
            select:  { notiz: true },
          });

          return {
            teilId:         a.id,
            teiltyp:        a.artikel.kategorie,
            artikelName:    a.artikel.bezeichnung,
            menge:          a.menge,
            verfuegbar:     a.artikel.bestand >= a.menge,
            bestand:        a.artikel.bestand,
            lagerplatzCode: a.artikel.lagerplatz ?? null,
            grading:        extractGrading(letzteBuchung?.notiz),
            status:         a.status,
          };
        }),
      );

      const teileFiltered = teile.filter(Boolean) as NonNullable<typeof teile[0]>[];
      const anzahlVerfuegbar = teileFiltered.filter((t) => t.verfuegbar).length;

      if (anzahlVerfuegbar === 0) continue;

      const ersteAnfrage = anfragenInGruppe[0]!;
      result.push({
        gruppenKey,
        gruppenNr:       ersteAnfrage.gruppenNr ?? null,
        techniker:       ersteAnfrage.techniker,
        logId:           ersteAnfrage.logId,
        geraet:          ersteAnfrage.geraet,
        geraeteName:     ersteAnfrage.geraeteName ?? null,
        erstelltAm:      ersteAnfrage.datum,
        teile:           teileFiltered,
        anzahlVerfuegbar,
        anzahlTotal:     teileFiltered.length,
      });
    }

    return result;
  }),

  /**
   * Bestand-Details für eine konkrete Gruppe von Anfragen (für AuslagerModal).
   * Gibt dieselben Felder wie listAnfragen.teile, aber nur für die übergebenen IDs.
   */
  gruppeDetails: adminProcedure
    .input(z.object({ anfrageIds: z.array(z.number().int().positive()).min(1).max(50) }))
    .query(async ({ ctx, input }) => {
      const anfragen = await ctx.prisma.anfrage.findMany({
        where: {
          id:        { in: input.anfrageIds },
          status:    { in: [AnfrageStatus.NEU, AnfrageStatus.BEDARF, AnfrageStatus.IN_BEARBEITUNG] },
          artikelId: { not: null },
        },
        include: {
          artikel: {
            select: { id: true, bezeichnung: true, kategorie: true, bestand: true, lagerplatz: true },
          },
        },
      });

      const teile = await Promise.all(
        anfragen.map(async (a) => {
          if (!a.artikel || !a.artikelId) return null;
          const letzteBuchung = await ctx.prisma.buchung.findFirst({
            where:   { artikelId: a.artikelId, typ: BuchungsTyp.EINGANG },
            orderBy: { datum: "desc" },
            select:  { notiz: true },
          });
          return {
            teilId:         a.id,
            teiltyp:        a.artikel.kategorie,
            artikelName:    a.artikel.bezeichnung,
            menge:          a.menge,
            verfuegbar:     a.artikel.bestand >= a.menge,
            bestand:        a.artikel.bestand,
            lagerplatzCode: a.artikel.lagerplatz ?? null,
            grading:        extractGrading(letzteBuchung?.notiz),
            status:         a.status as string,
          };
        })
      );

      return teile.filter((t): t is NonNullable<typeof teile[0]> => t !== null);
    }),

  /**
   * Teile auslagern — transaktional.
   * Erstellt AUSGANG-Buchung pro Anfrage-ID, reduziert Bestand, setzt Status.
   *
   * Phase A: full delivery (Anfrage.menge wird vollständig ausgegeben).
   * Partial delivery → Phase B.
   */
  teile: adminProcedure
    .input(z.object({
      anfrageIds: z.array(z.number().int().positive()).min(1).max(50),
      notiz:      z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session!.user as SessionUser;

      return ctx.prisma.$transaction(async (tx) => {
        const ausgabe: {
          anfrageId:    number;
          artikel:      string;
          kategorie:    string;
          lagerplatz:   string | null;
          menge:        number;
          neuerBestand: number;
          techniker:    string;
          logId:        string;
          geraeteName:  string | null;
          grading:      string | null;
        }[] = [];

        for (const anfrageId of input.anfrageIds) {
          const anfrage = await tx.anfrage.findUnique({
            where:   { id: anfrageId },
            include: { artikel: true },
          });

          if (!anfrage) {
            throw new TRPCError({ code: "NOT_FOUND", message: `Anfrage #${anfrageId} nicht gefunden` });
          }
          if (!anfrage.artikelId || !anfrage.artikel) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `Anfrage #${anfrageId} hat keinen verknüpften Artikel` });
          }
          if (
            anfrage.status === AnfrageStatus.ABGESCHLOSSEN ||
            anfrage.status === AnfrageStatus.STORNIERT
          ) {
            throw new TRPCError({
              code:    "BAD_REQUEST",
              message: `Anfrage #${anfrageId} ist bereits ${anfrage.status}`,
            });
          }

          // ── Bestand-Prüfung (innerhalb TX — InnoDB Row-Lock schützt) ──────
          const aktuellerBestand = anfrage.artikel.bestand;
          if (aktuellerBestand < anfrage.menge) {
            throw new TRPCError({
              code:    "CONFLICT",
              message: `Nicht genug Bestand für „${anfrage.artikel.bezeichnung}": vorhanden ${aktuellerBestand}, benötigt ${anfrage.menge}`,
            });
          }

          // ── AUSGANG-Buchung anlegen ────────────────────────────────────────
          const notizTeile = [
            `Anfrage #${anfrageId}`,
            anfrage.gruppenNr ? `Gruppe: ${anfrage.gruppenNr}` : null,
            input.notiz,
          ].filter(Boolean).join(" | ");

          await tx.buchung.create({
            data: {
              artikelId:   anfrage.artikelId,
              bezeichnung: anfrage.artikel.bezeichnung,
              typ:         BuchungsTyp.AUSGANG,
              menge:       anfrage.menge,
              mitarbeiter: user.kuerzel,
              notiz:       notizTeile,
            },
          });

          // ── Bestand reduzieren ────────────────────────────────────────────
          const neuerBestand = aktuellerBestand - anfrage.menge;
          await tx.artikel.update({
            where: { id: anfrage.artikelId },
            data:  { bestand: neuerBestand },
          });

          // ── Anfrage → ABGESCHLOSSEN ───────────────────────────────────────
          await tx.anfrage.update({
            where: { id: anfrageId },
            data:  {
              status:         AnfrageStatus.ABGESCHLOSSEN,
              bearbeitetVon:  user.kuerzel,
              bearbeitetSeit: new Date(),
            },
          });

          // ── Grading aus letzter EINGANG-Buchung (für Etikett) ─────────────
          const letzteBuchung = await tx.buchung.findFirst({
            where:   { artikelId: anfrage.artikelId, typ: BuchungsTyp.EINGANG },
            orderBy: { datum: "desc" },
            select:  { notiz: true },
          });

          ausgabe.push({
            anfrageId,
            artikel:      anfrage.artikel.bezeichnung,
            kategorie:    anfrage.artikel.kategorie,
            lagerplatz:   anfrage.artikel.lagerplatz ?? null,
            menge:        anfrage.menge,
            neuerBestand,
            techniker:    anfrage.techniker,
            logId:        anfrage.logId,
            geraeteName:  anfrage.geraeteName ?? null,
            grading:      extractGrading(letzteBuchung?.notiz),
          });
        }

        return {
          ausgabe,
          ausgefuehrtVon: user.kuerzel,
          datum:          new Date(),
        };
      });
    }),

});

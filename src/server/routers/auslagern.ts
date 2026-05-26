/**
 * Auslager-Wizard Backend
 *
 * HEILIGE REGEL: DIREKT-Buchungen dürfen NIEMALS den Bestand verändern.
 *   - AUSGANG → Bestand prüfen, Bestand –menge, AUSGANG-Buchung
 *   - DIREKT  → NUR Buchung anlegen, Bestand bleibt unberührt
 *
 * assertKeinBestandEffekt() schützt alle Bestand-Update-Pfade als Sicherheitsgurt.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, adminProcedure } from "@/server/trpc";
import { BuchungsTyp, AnfrageStatus } from "@prisma/client";
import type { SessionUser } from "@/core/types";
import { meilisearchSync } from "@/core/infra/meilisearchSync";
import { assertKeinBestandEffekt } from "@/lib/buchungen/typeGuards";
import { getZugaenglicheStandortIds } from "@/lib/auth/standortFilter";

// ── Grading aus letzter EINGANG-Buchung extrahieren ───────────────────────────

function extractGrading(notiz: string | null | undefined): string | null {
  const m = notiz?.match(/Grading:\s*(A\+|A|B|C)/i);
  return m?.[1] ?? null;
}

// ── Router ────────────────────────────────────────────────────────────────────

export const auslagernRouter = createTRPCRouter({

  /**
   * Aktive Anfragen — ALLE Gruppen (NEU, BEDARF, IN_BEARBEITUNG).
   * Pro Teil: lagerStatus = 'verfuegbar' | 'bedarf' für Frontend-Entscheidung.
   * BEDARF-Gruppen (kein Lager-Bestand) erscheinen jetzt auch, da DIREKT-Buchung möglich.
   */
  listAnfragen: adminProcedure.query(async ({ ctx }) => {
    const standortIds    = getZugaenglicheStandortIds(ctx);
    const artikelFilter  = standortIds
      ? { artikel: { standortId: standortIds.length === 1 ? standortIds[0]! : { in: standortIds } } }
      : {};
    const anfragen = await ctx.prisma.anfrage.findMany({
      where: {
        ...artikelFilter,
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
      const teile = await Promise.all(
        anfragenInGruppe.map(async (a) => {
          if (!a.artikel || a.artikelId === null) return null;

          const letzteBuchung = await ctx.prisma.buchung.findFirst({
            where:   { artikelId: a.artikelId!, typ: BuchungsTyp.EINGANG },
            orderBy: { datum: "desc" },
            select:  { notiz: true },
          });

          const verfuegbar  = a.artikel.bestand >= a.menge;
          const lagerStatus = verfuegbar ? "verfuegbar" : "bedarf";

          return {
            teilId:         a.id,
            teiltyp:        a.artikel.kategorie,
            artikelName:    a.artikel.bezeichnung,
            menge:          a.menge,
            verfuegbar,
            lagerStatus,                            // 'verfuegbar' | 'bedarf'
            bestand:        a.artikel.bestand,
            lagerplatzCode: a.artikel.lagerplatz ?? null,
            grading:        extractGrading(letzteBuchung?.notiz),
            status:         a.status,
          };
        }),
      );

      const teileFiltered    = teile.filter(Boolean) as NonNullable<typeof teile[0]>[];
      const anzahlVerfuegbar = teileFiltered.filter((t) => t.verfuegbar).length;
      const anzahlBedarf     = teileFiltered.filter((t) => !t.verfuegbar).length;

      // Alle Gruppen mit mindestens 1 aktiven Teil anzeigen (auch reine BEDARF-Gruppen).
      // Früher: if (anzahlVerfuegbar === 0) continue;
      if (teileFiltered.length === 0) continue;

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
        anzahlBedarf,
        anzahlTotal:     teileFiltered.length,
      });
    }

    return result;
  }),

  /**
   * Bestand-Details für AuslagerModal — inkl. lagerStatus pro Teil.
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
          const verfuegbar  = a.artikel.bestand >= a.menge;
          const lagerStatus = verfuegbar ? "verfuegbar" : "bedarf";
          return {
            teilId:         a.id,
            teiltyp:        a.artikel.kategorie,
            artikelName:    a.artikel.bezeichnung,
            menge:          a.menge,
            verfuegbar,
            lagerStatus,
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
   *
   * Buchungs-Typ pro Anfrage via `anfrageTypen` (optional, default AUSGANG):
   *   anfrageTypen: { "42": "DIREKT", "43": "AUSGANG" }
   *
   * AUSGANG: Bestand prüfen → Bestand –menge → AUSGANG-Buchung → ABGESCHLOSSEN
   * DIREKT:  Kein Bestand-Update (HEILIGE REGEL) → DIREKT-Buchung → ABGESCHLOSSEN
   *
   * Backward-Compatible: altes { anfrageIds } ohne anfrageTypen → alle AUSGANG.
   */
  teile: adminProcedure
    .input(z.object({
      anfrageIds:   z.array(z.number().int().positive()).min(1).max(50),
      // Key = anfrageId als String, Value = Buchungs-Typ. Default: AUSGANG.
      anfrageTypen: z.record(z.string(), z.enum(["AUSGANG", "DIREKT"])).optional(),
      notiz:        z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session!.user as SessionUser;

      const txResult = await ctx.prisma.$transaction(async (tx) => {
        const ausgabe: {
          anfrageId:    number;
          artikelId:    number;
          buchungId:    number;
          buchungsTyp:  "AUSGANG" | "DIREKT";
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
          // Buchungs-Typ: aus anfrageTypen oder Default AUSGANG
          const buchungsTyp = (
            input.anfrageTypen?.[String(anfrageId)] ?? "AUSGANG"
          ) as BuchungsTyp;

          // ── Anfrage laden (InnoDB Row-Lock innerhalb TX) ──────────────────
          const anfrage = await tx.anfrage.findUnique({
            where:   { id: anfrageId },
            include: { artikel: true },
          });

          if (!anfrage) {
            throw new TRPCError({ code: "NOT_FOUND",   message: `Anfrage #${anfrageId} nicht gefunden` });
          }
          if (!anfrage.artikelId || !anfrage.artikel) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `Anfrage #${anfrageId} hat keinen Artikel` });
          }
          if (anfrage.status === AnfrageStatus.ABGESCHLOSSEN || anfrage.status === AnfrageStatus.STORNIERT) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `Anfrage #${anfrageId} ist bereits ${anfrage.status}` });
          }

          const aktuellerBestand = anfrage.artikel.bestand;
          let   neuerBestand     = aktuellerBestand;

          const notizTeile = [
            `Anfrage #${anfrageId}`,
            anfrage.gruppenNr        ? `Gruppe: ${anfrage.gruppenNr}` : null,
            buchungsTyp === "DIREKT" ? "DIREKT" : null,
            input.notiz,
          ].filter(Boolean).join(" | ");

          if (buchungsTyp === BuchungsTyp.AUSGANG) {
            // ── AUSGANG: Bestand prüfen + reduzieren ──────────────────────
            if (aktuellerBestand < anfrage.menge) {
              throw new TRPCError({
                code:    "CONFLICT",
                message: `Nicht genug Bestand für „${anfrage.artikel.bezeichnung}": vorhanden ${aktuellerBestand}, benötigt ${anfrage.menge}`,
              });
            }

            neuerBestand = aktuellerBestand - anfrage.menge;

            // Sicherheitsgurt: schützt diesen Bestand-Update-Pfad.
            // Wirft wenn buchungsTyp fälschlicherweise DIREKT wäre (defensive programming).
            assertKeinBestandEffekt(buchungsTyp, "auslagern.teile AUSGANG-Zweig");

            await tx.artikel.update({
              where: { id: anfrage.artikelId },
              data:  { bestand: neuerBestand },
            });
          }
          // DIREKT: absichtlich kein Artikel-Update.
          // assertKeinBestandEffekt(DIREKT) würde hier feuern — das IST die Sicherung.

          // ── Buchung anlegen (AUSGANG oder DIREKT) ─────────────────────────
          const buchung = await tx.buchung.create({
            data: {
              artikelId:   anfrage.artikelId,
              bezeichnung: anfrage.artikel.bezeichnung,
              typ:         buchungsTyp,
              menge:       anfrage.menge,
              mitarbeiter: user.kuerzel,
              notiz:       notizTeile,
            },
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

          // ── Grading aus letzter EINGANG-Buchung (für Beleg) ───────────────
          const letzteBuchung = await tx.buchung.findFirst({
            where:   { artikelId: anfrage.artikelId, typ: BuchungsTyp.EINGANG },
            orderBy: { datum: "desc" },
            select:  { notiz: true },
          });

          ausgabe.push({
            anfrageId,
            artikelId:   anfrage.artikelId,
            buchungId:   buchung.id,
            buchungsTyp: buchungsTyp as "AUSGANG" | "DIREKT",
            artikel:     anfrage.artikel.bezeichnung,
            kategorie:   anfrage.artikel.kategorie,
            lagerplatz:  anfrage.artikel.lagerplatz ?? null,
            menge:       anfrage.menge,
            neuerBestand,
            techniker:   anfrage.techniker,
            logId:       anfrage.logId,
            geraeteName: anfrage.geraeteName ?? null,
            grading:     extractGrading(letzteBuchung?.notiz),
          });
        }

        return { ausgabe, ausgefuehrtVon: user.kuerzel, datum: new Date() };
      });

      // Meilisearch sync — fire-and-forget nach TX-Commit
      for (const item of txResult.ausgabe) {
        meilisearchSync.anfrage(item.anfrageId);
        meilisearchSync.artikel(item.artikelId);
        meilisearchSync.buchung(item.buchungId);
      }

      return txResult;
    }),

});

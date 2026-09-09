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
import { poolBestaendeFuer } from "@/lib/artikel/pool";
import { emitToBackoffice, emitToUser, emitToAll } from "@/modules/realtime/socket";
import { EVENTS } from "@/modules/realtime/events";

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
    const standortIds          = getZugaenglicheStandortIds(ctx);
    const standortArtikelWhere = standortIds
      ? { standortId: standortIds.length === 1 ? standortIds[0]! : { in: standortIds } }
      : undefined;
    const anfragen = await ctx.prisma.anfrage.findMany({
      where: {
        status: { in: [AnfrageStatus.NEU, AnfrageStatus.BEDARF, AnfrageStatus.IN_BEARBEITUNG] },
        // Standard-Artikel (standort-gefiltert) ODER Sonderanfragen (kein Artikel,
        // werden als DIREKT-Buchung ausgelagert). NICHT_VERFUEGBAR fällt über den
        // Status-Filter raus.
        OR: [
          { artikelId: { not: null }, ...(standortArtikelWhere ? { artikel: standortArtikelWhere } : {}) },
          { istSonderAnfrage: true },
        ],
      },
      include: {
        artikel: {
          select: { id: true, bezeichnung: true, kategorie: true, bestand: true, lagerplatz: true },
        },
      },
      orderBy: { datum: "desc" },
    });

    // ── Pool-Bestände einmalig für alle beteiligten Artikel ─────────────────
    // Baugleiche Teile (Füße vorne ↔ hinten) teilen sich einen Bestand. Ohne das
    // stünde ein Teil als „Bedarf" da und ließe sich nicht auslagern, obwohl es
    // unter dem Partnernamen im Regal liegt. Gesammelt statt pro Zeile (N+1).
    const poolBestaende = await poolBestaendeFuer(
      Array.from(new Set(anfragen.map((a) => a.artikelId).filter((id): id is number => id !== null))),
    );

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
          // Sonderanfrage (Freitext, kein Standard-Artikel) → DIREKT-Übergabe
          if (a.istSonderAnfrage || a.artikelId === null) {
            return {
              teilId:          a.id,
              teiltyp:         a.sonderKategorie ?? "Sonderanfrage",
              artikelName:     a.beschreibung ?? a.teil,
              menge:           a.menge,
              verfuegbar:      false,
              lagerStatus:     "bedarf" as const,
              bestand:         0,
              lagerplatzCode:  null,
              grading:         null,
              status:          a.status,
              istSonderanfrage: true,
            };
          }
          if (!a.artikel) return null;

          const letzteBuchung = await ctx.prisma.buchung.findFirst({
            where:   { artikelId: a.artikelId, typ: BuchungsTyp.EINGANG },
            orderBy: { datum: "desc" },
            select:  { notiz: true },
          });

          // Verfügbar = eigener Bestand ODER der des baugleichen Pool-Partners.
          // Ohne Verknüpfung entspricht der Pool-Wert dem eigenen Bestand.
          const verfuegbareMenge = poolBestaende.get(a.artikel.id) ?? a.artikel.bestand;
          const verfuegbar  = verfuegbareMenge >= a.menge;
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
            istSonderanfrage: false,
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
          id:     { in: input.anfrageIds },
          status: { in: [AnfrageStatus.NEU, AnfrageStatus.BEDARF, AnfrageStatus.IN_BEARBEITUNG] },
        },
        include: {
          artikel: {
            select: { id: true, bezeichnung: true, kategorie: true, bestand: true, lagerplatz: true },
          },
        },
      });

      // Pool-Bestände gesammelt — wie in listAnfragen, damit die Detailansicht
      // dieselbe Verfügbarkeit zeigt und nicht widersprüchlich wirkt.
      const poolBestaende = await poolBestaendeFuer(
        Array.from(new Set(anfragen.map((a) => a.artikelId).filter((id): id is number => id !== null))),
      );

      const teile = await Promise.all(
        anfragen.map(async (a) => {
          // Sonderanfrage → DIREKT-Übergabe (kein Lager-Bestand)
          if (a.istSonderAnfrage || a.artikelId === null) {
            return {
              teilId:          a.id,
              teiltyp:         a.sonderKategorie ?? "Sonderanfrage",
              artikelName:     a.beschreibung ?? a.teil,
              menge:           a.menge,
              verfuegbar:      false,
              lagerStatus:     "bedarf" as const,
              bestand:         0,
              lagerplatzCode:  null,
              grading:         null,
              status:          a.status as string,
              istSonderanfrage: true,
            };
          }
          if (!a.artikel) return null;
          const letzteBuchung = await ctx.prisma.buchung.findFirst({
            where:   { artikelId: a.artikelId, typ: BuchungsTyp.EINGANG },
            orderBy: { datum: "desc" },
            select:  { notiz: true },
          });
          const verfuegbareMenge = poolBestaende.get(a.artikel.id) ?? a.artikel.bestand;
          const verfuegbar  = verfuegbareMenge >= a.menge;
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
            istSonderanfrage: false,
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
          artikelId:    number | null;
          /**
           * Der Artikel, aus dem TATSÄCHLICH entnommen wurde.
           *
           * ⚠️ Bei einer Pool-Entnahme ist das der Partner, nicht `artikelId`.
           * `neuerBestand` gehört zu DIESEM Artikel. Vorher liefen Suchindex und
           * das BESTAND_UPDATED-Ereignis auf `artikelId` — also auf den Artikel,
           * der sich gar nicht geändert hatte, während der Partner mit veraltetem
           * Wert stehen blieb. Auf dem Beleg bleibt `artikelId` richtig: Dort
           * steht, was der Techniker angefragt hat.
           */
          quelleArtikelId: number | null;
          buchungId:    number | null;
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
          istSonderanfrage: boolean;
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

          // ── Anfrage ATOMAR beanspruchen ───────────────────────────────────
          //
          // ⚠️ Das `findUnique` oben nimmt KEINEN Row-Lock — ein einfaches SELECT
          // ist unter InnoDB ein nicht-sperrender Lesevorgang. Zwei parallele
          // Auslagerungen derselben Anfrage (zwei Admins, zweiter Tab, oder der
          // eigenständige Assistent neben der Anfragen-Seite) lasen deshalb
          // beide „NEU", buchten beide und zogen den Bestand ZWEIMAL ab. Das
          // bedingte Dekrement weiter unten schützt nur vor negativem Bestand,
          // nicht vor der Doppelausgabe.
          //
          // Das `updateMany` mit Status-Bedingung ist die Sperre: Es trifft nur,
          // solange die Anfrage noch offen ist. Der zweite Aufruf bekommt
          // count === 0 und bricht ab — bevor irgendetwas gebucht wurde.
          //
          // ⚠️ `bearbeitetVon` wird hier bewusst GELEERT, nicht gesetzt. Vorher
          // stand danach der Ausgebende drin; die Gruppe sah für alle anderen
          // dauerhaft „gesperrt von X" aus, und „Freigeben" half nicht, weil
          // `gruppeFreigeben` nur Zeilen im Status IN_BEARBEITUNG anfasst.
          // Eine erledigte Anfrage hat keinen Bearbeiter mehr.
          const beansprucht = await tx.anfrage.updateMany({
            where: {
              id:     anfrageId,
              status: { in: [AnfrageStatus.NEU, AnfrageStatus.BEDARF, AnfrageStatus.IN_BEARBEITUNG] },
            },
            data: {
              status:         AnfrageStatus.ABGESCHLOSSEN,
              bearbeitetVon:  null,
              bearbeitetSeit: null,
            },
          });
          if (beansprucht.count === 0) {
            throw new TRPCError({
              code:    "CONFLICT",
              message: `Anfrage #${anfrageId} ist bereits ${anfrage.status} — sie wurde inzwischen von jemand anderem erledigt.`,
            });
          }

          // ── TEST-MODUS: Sicherheitsgurt (analog DIREKT/Sonderanfrage) ────────
          //    Test-Anfragen dürfen NIEMALS echten Bestand verändern oder eine
          //    Buchung schreiben. Nur Status → ABGESCHLOSSEN, kein Artikel-Update,
          //    keine Buchung. So lässt sich der Auslager-Workflow live durchspielen
          //    ohne den echten Lagerbestand zu verfälschen.
          if (anfrage.testModus) {
            // Status steht schon: oben atomar beansprucht (ABGESCHLOSSEN,
            // Bearbeiter geleert). Hier nichts mehr setzen — ein erneutes
            // `bearbeitetVon` ließe die Gruppe für alle anderen gesperrt aussehen.
            ausgabe.push({
              anfrageId,
              artikelId:    anfrage.artikelId,
              quelleArtikelId: null,   // Test bucht nichts
              buchungId:    null,                       // KEINE Buchung (Test)
              buchungsTyp:  "DIREKT",
              artikel:      anfrage.artikel?.bezeichnung ?? anfrage.beschreibung ?? anfrage.teil,
              kategorie:    anfrage.artikel?.kategorie ?? anfrage.sonderKategorie ?? "Test",
              lagerplatz:   anfrage.artikel?.lagerplatz ?? null,
              menge:        anfrage.menge,
              neuerBestand: anfrage.artikel?.bestand ?? 0,  // unverändert
              techniker:    anfrage.techniker,
              logId:        anfrage.logId,
              geraeteName:  anfrage.geraeteName ?? null,
              grading:      null,
              istSonderanfrage: anfrage.istSonderAnfrage,
            });
            continue;
          }

          // ── Ohne Artikel: DIREKT-Übergabe ohne Bestand-Effekt ──────────────
          //
          // Zwei Fälle landen hier, und sie werden gleich behandelt:
          //   • echte Sonderanfrage (`istSonderAnfrage`) — hatte nie einen Artikel
          //   • BEDARF-Anfrage, zu deren Teiltyp es (noch) keinen Artikel gibt
          //
          // Keine Buchung, kein Bestand-Effekt — die DIREKT-Regel ist hier per
          // Konstruktion erfüllt, es gibt schlicht nichts abzubuchen.
          //
          // ⚠️ Hier stand bis 09.09.2026 ein `throw` für den zweiten Fall
          // („Anfrage #N hat keinen Artikel"). Das war eine Sackgasse: Die
          // Leseseite `gruppeDetails` meldet für `artikelId === null` bereits
          // `istSonderanfrage: true`, das Fenster versprach also „wird als
          // DIREKT-Buchung verarbeitet" — und der Klick darauf scheiterte jedes
          // Mal. Eine BEDARF-Anfrage ohne Artikel ist der Normalfall (Teiltyp
          // ohne passenden Artikel, z. B. Thermalmodul an einem Modell, für das
          // noch keiner angelegt wurde) und war damit gar nicht abschließbar.
          // `anfragen.setStatus` behandelt denselben Fall längst als „ohne Teil
          // erledigt".
          if (anfrage.istSonderAnfrage || !anfrage.artikelId || !anfrage.artikel) {
            // Status steht schon: oben atomar beansprucht (ABGESCHLOSSEN,
            // Bearbeiter geleert). Hier nichts mehr setzen — ein erneutes
            // `bearbeitetVon` ließe die Gruppe für alle anderen gesperrt aussehen.
            ausgabe.push({
              anfrageId,
              artikelId:    null,
              buchungId:    null,
              quelleArtikelId: null,   // ohne Artikel gibt es keine Quelle
              buchungsTyp:  "DIREKT",
              artikel:      anfrage.beschreibung ?? anfrage.teil,
              // Ehrlich beschriften: Nur eine echte Sonderanfrage heißt so. Eine
              // BEDARF-Anfrage ohne Artikel behält ihren Teiltyp als Kategorie,
              // sonst stünde „Sonderanfrage" auf dem Beleg für ein Thermalmodul.
              kategorie:    anfrage.istSonderAnfrage
                ? (anfrage.sonderKategorie ?? "Sonderanfrage")
                : anfrage.teil,
              lagerplatz:   null,
              menge:        anfrage.menge,
              neuerBestand: 0,
              techniker:    anfrage.techniker,
              logId:        anfrage.logId,
              geraeteName:  anfrage.geraeteName ?? null,
              grading:      null,
              istSonderanfrage: anfrage.istSonderAnfrage,
            });
            continue;
          }

          // ── Ersatzteil-Pool auflösen ─────────────────────────────────────
          // Baugleiches Teil unter anderem Namen (Füße vorne ↔ hinten): reicht der
          // eigene Bestand nicht, wird vom Partner entnommen. Der Lookup läuft
          // bewusst über `tx` — außerhalb der Transaktion gelesen wäre der Wert
          // nicht mit dem folgenden Dekrement konsistent.
          let quelleId    = anfrage.artikelId;
          let quelleName  = anfrage.artikel.bezeichnung;
          let quelleStand = anfrage.artikel.bestand;

          if (anfrage.artikel.bestand < anfrage.menge && anfrage.artikel.poolPartnerId) {
            const partner = await tx.artikel.findUnique({
              where:  { id: anfrage.artikel.poolPartnerId },
              select: { id: true, bezeichnung: true, bestand: true },
            });
            if (partner && partner.bestand >= anfrage.menge) {
              quelleId = partner.id; quelleName = partner.bezeichnung; quelleStand = partner.bestand;
            }
          }

          const ausPool          = quelleId !== anfrage.artikelId;
          const aktuellerBestand = quelleStand;
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
                message: `Nicht genug Bestand für „${quelleName}": vorhanden ${aktuellerBestand}, benötigt ${anfrage.menge}`,
              });
            }

            neuerBestand = aktuellerBestand - anfrage.menge;

            // Sicherheitsgurt: schützt diesen Bestand-Update-Pfad.
            // Wirft wenn buchungsTyp fälschlicherweise DIREKT wäre (defensive programming).
            assertKeinBestandEffekt(buchungsTyp, "auslagern.teile AUSGANG-Zweig");

            // ATOMAR + bedingt statt absolutem Setzen: der findUnique oben nimmt KEINEN
            // Row-Lock, zwei parallele Auslagerungen desselben Artikels wuerden sonst
            // beide vom selben Ausgangsbestand rechnen (Lost Update → Bestand zu hoch).
            const dek = await tx.artikel.updateMany({
              where: { id: quelleId, bestand: { gte: anfrage.menge } },
              data:  { bestand: { decrement: anfrage.menge } },
            });
            if (dek.count === 0) {
              throw new TRPCError({
                code:    "CONFLICT",
                message: `Nicht genug Bestand für „${quelleName}" — inzwischen vergriffen. Bitte erneut prüfen.`,
              });
            }
          }
          // DIREKT: absichtlich kein Artikel-Update.
          // assertKeinBestandEffekt(DIREKT) würde hier feuern — das IST die Sicherung.

          // ── Buchung anlegen (AUSGANG oder DIREKT) ─────────────────────────
          // Die Buchung läuft auf den Artikel, aus dem tatsächlich entnommen wurde —
          // sonst stimmt dessen Bestandshistorie nicht mehr mit dem Lager überein.
          const buchung = await tx.buchung.create({
            data: {
              artikelId:   quelleId,
              bezeichnung: quelleName,
              typ:         buchungsTyp,
              menge:       anfrage.menge,
              mitarbeiter: user.kuerzel,
              // Verbindung zum Zielgerät: über die Anfrage hängt an dieser Buchung
              // die LogID des Geräts, in das der Techniker das Teil einbaut.
              // Auch bei DIREKT gesetzt — das Teil wird verbaut, nur der Bestand
              // bleibt unberührt.
              anfrageId,
              notiz:       ausPool
                ? `${notizTeile} | aus Pool-Partner für „${anfrage.artikel.bezeichnung}"`
                : notizTeile,
            },
          });

          // ── Anfrage → ABGESCHLOSSEN ───────────────────────────────────────
          // Status steht schon: oben atomar beansprucht (siehe dort). Ein
          // erneutes Setzen würde nur den geleerten Bearbeiter-Vermerk
          // wiederherstellen und die Gruppe gesperrt aussehen lassen.

          // ── Grading aus letzter EINGANG-Buchung (für Beleg) ───────────────
          // Vom Artikel, aus dem entnommen wurde — dessen Zustand ist der, den
          // der Techniker in die Hand bekommt.
          const letzteBuchung = await tx.buchung.findFirst({
            where:   { artikelId: quelleId, typ: BuchungsTyp.EINGANG },
            orderBy: { datum: "desc" },
            select:  { notiz: true },
          });

          ausgabe.push({
            anfrageId,
            artikelId:   anfrage.artikelId,
            buchungId:   buchung.id,
            quelleArtikelId: quelleId,  // bei Pool-Entnahme der Partner
            buchungsTyp: buchungsTyp as "AUSGANG" | "DIREKT",
            // Kam das Teil aus dem Pool-Partner, steht das auf dem Beleg — sonst
            // passt der ausgewiesene Restbestand nicht zum genannten Artikel.
            artikel:     ausPool
              ? `${anfrage.artikel.bezeichnung} (entnommen aus „${quelleName}")`
              : anfrage.artikel.bezeichnung,
            kategorie:   anfrage.artikel.kategorie,
            lagerplatz:  anfrage.artikel.lagerplatz ?? null,
            menge:       anfrage.menge,
            neuerBestand,
            techniker:   anfrage.techniker,
            logId:       anfrage.logId,
            geraeteName: anfrage.geraeteName ?? null,
            grading:     extractGrading(letzteBuchung?.notiz),
            istSonderanfrage: false,
          });
        }

        return { ausgabe, ausgefuehrtVon: user.kuerzel, datum: new Date() };
      });

      // Meilisearch sync — fire-and-forget nach TX-Commit
      for (const item of txResult.ausgabe) {
        meilisearchSync.anfrage(item.anfrageId);
        // Sonderanfragen haben keinen Artikel/keine Buchung → nichts zu syncen
        // ⚠️ Den Artikel abgleichen, aus dem WIRKLICH entnommen wurde. Bei einer
        // Pool-Entnahme ist das der Partner; `artikelId` hat sich gar nicht
        // geändert und stünde danach mit veraltetem Bestand im Index.
        if (item.quelleArtikelId !== null) meilisearchSync.artikel(item.quelleArtikelId);
        if (item.buchungId !== null) meilisearchSync.buchung(item.buchungId);
      }

      // Realtime: stats-relevante Events emitten, damit Backoffice (ADMIN +
      // BETRACHTER) Statistik/Dashboard live aktualisiert. Anfragen/Buchungen
      // werden hier per Prisma direkt geschrieben (nicht über setzeStatus()/
      // bucheLager()), daher müssen die Events hier emittet werden.
      for (const item of txResult.ausgabe) {
        emitToBackoffice(EVENTS.ANFRAGE_UPDATED, {
          id:     item.anfrageId,
          status: AnfrageStatus.ABGESCHLOSSEN,
        });
        // Techniker live informieren (eigene Anfrage abgeschlossen)
        emitToUser(item.techniker, EVENTS.ANFRAGE_UPDATED, {
          id:     item.anfrageId,
          status: AnfrageStatus.ABGESCHLOSSEN,
        });
        // Buchungs-Event nur wenn es eine Buchung gab (Sonderanfragen + Test → keine)
        if (item.buchungId !== null) {
          emitToBackoffice(EVENTS.BUCHUNG_ERSTELLT, {
            artikelId:    item.artikelId,
            bezeichnung:  item.artikel,
            typ:          item.buchungsTyp,
            menge:        item.menge,
            neuerBestand: item.neuerBestand,
          });
          // BESTAND_UPDATED nur bei AUSGANG — DIREKT lässt Bestand unverändert (heilige Regel)
          //
          // ⚠️ `neuerBestand` gehört zum QUELL-Artikel. Vorher ging der Wert
          // unter `artikelId` hinaus: Bei einer Pool-Entnahme bekam damit jeder
          // Client den Partner-Bestand unter der falschen Artikel-Nummer
          // angezeigt — und der Partner blieb auf seinem alten Wert stehen.
          if (item.buchungsTyp === "AUSGANG" && item.quelleArtikelId !== null) {
            emitToAll(EVENTS.BESTAND_UPDATED, {
              artikelId: item.quelleArtikelId,
              bestand:   item.neuerBestand,
            });
          }
        }
      }

      return txResult;
    }),

});

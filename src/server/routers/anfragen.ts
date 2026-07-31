import { z } from "zod";
import { AnfrageStatus, BuchungsTyp } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure, adminProcedure, permissionProcedure } from "@/server/trpc";

// Reads: alle Anfragen lesen (Listen, Gruppen). BETRACHTER bekommt das via ANFRAGE_VIEW_ALL.
const anfragenReadProcedure = permissionProcedure("ANFRAGE_VIEW_ALL");
import { standortWhere, getZugaenglicheStandortIds } from "@/lib/auth/standortFilter";
import {
  erstelleAnfrage,
  storniereAnfrage,
  setzeStatus,
  schliesseAnfrageAb,
  getAnfragenByTechniker,
  getAnfragenAdmin,
  getAnfragenGruppiert,
  gruppeInBearbeitungNehmen,
  gruppeFreigeben,
  gruppeZurueckgeben,
  zaehleNeueAnfragen,
  markiereNichtVerfuegbar,
} from "@/modules/anfragen/service";
import { bucheLager, syncBestandAusHistorie } from "@/modules/buchungen/service";
import { waehleQuelle } from "@/lib/artikel/pool";
import { naechsteBelegNr } from "@/core/infra/belegnr";
import { emitToAdmins, emitToUser, emitToAll, emitToBackoffice } from "@/modules/realtime/socket";
import { EVENTS } from "@/modules/realtime/events";
import type { SessionUser } from "@/core/types";

export const anfragenRouter = createTRPCRouter({

  // Neue Anfrage erstellen — Techniker-Portal
  create: protectedProcedure
    .input(z.object({
      techniker:   z.string().min(1).max(50),
      logId:       z.string().min(1).max(100),
      geraeteName: z.string().max(255).optional(),
      geraet:      z.string().min(1).max(255),
      artikelId:   z.number().int().positive().nullable(),
      teil:        z.string().min(1).max(255),
      grading:     z.string().max(10).optional(),
      kommentar:   z.string().max(1000).optional(),
      gruppenNr:   z.string().max(50).optional(),
      korbId:      z.number().int().positive().optional(),
      testModus:   z.boolean().default(false),
    }))
    .mutation(({ input, ctx }) => {
      const rolle = (ctx.session.user as SessionUser).rolle;
      // testModus = true  → nur ADMIN / ADMIN_READONLY (Test-Daten).
      // testModus = false → echte Anfrage, nur TECHNIKER / ADMIN.
      if (input.testModus) {
        if (rolle !== "ADMIN" && rolle !== "ADMIN_READONLY") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Test-Modus ist nur für Admins verfügbar." });
        }
      } else if (rolle !== "TECHNIKER" && rolle !== "ADMIN") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Keine Berechtigung, echte Anfragen zu erstellen." });
      }
      return erstelleAnfrage(input);
    }),

  // Anzahl NEU-Anfragen — Sidebar-Badge (standort-gefiltert, ANFRAGE_VIEW_ALL)
  zaehleNeue: anfragenReadProcedure
    .query(({ ctx }) => zaehleNeueAnfragen(getZugaenglicheStandortIds(ctx))),

  // ── Sonderanfragen bewerten (Admin-Review) ──────────────────────────────────
  // Sonderanfragen haben keinen Lagerartikel → keine Kategorie/keinen Preis. Für die
  // Auswertung „Wert ausgegeben" gilt sonst die Pauschale (5 €). Hier kann ein Admin
  // je Sonderanfrage einen genauen Wert (`sonderWert`) setzen. null = zurück zur Pauschale.
  sonderListe: anfragenReadProcedure
    .input(z.object({ nurUnbewertet: z.boolean().default(false) }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.anfrage.findMany({
        where: {
          istSonderAnfrage: true,
          testModus:        false,
          // Tote Zustände (storniert / nicht beschaffbar) liefern keinen Wert → ausblenden.
          status:           { notIn: [AnfrageStatus.STORNIERT, AnfrageStatus.NICHT_VERFUEGBAR] },
          ...(input?.nurUnbewertet ? { sonderWert: null } : {}),
        },
        orderBy: { datum: "desc" },
        select: {
          id: true, datum: true, techniker: true, geraet: true, logId: true,
          beschreibung: true, sonderKategorie: true, status: true, menge: true, sonderWert: true,
        },
      });
      return rows.map((r) => ({
        ...r,
        sonderWert: r.sonderWert == null ? null : Number(r.sonderWert),
      }));
    }),

  // Wert einer Sonderanfrage setzen/löschen (null → Pauschale). Nur Admin.
  setSonderWert: adminProcedure
    .input(z.object({
      id:   z.number().int().positive(),
      wert: z.number().min(0).max(1_000_000).nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const anfrage = await ctx.prisma.anfrage.findUnique({
        where: { id: input.id }, select: { id: true, istSonderAnfrage: true },
      });
      if (!anfrage) throw new TRPCError({ code: "NOT_FOUND", message: "Anfrage nicht gefunden." });
      if (!anfrage.istSonderAnfrage) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Nur Sonderanfragen können bewertet werden." });
      }
      await ctx.prisma.anfrage.update({ where: { id: input.id }, data: { sonderWert: input.wert } });
      return { ok: true };
    }),

  // Anfrage als "Ersatzteil nicht beschaffbar" markieren — nur Admin
  markiereNichtVerfuegbar: adminProcedure
    .input(z.object({ anfrageId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const user   = ctx.session.user as SessionUser;
      const result = await markiereNichtVerfuegbar(input.anfrageId, user.kuerzel);

      // Status-Event trägt logId + geraeteName für die Techniker-Notification.
      const updatePayload = {
        id:          result.anfrage.id,
        status:      AnfrageStatus.NICHT_VERFUEGBAR,
        techniker:   result.anfrage.techniker,
        logId:       result.anfrage.logId,
        geraeteName: result.anfrage.geraeteName,
      };
      emitToBackoffice(EVENTS.ANFRAGE_UPDATED, updatePayload);
      emitToUser(result.anfrage.techniker, EVENTS.ANFRAGE_UPDATED, updatePayload);

      // Auto-Chat-Nachricht: isAutoMessage=true. Dadurch zählt der Tab-Counter
      // sie NICHT separat (der Status-Wechsel oben tickt bereits) und die
      // Techniker-Notification überspringt sie → genau EIN Ping bei NICHT_VERFUEGBAR.
      emitToUser(result.anfrage.techniker, EVENTS.CHAT_NEU, {
        anfrageId:     result.anfrage.id,
        logId:         result.anfrage.logId,
        geraeteName:   result.anfrage.geraeteName,
        autor:         user.kuerzel,
        message:       result.chatNachricht.inhalt,
        isAutoMessage: true,
      });

      return result;
    }),

  // Alle Anfragen — read mit Filter (ANFRAGE_VIEW_ALL)
  getAll: anfragenReadProcedure
    .input(z.object({
      status:     z.nativeEnum(AnfrageStatus).optional(),
      techniker:  z.string().optional(),
      von:        z.date().optional(),
      bis:        z.date().optional(),
      limit:      z.number().int().min(1).max(100).default(50),
      offset:     z.number().int().min(0).default(0),
      standortId: z.number().int().positive().nullish(),
    }).optional())
    .query(({ input, ctx }) => {
      const sF = standortWhere(ctx, input?.standortId);
      const sId = sF.standortId as number | undefined ?? null;
      return getAnfragenAdmin({ limit: 50, offset: 0, ...input, standortId: sId });
    }),

  // Anfragen eines Technikers
  getByTechniker: protectedProcedure
    .input(z.object({
      kuerzel: z.string().min(1).max(50),
      showAll: z.boolean().default(false),
      limit:   z.number().int().min(1).max(1000).default(50),
      offset:  z.number().int().min(0).default(0),
    }))
    .query(({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      if (user.rolle !== "ADMIN" && user.kuerzel.toUpperCase() !== input.kuerzel.toUpperCase()) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Nur eigene Anfragen abrufbar." });
      }
      const standortIds = getZugaenglicheStandortIds(ctx);
      return getAnfragenByTechniker({
        techniker:   input.kuerzel,
        showAll:     input.showAll,
        limit:       input.limit,
        offset:      input.offset,
        standortIds: standortIds ?? undefined,
      });
    }),

  // Offene Anfragen (NEU/BEDARF/IN_BEARBEITUNG) eines Technikers für eine LogID.
  // Wird beim Erstellen einer neuen Anfrage geprüft → freundlicher Hinweis
  // statt unbeabsichtigter Doppelbestellung. Blockiert nicht — legitime
  // Mehrfach-Anfragen bleiben über "Trotzdem neu" möglich.
  offeneFuerLogId: protectedProcedure
    .input(z.object({
      kuerzel: z.string().min(1).max(50),
      logId:   z.string().min(1).max(100),
    }))
    .query(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      if (user.rolle !== "ADMIN" && user.kuerzel.toUpperCase() !== input.kuerzel.toUpperCase()) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Nur eigene Anfragen abrufbar." });
      }

      const standortIds = getZugaenglicheStandortIds(ctx);

      // Daten-Inkonsistenz: Anfragen liegen in der DB teils mit Punkten
      // (z.B. "212.757.577"), teils ohne. Wir matchen beide Varianten —
      // langfristig sollte eine Migration auf ein einheitliches Format folgen.
      const cleanLogId  = input.logId.replace(/\./g, "").trim();
      const parts       = cleanLogId.match(/.{1,3}/g) ?? [];
      const dottedLogId = parts.length === 3 ? parts.join(".") : cleanLogId;
      const logIdVarianten = Array.from(new Set([cleanLogId, dottedLogId]));

      const anfragen = await ctx.prisma.anfrage.findMany({
        where: {
          techniker: input.kuerzel.toUpperCase().trim(),
          logId:     { in: logIdVarianten },
          status:    { in: [AnfrageStatus.NEU, AnfrageStatus.BEDARF, AnfrageStatus.IN_BEARBEITUNG] },
          ...(standortIds && standortIds.length > 0 && {
            OR: [
              { artikel: { standortId: { in: standortIds } } },
              { artikelId: null },
            ],
          }),
        },
        orderBy: { datum: "desc" },
        include: { artikel: { select: { id: true, bezeichnung: true, kategorie: true } } },
      });

      // Gruppieren nach gruppenNr (gleiche Submission) bzw. Einzel-Anfrage fallback
      type AnfrageItem = typeof anfragen[number];
      const map = new Map<string, AnfrageItem[]>();
      for (const a of anfragen) {
        const key = a.gruppenNr ?? `single-${a.id}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(a);
      }

      const gruppen = Array.from(map.entries()).map(([gruppenNr, items]) => ({
        gruppenNr,
        datum:    items[0]!.datum,
        anfragen: items,
        teile:    items.map(i => i.teil),
        // Gruppen-Status: schlechtester gewinnt (BEDARF > IN_BEARBEITUNG > NEU)
        status:   items.find(i => i.status === AnfrageStatus.BEDARF)?.status
                ?? items.find(i => i.status === AnfrageStatus.IN_BEARBEITUNG)?.status
                ?? items[0]!.status,
      }));

      return { gruppen };
    }),

  // Anfrage stornieren — Techniker: nur eigene, nur NEU/BEDARF.
  // Per ID (bevorzugt, eindeutig) oder per logId+teil (Legacy).
  storniere: protectedProcedure
    .input(z.union([
      z.object({
        id:        z.number().int().positive(),
        techniker: z.string().min(1).max(50),
      }),
      z.object({
        techniker: z.string().min(1).max(50),
        logId:     z.string().min(1).max(100),
        teil:      z.string().min(1).max(255),
      }),
    ]))
    .mutation(({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      if (user.rolle !== "ADMIN" && user.kuerzel.toUpperCase() !== input.techniker.toUpperCase()) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Nur eigene Anfragen stornierbar." });
      }
      return storniereAnfrage(input);
    }),

  // Legacy abschließen
  abschliessen: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const user   = ctx.session.user as SessionUser;
      const result = await schliesseAnfrageAb(input.id, user.kuerzel);
      const belegNr = await naechsteBelegNr("AL");
      return { ...result, belegNr };
    }),

  // ── Status setzen — Haupt-Mutation für Admin ──────────────────────────────
  setStatus: adminProcedure
    .input(z.object({
      id:     z.number().int().positive(),
      status: z.nativeEnum(AnfrageStatus),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;

      let belegNr:     string | null = null;
      let restBestand: number | null = null;
      let artikelInfo: { bezeichnung: string; lagerplatz: string | null; kategorie: string } | null = null;

      if (input.status === AnfrageStatus.ABGESCHLOSSEN) {
        const anfrage = await ctx.prisma.anfrage.findUnique({
          where:   { id: input.id },
          include: { artikel: { select: { id: true, bezeichnung: true, lagerplatz: true, kategorie: true } } },
        });

        // TEST-MODUS: Sicherheitsgurt — Test-Anfragen erzeugen NIE eine Buchung
        // und verändern NIE den Bestand. Status wird unten via setzeStatus gesetzt.
        // Nur aus einem BUCHBAREN (nicht-terminalen) Zustand darf eine AUSGANG-Buchung
        // + Beleg entstehen. Sonst wuerde ein setStatus(ABGESCHLOSSEN) auf eine bereits
        // STORNIERTE/NICHT_VERFUEGBARE Anfrage still Bestand verbrauchen und eine Belegnr
        // ziehen, bevor setzeStatus() den unzulaessigen Uebergang unten ablehnt.
        const buchbar = anfrage != null && ([
          AnfrageStatus.NEU, AnfrageStatus.BEDARF, AnfrageStatus.IN_BEARBEITUNG,
        ] as AnfrageStatus[]).includes(anfrage.status);

        if (anfrage && !anfrage.testModus && buchbar) {
          // Auf welchem Artikel wurde tatsächlich gebucht? Bei Pool-Entnahme ist
          // das der Partner — dessen Bestand muss unten ebenfalls nachgezogen
          // werden, sonst bleibt er veraltet stehen.
          let gebuchtAuf: number | null = null;

          // AUSGANG-Buchung erstellen — nur wenn Artikel verknüpft
          if (anfrage.artikelId) {
            try {
              // Pool VOR der Buchung auflösen: Liegt der Bestand beim baugleichen
              // Partner (z. B. Füße hinten statt vorne), wird von dort abgebucht.
              // Ohne Partner bzw. ohne ausreichenden Bestand bleibt es beim eigenen
              // Artikel — dann greift wie bisher die Bestandsprüfung in bucheLager
              // und der Fall wird unten als „ohne Teil erledigt" behandelt.
              const quelleId = await waehleQuelle(anfrage.artikelId, anfrage.menge);
              const buchenAuf = quelleId ?? anfrage.artikelId;

              await bucheLager({
                artikelId:   buchenAuf,
                menge:       anfrage.menge,
                typ:         BuchungsTyp.AUSGANG,
                mitarbeiter: user.kuerzel,
                notiz:       buchenAuf === anfrage.artikelId
                  ? `Anfrage #${input.id}`
                  : `Anfrage #${input.id} | aus Pool-Partner entnommen`,
              });
              gebuchtAuf = buchenAuf;
            } catch (e) {
              // "Kein Bestand" / "Nicht genug Bestand" sind erwartete Fälle (BEDARF-Anfragen)
              // und duerfen als "ohne Teil erledigt" durchgehen. ALLE anderen Fehler
              // (z.B. transiente DB-Fehler) werden NICHT verschluckt — sonst wuerde die
              // Anfrage ABGESCHLOSSEN + Beleg gesetzt, obwohl KEINE Buchung entstand.
              const msg = e instanceof Error ? e.message : String(e);
              if (!msg.includes("Kein Bestand") && !msg.includes("Nicht genug Bestand")) {
                console.error(`[setStatus] AUSGANG für Anfrage #${input.id} fehlgeschlagen: ${msg}`);
                throw e;
              }
            }
          }

          belegNr = await naechsteBelegNr("AL");

          // Bestand IMMER neu berechnen — robust auch wenn bucheLager übersprungen wurde.
          // syncBestandAusHistorie summiert EINGANG - AUSGANG aus der kompletten Historie,
          // ignoriert DIREKT-Buchungen und schreibt das Ergebnis in Artikel.bestand.
          if (anfrage.artikelId) {
            restBestand = await syncBestandAusHistorie(anfrage.artikelId);
            // Explizites Socket-Event damit Frontend den Bestand sofort aktualisiert
            emitToAll(EVENTS.BESTAND_UPDATED, { artikelId: anfrage.artikelId, bestand: restBestand });

            // Wurde aus dem Pool-Partner entnommen, muss auch DESSEN Bestand
            // nachgezogen und gemeldet werden — sonst zeigt jede Ansicht dort
            // weiter den alten Wert, bis zufällig etwas anderes ihn berührt.
            if (gebuchtAuf && gebuchtAuf !== anfrage.artikelId) {
              const partnerBestand = await syncBestandAusHistorie(gebuchtAuf);
              emitToAll(EVENTS.BESTAND_UPDATED, { artikelId: gebuchtAuf, bestand: partnerBestand });
            }
          }

          if (anfrage.artikel) {
            artikelInfo = { bezeichnung: anfrage.artikel.bezeichnung, lagerplatz: anfrage.artikel.lagerplatz, kategorie: anfrage.artikel.kategorie };
          }
        }
      }

      const aktualisiert = await setzeStatus(input.id, input.status);
      return { ...aktualisiert, belegNr, restBestand, artikel: artikelInfo };
    }),

  // ── Anfrage mit LogID erledigen — speichert Spender-LogID in der Buchung ──
  erledigenMitLogId: protectedProcedure
    .input(z.object({
      id:    z.number().int().positive(),
      logId: z.string().min(1).max(100),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;

      const anfrage = await ctx.prisma.anfrage.findUnique({
        where:   { id: input.id },
        include: { artikel: { select: { id: true, bezeichnung: true, lagerplatz: true, kategorie: true } } },
      });

      if (!anfrage) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Anfrage #${input.id} nicht gefunden` });
      }

      // Nur aus buchbarem Zustand erledigbar
      const buchbar = ([AnfrageStatus.NEU, AnfrageStatus.BEDARF, AnfrageStatus.IN_BEARBEITUNG] as AnfrageStatus[])
        .includes(anfrage.status);
      if (!buchbar) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Anfrage #${input.id} kann nicht erledigt werden (Status: ${anfrage.status})`,
        });
      }

      let belegNr: string | null = null;
      let restBestand: number | null = null;

      // AUSGANG-Buchung mit herkunftLogId erstellen
      if (!anfrage.testModus && anfrage.artikelId) {
        try {
          await bucheLager({
            artikelId:    anfrage.artikelId,
            menge:        anfrage.menge,
            typ:          BuchungsTyp.AUSGANG,
            mitarbeiter:  user.kuerzel,
            notiz:        `Anfrage #${input.id}`,
            herkunftLogId: input.logId.trim() || null,  // Spender-LogID speichern
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!msg.includes("Kein Bestand") && !msg.includes("Nicht genug Bestand")) {
            throw e;
          }
        }
      }

      belegNr = await naechsteBelegNr("AL");

      // Bestand neu berechnen
      if (anfrage.artikelId) {
        restBestand = await syncBestandAusHistorie(anfrage.artikelId);
        emitToAll(EVENTS.BESTAND_UPDATED, { artikelId: anfrage.artikelId, bestand: restBestand });
      }

      // Status auf ABGESCHLOSSEN setzen
      const aktualisiert = await setzeStatus(input.id, AnfrageStatus.ABGESCHLOSSEN);

      console.log(`[erledigenMitLogId] Anfrage #${input.id} erledigt mit LogID ${input.logId}`);
      return { ...aktualisiert, belegNr, restBestand };
    }),

  // ── Anfrage zurücksetzen — nur Admin. Löscht Buchung, Status = NEU oder BEDARF ──
  reset: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
    }))
    .mutation(async ({ input, ctx }) => {
      const anfrage = await ctx.prisma.anfrage.findUnique({
        where:   { id: input.id },
        include: { artikel: { select: { id: true } } },
      });

      if (!anfrage) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Anfrage #${input.id} nicht gefunden` });
      }

      if (anfrage.status !== AnfrageStatus.ABGESCHLOSSEN) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Anfrage #${input.id} ist nicht erledigt (Status: ${anfrage.status}). Nur erledigte Anfragen können zurückgesetzt werden.`,
        });
      }

      // Transaktional: Buchung löschen + Bestand neu berechnen
      await ctx.prisma.$transaction(async (tx) => {
        // Finde die AUSGANG-Buchung für diese Anfrage
        const buchung = await tx.buchung.findFirst({
          where: {
            typ:     BuchungsTyp.AUSGANG,
            notiz:   `Anfrage #${input.id}`,
            artikelId: anfrage.artikelId || undefined,
          },
        });

        if (buchung) {
          // Buchung löschen
          await tx.buchung.delete({ where: { id: buchung.id } });
          console.log(`[reset] Buchung #${buchung.id} (Anfrage #${input.id}) gelöscht`);
        }
      });

      // Bestand korrigieren + Status setzen (NEU wenn Bestand > 0, sonst BEDARF)
      let restBestand: number | null = null;
      let neuerStatus: AnfrageStatus = AnfrageStatus.BEDARF; // Default: nicht verfügbar

      if (anfrage.artikelId) {
        restBestand = await syncBestandAusHistorie(anfrage.artikelId);
        if (restBestand > 0) {
          neuerStatus = AnfrageStatus.NEU; // Bestand vorhanden → neue Anfrage
        }
        emitToAll(EVENTS.BESTAND_UPDATED, { artikelId: anfrage.artikelId, bestand: restBestand });
      }

      // Status aktualisieren
      await ctx.prisma.anfrage.update({
        where:  { id: input.id },
        data:   { status: neuerStatus },
      });

      console.log(`[reset] Anfrage #${input.id} zurückgesetzt auf ${neuerStatus} (Bestand: ${restBestand})`);
      return { id: input.id, status: neuerStatus, restBestand };
    }),

  // Gruppenansicht — read (ANFRAGE_VIEW_ALL)
  getGruppiert: anfragenReadProcedure
    .input(z.object({
      status:     z.nativeEnum(AnfrageStatus).optional(),
      techniker:  z.string().optional(),
      von:        z.date().optional(),
      bis:        z.date().optional(),
      standortId: z.number().int().positive().nullish(),
      ohneTest:   z.boolean().optional(),  // Test-Anfragen ausblenden (Filter-Schalter)
    }).optional())
    .query(({ input, ctx }) => {
      const sF = standortWhere(ctx, input?.standortId);
      const sId = sF.standortId as number | undefined ?? null;
      return getAnfragenGruppiert({ ...input, standortId: sId });
    }),

  // Anfragen löschen — nur ADMIN. Cascade auf Chat-Nachrichten (Nachricht.logId
  // = "chat:{anfrageId}"). Buchungen werden NICHT angefasst (heilige Regel:
  // Bestand-Historie). Transaktional: alles oder nichts.
  loeschen: adminProcedure
    .input(z.object({
      ids:       z.array(z.number().int().positive()).max(100).default([]),
      gruppenNr: z.string().max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // IDs ermitteln: entweder direkt oder über gruppenNr
      let allIds = input.ids;
      if (input.gruppenNr) {
        const gruppenAnfragen = await ctx.prisma.anfrage.findMany({
          where:  { gruppenNr: input.gruppenNr },
          select: { id: true },
        });
        allIds = gruppenAnfragen.map(a => a.id);
      }

      if (allIds.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Keine Anfragen zum Löschen." });
      }

      // Vor dem Löschen: Techniker auslesen, damit sie notifiziert werden
      const betroffeneAnfragen = await ctx.prisma.anfrage.findMany({
        where: { id: { in: allIds } },
        select: { id: true, techniker: true, logId: true },
      });

      const result = await ctx.prisma.$transaction(async (tx) => {
        const chatKeys = allIds.map(id => `chat:${id}`);
        const deletedNachrichten = await tx.nachricht.deleteMany({
          where: { logId: { in: chatKeys } },
        });
        const deletedAnfragen = await tx.anfrage.deleteMany({
          where: { id: { in: allIds } },
        });
        return {
          anfragen:    deletedAnfragen.count,
          nachrichten: deletedNachrichten.count,
          ids:         allIds,
        };
      });

      // Admin-UIs live informieren
      emitToBackoffice(EVENTS.ANFRAGE_GELOESCHT, { ids: result.ids });

      // Techniker notifizieren: Anfragen für diese LogIDs sind gelöscht
      // → Ihr lokaler Cache ist invalid, bitte neu laden
      const technikerSet = new Set(betroffeneAnfragen.map(a => a.techniker));
      for (const techniker of technikerSet) {
        emitToUser(techniker, EVENTS.ANFRAGE_GELOESCHT, { ids: result.ids });
      }

      return result;
    }),

  // ── Lock-System ────────────────────────────────────────────────────────────

  // Gruppe in Bearbeitung nehmen (atomic)
  gruppeInBearbeitungNehmen: adminProcedure
    .input(z.object({ anfrageIds: z.array(z.number().int().positive()).min(1).max(50) }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      const locked = await gruppeInBearbeitungNehmen(input.anfrageIds, user.kuerzel);

      // Techniker + logId/geraeteName der ersten Anfrage für die gezielte
      // Benachrichtigung (Tab-Counter + Techniker-Notification "in Bearbeitung").
      const anfrage = await ctx.prisma.anfrage.findFirst({
        where:  { id: { in: input.anfrageIds } },
        select: { techniker: true, logId: true, geraeteName: true },
      });

      const payload = {
        anfrageIds:  input.anfrageIds,
        bearbeiter:  user.kuerzel,
        seit:        new Date(),
        logId:       anfrage?.logId,
        geraeteName: anfrage?.geraeteName,
      };
      // Backoffice statt nur "admins": BETRACHTER/ADMIN_READONLY sollen Lock-Wechsel
      // genauso live sehen wie ANFRAGE_UPDATED — sonst zeigt ihre Liste veraltete Locks.
      emitToBackoffice(EVENTS.ANFRAGE_UEBERNOMMEN, payload);
      if (anfrage) emitToUser(anfrage.techniker, EVENTS.ANFRAGE_UEBERNOMMEN, payload);

      return { locked };
    }),

  // Gruppe freigeben — Fail-Safe, jeder Admin darf
  gruppeFreigeben: adminProcedure
    .input(z.object({
      anfrageIds: z.array(z.number().int().positive()).min(1).max(50),
      grund:      z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      const { vorBearbeiter, freigegeben } = await gruppeFreigeben(input.anfrageIds, user.kuerzel, input.grund);

      const anfrage = await ctx.prisma.anfrage.findFirst({
        where:  { id: { in: input.anfrageIds } },
        select: { techniker: true },
      });

      const payload = { anfrageIds: input.anfrageIds, durch: user.kuerzel, vorBearbeiter, grund: input.grund };
      emitToBackoffice(EVENTS.ANFRAGE_FREIGEGEBEN, payload);
      if (anfrage) emitToUser(anfrage.techniker, EVENTS.ANFRAGE_FREIGEGEBEN, payload);

      return { freigegeben, vorBearbeiter };
    }),

  // Gruppe zurückgeben — nur durch den Bearbeiter selbst
  gruppeZurueckgeben: adminProcedure
    .input(z.object({ anfrageIds: z.array(z.number().int().positive()).min(1).max(50) }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      const zurueck = await gruppeZurueckgeben(input.anfrageIds, user.kuerzel);

      const payload = { anfrageIds: input.anfrageIds, bearbeiter: user.kuerzel };
      emitToBackoffice(EVENTS.ANFRAGE_FREIGEGEBEN, { ...payload, durch: user.kuerzel, vorBearbeiter: user.kuerzel });

      return { zurueck };
    }),

});

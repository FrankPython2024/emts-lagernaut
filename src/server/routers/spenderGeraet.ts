import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { SpenderGeraetStatus, SpenderKomponenteZustand } from "@prisma/client";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";
import { normalizeLogId, logIdClean } from "@/lib/format/logId";
import { STANDARD_TEILTYPEN, VERSCHIEDENES_TEILTYP } from "@/lib/constants/teiltypen";
import type { SessionUser } from "@/core/types";

// ── Spendergeräte ────────────────────────────────────────────────────────────
//
// Komplette Geräte auf Lager, die später zerlegt werden. Bis dahin ein
// Teilevorrat zum Nachschlagen.
//
// ⚠️ Zählt NICHT auf den Bestand (siehe Kommentar am Modell in schema.prisma).
// Erst das Zerlegen erzeugt echte EINGANG-Buchungen über den normalen
// Einlager-Weg — vorher liegt das Teil im Gerät, nicht im Regal.
//
// Rechte wiederverwendet: ARTIKEL_VIEW zum Sehen, ARTIKEL_EINLAGERN zum
// Erfassen und Zerlegen. Kein neues Recht, kein seed-rbac nötig.
const sehen   = permissionProcedure("ARTIKEL_VIEW");
const pflegen = permissionProcedure("ARTIKEL_EINLAGERN");

const GRADINGS = ["A+", "A", "B", "C"] as const;

/** Leitet den Status aus den Komponenten ab — nie von Hand gesetzt. */
function statusAus(komponenten: { zustand: SpenderKomponenteZustand }[]): SpenderGeraetStatus {
  const vorhanden = komponenten.filter((k) => k.zustand === SpenderKomponenteZustand.VORHANDEN).length;
  const entnommen = komponenten.filter((k) => k.zustand === SpenderKomponenteZustand.ENTNOMMEN).length;
  if (vorhanden === 0) return SpenderGeraetStatus.ZERLEGT;
  if (entnommen > 0)   return SpenderGeraetStatus.TEILWEISE_ZERLEGT;
  return SpenderGeraetStatus.EINGELAGERT;
}

export const spenderGeraetRouter = createTRPCRouter({
  /**
   * Welche Komponenten kommen für dieses Gerät in Frage?
   *
   * Standard-Teiltypen plus die, die für genau dieses Modell hinterlegt sind
   * (`ModellTeiltyp`) — dieselbe Auflösung wie im Techniker-Portal: Der
   * Gerätename wird gegen „hersteller modell" verglichen.
   *
   * ⚠️ „Verschiedenes" fällt raus. Das ist eine Sammel-Kategorie mit Freitext,
   * kein Bauteil, das in einem Gerät steckt oder fehlt.
   */
  teiltypenFuer: sehen
    .input(z.object({ geraet: z.string().trim().min(1).max(255) }))
    .query(async ({ input }) => {
      const gesucht = input.geraet.trim().toLowerCase();

      const modelle = await prisma.geraeteModell.findMany({
        where:  { aktiv: true },
        select: { id: true, hersteller: true, modell: true },
      });
      const passend = modelle.find(
        (m) => `${m.hersteller} ${m.modell}`.toLowerCase() === gesucht
            || m.modell.toLowerCase() === gesucht,
      );

      let namen: string[] = [];
      if (passend) {
        const eigene = await prisma.modellTeiltyp.findMany({
          where:   { modellId: passend.id, teiltyp: { aktiv: true } },
          select:  { teiltyp: { select: { name: true, sortierung: true } } },
          orderBy: { teiltyp: { sortierung: "asc" } },
        });
        namen = eigene.map((e) => e.teiltyp.name);
      }
      // Standards immer dazu — sie gelten implizit für jedes Gerät.
      for (const t of STANDARD_TEILTYPEN) if (!namen.includes(t.name)) namen.push(t.name);

      // Bewusst als Map<string, …>: `namen` enthält auch modellgebundene
      // Teiltypen, die nicht im Standard-Literal-Typ vorkommen.
      const beschriftung = new Map<string, { label: string; icon: string }>(
        STANDARD_TEILTYPEN.map((t) => [t.name as string, { label: t.label, icon: t.icon }]),
      );
      return namen
        .filter((n) => n !== VERSCHIEDENES_TEILTYP)
        .map((n) => {
          const s = beschriftung.get(n);
          return { name: n, label: s?.label ?? n, icon: s?.icon ?? "🔧" };
        });
    }),

  /**
   * Gerät als Ganzes einlagern.
   *
   * `komponenten` ist die vollständige Liste der Teiltypen, die für dieses
   * Modell in Frage kommen — mit dem Häkchen, ob sie noch drin sind. Abgewählte
   * werden als FEHLT_BEREITS festgehalten statt weggelassen: Es ist ein
   * Unterschied, ob eine Tastatur schon draußen war oder ob niemand hingesehen
   * hat, und beim späteren Zerlegen sucht sonst jemand danach.
   */
  anlegen: pflegen
    .input(z.object({
      logId:       z.string().trim().min(1).max(60),
      hersteller:  z.string().trim().max(64).nullish(),
      bezeichnung: z.string().trim().min(1).max(255),
      modellId:    z.number().int().positive().nullish(),
      grading:     z.enum(GRADINGS),
      lagerplatz:  z.string().trim().max(64).nullish(),
      standortId:  z.number().int().positive(),
      notiz:       z.string().trim().max(2000).nullish(),
      komponenten: z.array(z.object({
        teiltyp:   z.string().trim().min(1).max(100),
        vorhanden: z.boolean(),
      })).min(1).max(100),
    }))
    .mutation(async ({ input, ctx }) => {
      const user  = ctx.session.user as SessionUser;
      const logId = normalizeLogId(input.logId);
      if (!logId) throw new TRPCError({ code: "BAD_REQUEST", message: "LogID unlesbar" });

      // ⚠️ Ein Gerät kann nur einmal im Regal liegen. Die freundliche Meldung
      // ist wichtiger als der Fremdschlüsselfehler: Wer scannt, hat sich
      // meistens nur vertan oder das Gerät ist schon erfasst.
      const schonDa = await prisma.spenderGeraet.findUnique({
        where:  { logId },
        select: { id: true, lagerplatz: true, status: true },
      });
      if (schonDa) {
        throw new TRPCError({
          code:    "CONFLICT",
          message: `Dieses Gerät ist schon erfasst${schonDa.lagerplatz ? ` (${schonDa.lagerplatz})` : ""}.`,
        });
      }

      // Doppelte Teiltypen aus der Eingabe zusammenfassen — der Unique-Index
      // würde sonst den ganzen createMany-Block abbrechen.
      const gesehen = new Set<string>();
      const komponenten = input.komponenten.flatMap((k) => {
        const t = k.teiltyp.trim();
        if (!t || gesehen.has(t)) return [];
        gesehen.add(t);
        return [{
          teiltyp: t,
          zustand: k.vorhanden
            ? SpenderKomponenteZustand.VORHANDEN
            : SpenderKomponenteZustand.FEHLT_BEREITS,
        }];
      });

      const geraet = await prisma.$transaction(async (tx) => {
        const g = await tx.spenderGeraet.create({
          data: {
            logId,
            logIdClean:  logIdClean(input.logId),
            hersteller:  input.hersteller?.trim() || null,
            bezeichnung: input.bezeichnung.trim(),
            modellId:    input.modellId ?? null,
            grading:     input.grading,
            lagerplatz:  input.lagerplatz?.trim() || null,
            standortId:  input.standortId,
            notiz:       input.notiz?.trim() || null,
            status:      statusAus(komponenten),
            erfasstVon:  (user.kuerzel ?? user.name ?? "").slice(0, 50) || "unbekannt",
          },
        });
        await tx.spenderGeraetKomponente.createMany({
          data: komponenten.map((k) => ({ ...k, geraetId: g.id })),
        });
        return g;
      });

      return { id: geraet.id, logId: geraet.logId };
    }),

  /** Übersicht mit Filtern. */
  liste: sehen
    .input(z.object({
      suche:      z.string().trim().max(100).optional(),
      status:     z.nativeEnum(SpenderGeraetStatus).optional(),
      standortId: z.number().int().positive().optional(),
      // Nur Geräte, in denen dieser Teiltyp noch steckt.
      mitTeiltyp: z.string().trim().max(100).optional(),
    }).optional())
    .query(async ({ input }) => {
      const q = input?.suche;
      const geraete = await prisma.spenderGeraet.findMany({
        where: {
          ...(input?.status     ? { status: input.status }         : {}),
          ...(input?.standortId ? { standortId: input.standortId } : {}),
          ...(input?.mitTeiltyp
            ? { komponenten: { some: { teiltyp: input.mitTeiltyp, zustand: SpenderKomponenteZustand.VORHANDEN } } }
            : {}),
          ...(q
            ? { OR: [
                { bezeichnung: { contains: q } },
                { logId:       { contains: q } },
                { logIdClean:  { contains: logIdClean(q) } },
                { lagerplatz:  { contains: q } },
              ] }
            : {}),
        },
        include: { komponenten: { select: { teiltyp: true, zustand: true } } },
        orderBy: [{ status: "asc" }, { erfasstAm: "desc" }],
        take:    500,
      });

      return geraete.map((g) => ({
        id:          g.id,
        logId:       g.logId,
        hersteller:  g.hersteller,
        bezeichnung: g.bezeichnung,
        grading:     g.grading,
        lagerplatz:  g.lagerplatz,
        status:      g.status,
        notiz:       g.notiz,
        erfasstVon:  g.erfasstVon,
        erfasstAm:   g.erfasstAm,
        vorhanden:   g.komponenten.filter((k) => k.zustand === SpenderKomponenteZustand.VORHANDEN).length,
        gesamt:      g.komponenten.length,
      }));
    }),

  /** Ein Gerät mit allen Komponenten. */
  details: sehen
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const g = await prisma.spenderGeraet.findUnique({
        where:   { id: input.id },
        include: { komponenten: { orderBy: { teiltyp: "asc" } } },
      });
      if (!g) throw new TRPCError({ code: "NOT_FOUND", message: "Spendergerät nicht gefunden" });
      return g;
    }),

  /**
   * Komponenten als entnommen abhaken — nach dem Einbuchen im Assistenten.
   *
   * ⚠️ Bucht selbst NICHTS in den Bestand. Der Einlager-Weg hat das schon
   * getan; hier wird nur nachgetragen, was aus dem Gerät verschwunden ist.
   * Getrennt zu halten ist Absicht: Ein Fehler beim Abhaken darf niemals eine
   * Bestandsbuchung rückgängig machen oder verdoppeln.
   */
  komponentenEntnommen: pflegen
    .input(z.object({
      id:       z.number().int().positive(),
      teiltypen: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      const von  = (user.kuerzel ?? user.name ?? "").slice(0, 50) || null;

      const geraet = await prisma.spenderGeraet.findUnique({
        where:   { id: input.id },
        include: { komponenten: true },
      });
      if (!geraet) throw new TRPCError({ code: "NOT_FOUND", message: "Spendergerät nicht gefunden" });

      // Nur was wirklich noch drin ist. Ein zweiter Klick auf dieselbe
      // Komponente darf den Zeitpunkt nicht überschreiben.
      const treffer = geraet.komponenten.filter(
        (k) => input.teiltypen.includes(k.teiltyp) && k.zustand === SpenderKomponenteZustand.VORHANDEN,
      );

      const nachher = geraet.komponenten.map((k) =>
        treffer.some((t) => t.id === k.id) ? { zustand: SpenderKomponenteZustand.ENTNOMMEN } : k,
      );
      const neuerStatus = statusAus(nachher);

      await prisma.$transaction([
        prisma.spenderGeraetKomponente.updateMany({
          where: { id: { in: treffer.map((t) => t.id) } },
          data:  { zustand: SpenderKomponenteZustand.ENTNOMMEN, entnommenAm: new Date(), entnommenVon: von },
        }),
        prisma.spenderGeraet.update({
          where: { id: input.id },
          data:  {
            status:    neuerStatus,
            zerlegtAm: neuerStatus === SpenderGeraetStatus.ZERLEGT ? new Date() : null,
          },
        }),
      ]);

      return { entnommen: treffer.length, status: neuerStatus };
    }),

  /**
   * Welche Spendergeräte haben diesen Teiltyp noch drin?
   *
   * Für den Hinweis in der Admin-Anfragenliste, wenn kein loses Teil da ist.
   * Verglichen wird die Bezeichnung OHNE Hersteller-Präfix — dieselbe Form, die
   * `Anfrage.geraet` und `Artikel.bezeichnung` benutzen.
   */
  fuerAnfrage: sehen
    .input(z.object({
      bezeichnung: z.string().trim().min(1).max(255),
      teiltyp:     z.string().trim().min(1).max(100),
    }))
    .query(async ({ input }) => {
      const treffer = await prisma.spenderGeraet.findMany({
        where: {
          bezeichnung: input.bezeichnung,
          status:      { not: SpenderGeraetStatus.ZERLEGT },
          komponenten: { some: { teiltyp: input.teiltyp, zustand: SpenderKomponenteZustand.VORHANDEN } },
        },
        select:  { id: true, logId: true, grading: true, lagerplatz: true },
        orderBy: [{ grading: "asc" }, { erfasstAm: "asc" }],
        take:    10,
      });
      return treffer;
    }),

  /**
   * Hinweise für die Admin-Anfragenliste, gesammelt für mehrere Anfragen.
   *
   * Beantwortet: „Für diese Anfrage liegt kein loses Teil im Regal — steckt es
   * noch in einem Spendergerät?" Eine Abfrage für die ganze Liste; je Zeile eine
   * eigene wäre bei 50 offenen Anfragen spürbar.
   *
   * ⚠️ Nur für Admins gedacht. Der Techniker sieht davon nichts: Ein Gerät zu
   * zerlegen ist eine Entscheidung, die im Lager getroffen wird, und ein Hinweis
   * im Portal würde eine Verfügbarkeit versprechen, die es so nicht gibt.
   */
  hinweiseFuerAnfragen: sehen
    .input(z.object({ anfrageIds: z.array(z.number().int().positive()).min(1).max(200) }))
    .query(async ({ input }) => {
      const anfragen = await prisma.anfrage.findMany({
        where:  { id: { in: input.anfrageIds } },
        select: { id: true, geraet: true, teil: true },
      });
      if (anfragen.length === 0) return {};

      // Ein Zug über alle in Frage kommenden Geräte statt je Anfrage einer.
      const kandidaten = await prisma.spenderGeraet.findMany({
        where: {
          bezeichnung: { in: [...new Set(anfragen.map((a) => a.geraet))] },
          status:      { not: SpenderGeraetStatus.ZERLEGT },
        },
        select: {
          id: true, logId: true, grading: true, lagerplatz: true, bezeichnung: true,
          komponenten: {
            where:  { zustand: SpenderKomponenteZustand.VORHANDEN },
            select: { teiltyp: true },
          },
        },
      });

      const treffer: Record<number, { id: number; logId: string; grading: string; lagerplatz: string | null }[]> = {};
      for (const a of anfragen) {
        const passend = kandidaten.filter(
          (k) => k.bezeichnung === a.geraet && k.komponenten.some((c) => c.teiltyp === a.teil),
        );
        if (passend.length > 0) {
          treffer[a.id] = passend
            .map((k) => ({ id: k.id, logId: k.logId, grading: k.grading, lagerplatz: k.lagerplatz }))
            .sort((x, y) => x.grading.localeCompare(y.grading));
        }
      }
      return treffer;
    }),

  /** Notiz, Lagerplatz oder Grading nachtragen. */
  aktualisieren: pflegen
    .input(z.object({
      id:         z.number().int().positive(),
      grading:    z.enum(GRADINGS).optional(),
      lagerplatz: z.string().trim().max(64).nullish(),
      notiz:      z.string().trim().max(2000).nullish(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...rest } = input;
      const daten = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== undefined),
      );
      await prisma.spenderGeraet.update({ where: { id }, data: daten });
      return { ok: true };
    }),

  /**
   * Gerät aus dem Register nehmen.
   *
   * Nur ein Register-Eintrag verschwindet — an Buchungen ändert das nichts.
   * Bereits eingebuchte Teile bleiben im Bestand, wo sie hingehören.
   */
  loeschen: pflegen
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await prisma.spenderGeraet.delete({ where: { id: input.id } });
      return { ok: true };
    }),
});

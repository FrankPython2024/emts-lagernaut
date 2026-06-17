import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";
import type { SessionUser } from "@/core/types";
import { normalizeLogId } from "@/lib/pickup/logId";
import { nurZiffern } from "@/lib/format/ziffern";
import { emitToAdmins } from "@/modules/realtime/socket";
import { EVENTS } from "@/modules/realtime/events";

// Verwaltung (anlegen/liste/details/löschen) erfordert PICKUP_MANAGE.
// Picken (Scan-Ansicht) erfordert PICKUP_PICK. Admin hat beides über die
// SYSTEM_ADMIN-Wildcard.
const pickupManage = permissionProcedure("PICKUP_MANAGE");
const pickupPick   = permissionProcedure("PICKUP_PICK");

const positionInput = z.object({
  logId:       z.string(),
  colli:       z.string().nullish(),
  stellplatz:  z.string().nullish(),
  bezeichnung: z.string().nullish(),
});

// Position für die Scan-Ansicht aufbereiten (Finder-Name auflösen).
type PosMitFinder = {
  id: number; logId: string; colli: string | null; stellplatz: string | null;
  bezeichnung: string | null; status: string; gefundenAm: Date | null;
  finder: { name: string; kuerzel: string } | null;
};
function shapePos(p: PosMitFinder) {
  return {
    id:              p.id,
    logId:           p.logId,
    colli:           p.colli,
    stellplatz:      p.stellplatz,
    bezeichnung:     p.bezeichnung,
    status:          p.status,
    gefundenVonName: p.finder?.kuerzel ?? p.finder?.name ?? null,
    gefundenAm:      p.gefundenAm,
  };
}

// Live-Fortschritt an Admins melden (nur Ansicht aktualisieren, KEIN Ton/Toast).
// Fire-and-forget — Fehler werden geschluckt, damit der Scan nie blockiert.
async function emitFortschritt(auftragId: number): Promise<void> {
  try {
    const [auftrag, positionen] = await Promise.all([
      prisma.pickupAuftrag.findUnique({ where: { id: auftragId }, select: { status: true } }),
      prisma.pickupPosition.findMany({ where: { auftragId }, select: { status: true } }),
    ]);
    if (!auftrag) return;
    const gesamt   = positionen.length;
    const gefunden = positionen.filter((p) => p.status === "GEFUNDEN").length;
    emitToAdmins(EVENTS.PICKUP_FORTSCHRITT, { auftragId, gefunden, gesamt, status: auftrag.status });
  } catch {
    /* Live-Update ist Best-Effort */
  }
}

export const pickupRouter = createTRPCRouter({

  // Alle Aufträge mit Zählern (gesamt/offen/gefunden), neueste zuerst.
  liste: pickupManage.query(async () => {
    const auftraege = await prisma.pickupAuftrag.findMany({
      orderBy: { createdAt: "desc" },
      include: { ersteller: { select: { name: true, kuerzel: true } } },
    });

    const counts = await prisma.pickupPosition.groupBy({
      by:     ["auftragId", "status"],
      _count: { _all: true },
    });
    const zaehler = new Map<number, { gesamt: number; offen: number; gefunden: number }>();
    for (const c of counts) {
      const e = zaehler.get(c.auftragId) ?? { gesamt: 0, offen: 0, gefunden: 0 };
      e.gesamt += c._count._all;
      if (c.status === "GEFUNDEN") e.gefunden += c._count._all;
      else                         e.offen    += c._count._all;
      zaehler.set(c.auftragId, e);
    }

    return auftraege.map((a) => ({
      id:              a.id,
      name:            a.name,
      typ:             a.typ,
      bemerkung:       a.bemerkung,
      status:          a.status,
      createdAt:       a.createdAt,
      abgeschlossenAm: a.abgeschlossenAm,
      ersteller:       a.ersteller?.kuerzel ?? a.ersteller?.name ?? "—",
      ...(zaehler.get(a.id) ?? { gesamt: 0, offen: 0, gefunden: 0 }),
    }));
  }),

  // Auftrag + alle Positionen.
  details: pickupManage
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const auftrag = await prisma.pickupAuftrag.findUnique({
        where:   { id: input.id },
        include: {
          ersteller:    { select: { name: true, kuerzel: true } },
          abschliesser: { select: { name: true, kuerzel: true } },
          positionen:   { include: { finder: { select: { name: true, kuerzel: true } } } },
        },
      });
      if (!auftrag) throw new TRPCError({ code: "NOT_FOUND", message: "Pickup-Auftrag nicht gefunden" });
      return auftrag;
    }),

  // Auftrag aus importierten Positionen anlegen. Server-seitig nochmal nach
  // normalisiertem logId deduppen. Transaktional.
  erstellen: pickupManage
    .input(z.object({
      name:       z.string().trim().min(1).max(200),
      typ:        z.enum(["LOGID", "COLLI"]).default("LOGID"),
      bemerkung:  z.string().max(2000).optional(),
      positionen: z.array(positionInput).min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      const bemerkung = input.bemerkung?.trim() || null;

      const seen = new Set<string>();
      const positionen = input.positionen.flatMap((p) => {
        const logId = normalizeLogId(p.logId);
        if (!logId || seen.has(logId)) return [];
        seen.add(logId);
        return [{
          logId,
          colli:       p.colli?.trim()       || null,
          stellplatz:  p.stellplatz?.trim()  || null,
          bezeichnung: p.bezeichnung?.trim() || null,
          status:      "OFFEN" as const,
        }];
      });

      if (positionen.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Keine gültigen Positionen (LogId fehlt)" });
      }

      const auftrag = await prisma.$transaction(async (tx) => {
        const a = await tx.pickupAuftrag.create({
          data: { name: input.name.trim(), typ: input.typ, bemerkung, status: "offen", erstelltVon: user.id },
        });
        await tx.pickupPosition.createMany({
          data: positionen.map((p) => ({ ...p, auftragId: a.id })),
        });
        return a;
      });

      return { id: auftrag.id };
    }),

  // Bestehenden Auftrag per CSV aktualisieren (MERGE / Vereinigung). Die neuen
  // Positionen kommen vorgeparst (gleicher Mechanismus wie beim Anlegen, Typ-
  // Prüfung passiert im Frontend → leere Liste = passt nicht). Regeln:
  //   • Incoming matcht bestehende (gleicher logId) → bestehende KOMPLETT
  //     unverändert (Scan-/Fund-Status UND Daten bleiben).
  //   • Incoming ohne Match → neue, ungescannte Position (status OFFEN).
  //   • Bestehende, die nicht in der CSV ist → BEHALTEN (nichts wird entfernt).
  // Reine Scan-/Nachweis-Hilfe, KEIN Bestand-Effekt.
  auftragAktualisieren: pickupManage
    .input(z.object({
      auftragId:  z.number().int().positive(),
      positionen: z.array(positionInput).min(1),
    }))
    .mutation(async ({ input }) => {
      const stats = await prisma.$transaction(async (tx) => {
        const auftrag = await tx.pickupAuftrag.findUnique({
          where: { id: input.auftragId }, select: { id: true, status: true },
        });
        if (!auftrag) throw new TRPCError({ code: "NOT_FOUND", message: "Pickup-Auftrag nicht gefunden" });
        // Abgeschlossene/archivierte Aufträge nicht mehr ändern (Schutz auch ohne UI).
        if (auftrag.status !== "offen") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Auftrag ist abgeschlossen — kein CSV-Update möglich. Zum Ändern erst wieder öffnen.",
          });
        }

        const bestehende  = await tx.pickupPosition.findMany({
          where: { auftragId: input.auftragId }, select: { logId: true },
        });
        const vorhanden    = new Set(bestehende.map((p) => p.logId));
        const gesamtVorher = bestehende.length;

        // Incoming normalisieren + deduppen; Treffer auf Bestand zählen (nicht anlegen).
        const seen = new Set<string>();
        let bereitsVorhanden = 0;
        const neuePositionen = input.positionen.flatMap((p) => {
          const logId = normalizeLogId(p.logId);
          if (!logId || seen.has(logId)) return [];
          seen.add(logId);
          if (vorhanden.has(logId)) { bereitsVorhanden += 1; return []; } // bestehende bleibt unangetastet
          return [{
            auftragId:   input.auftragId,
            logId,
            colli:       p.colli?.trim()       || null,
            stellplatz:  p.stellplatz?.trim()  || null,
            bezeichnung: p.bezeichnung?.trim() || null,
            status:      "OFFEN" as const,
          }];
        });

        if (neuePositionen.length > 0) {
          await tx.pickupPosition.createMany({ data: neuePositionen });
        }

        return {
          neu:                neuePositionen.length,
          bereitsVorhanden,                                  // Incoming, die schon da waren
          nichtInCsvBehalten: gesamtVorher - bereitsVorhanden, // Bestand, der nicht in der CSV ist
          gesamtNachher:      gesamtVorher + neuePositionen.length,
        };
      });

      return stats;
    }),

  // Hartes Delete — Cascade räumt die Positionen.
  loeschen: pickupManage
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await prisma.pickupAuftrag.delete({ where: { id: input.id } });
      return { ok: true };
    }),

  // ── Picken (PICKUP_PICK) ──────────────────────────────────────────────────

  // Offene Aufträge für die Picker-Startseite (nur OFFENE, mit Zählern).
  offeneAuftraege: pickupPick.query(async () => {
    const auftraege = await prisma.pickupAuftrag.findMany({
      where:   { status: "offen" },
      orderBy: { createdAt: "desc" },
    });
    const ids = auftraege.map((a) => a.id);
    const counts = ids.length
      ? await prisma.pickupPosition.groupBy({
          by:     ["auftragId", "status"],
          where:  { auftragId: { in: ids } },
          _count: { _all: true },
        })
      : [];
    const zaehler = new Map<number, { gesamt: number; gefunden: number }>();
    for (const c of counts) {
      const e = zaehler.get(c.auftragId) ?? { gesamt: 0, gefunden: 0 };
      e.gesamt += c._count._all;
      if (c.status === "GEFUNDEN") e.gefunden += c._count._all;
      zaehler.set(c.auftragId, e);
    }
    return auftraege.map((a) => ({
      id:        a.id,
      name:      a.name,
      typ:       a.typ,
      bemerkung: a.bemerkung,
      createdAt: a.createdAt,
      ...(zaehler.get(a.id) ?? { gesamt: 0, gefunden: 0 }),
    }));
  }),

  // Auftrag + Positionen für die Scan-Ansicht (inkl. Finder-Name + gefundenAm).
  pickDetails: pickupPick
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const auftrag = await prisma.pickupAuftrag.findUnique({
        where:   { id: input.id },
        include: { positionen: { include: { finder: { select: { name: true, kuerzel: true } } } } },
      });
      if (!auftrag) throw new TRPCError({ code: "NOT_FOUND", message: "Pickup-Auftrag nicht gefunden" });
      const positionen = auftrag.positionen.map(shapePos);
      return {
        id:        auftrag.id,
        name:      auftrag.name,
        typ:       auftrag.typ,
        bemerkung: auftrag.bemerkung,
        status:    auftrag.status,
        createdAt: auftrag.createdAt,
        gesamt:    positionen.length,
        gefunden:  positionen.filter((p) => p.status === "GEFUNDEN").length,
        positionen,
      };
    }),

  // Ein Scan. EXAKTE LogID-Zuordnung (kein fuzzy). Kein Bestand-Effekt.
  scan: pickupPick
    .input(z.object({ auftragId: z.number().int().positive(), logIdRaw: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const user  = ctx.session.user as SessionUser;
      const logId = normalizeLogId(input.logIdRaw);
      if (!logId) return { result: "FREMD" as const, logId: "", position: null };

      const pos = await prisma.pickupPosition.findFirst({
        where:   { auftragId: input.auftragId, logId },
        include: { finder: { select: { name: true, kuerzel: true } } },
      });

      // Nicht auf dieser Liste → NICHTS in der DB ändern.
      if (!pos) return { result: "FREMD" as const, logId, position: null };

      // Schon gefunden → nur melden.
      if (pos.status === "GEFUNDEN") {
        return { result: "SCHON" as const, logId, position: shapePos(pos) };
      }

      // OFFEN → als GEFUNDEN persistieren.
      const updated = await prisma.pickupPosition.update({
        where:   { id: pos.id },
        data:    { status: "GEFUNDEN", gefundenVon: user.id, gefundenAm: new Date() },
        include: { finder: { select: { name: true, kuerzel: true } } },
      });
      void emitFortschritt(input.auftragId); // Admin-Live-Update (ohne Ton/Toast)
      return { result: "GEFUNDEN" as const, logId, position: shapePos(updated) };
    }),

  // Colli-Inhalt akustisch prüfen (nur LOGID-Aufträge). REIN LESEND — ändert
  // nichts in der DB, hakt nichts ab. Findet die LogIDs eines Collis aus den
  // Geräte-Reise-Daten (LogIdStand.colli ist gepunktet gespeichert → REPLACE)
  // und schneidet sie mit den OFFENEN Positionen des Auftrags.
  colliPruefen: pickupPick
    .input(z.object({ auftragId: z.number().int().positive(), colliNummer: z.string() }))
    .query(async ({ input }) => {
      const ziffern = nurZiffern(input.colliNummer);
      if (!ziffern) {
        return { colliZiffern: "", colliBekannt: false, treffer: [], anzahlTreffer: 0 };
      }

      // LogIDs in diesem Colli (Geräte-Reise-Snapshot). REPLACE entfernt die
      // Punkte der gespeicherten Colli-Nummer; ohne Index, aber nur gelegentlich.
      const imColli = await prisma.$queryRaw<Array<{ logId: string; bezeichnung: string | null }>>`
        SELECT logId, bezeichnung
        FROM \`LogIdStand\`
        WHERE REPLACE(colli, '.', '') = ${ziffern}`;

      const colliBekannt = imColli.length > 0;

      // Offene Positionen des Auftrags (logId = reine Ziffern).
      const offene = await prisma.pickupPosition.findMany({
        where:  { auftragId: input.auftragId, status: "OFFEN" },
        select: { logId: true, bezeichnung: true },
      });
      const offeneMap = new Map(offene.map((p) => [p.logId, p.bezeichnung]));

      // Schnitt: gesuchte (offene) LogIDs, die in diesem Colli liegen.
      const treffer: { logId: string; bezeichnung: string | null }[] = [];
      const seen = new Set<string>();
      for (const row of imColli) {
        const d = normalizeLogId(row.logId);
        if (!offeneMap.has(d) || seen.has(d)) continue;
        seen.add(d);
        treffer.push({ logId: d, bezeichnung: row.bezeichnung ?? offeneMap.get(d) ?? null });
      }

      return { colliZiffern: ziffern, colliBekannt, treffer, anzahlTreffer: treffer.length };
    }),

  // Hauptcolli-Vorabscan: kompakte Wagen-Karte. REIN LESEND, KEIN Status-/Bestand-
  // Effekt. Liefert (a) alle bekannten Hauptcollis + Stellplatz (Wagen-Erkennung)
  // und (b) die Zuordnung Karton(=Untercolli)→hauptcolli NUR für die Positionen
  // dieses Auftrags. Das Frontend erkennt Hauptcolli-Scans damit lokal und rechnet
  // die Treffer aus dem Live-Zustand (kein Roundtrip pro Scan).
  // Gilt für LOGID- UND COLLI-Aufträge — der Picker scannt vorne am Wagen zuerst
  // den Hauptcolli (Reihenfolge: Hauptcolli → Karton/Colli → LogID).
  wagenKarte: pickupPick
    .input(z.object({ auftragId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const auftrag = await prisma.pickupAuftrag.findUnique({
        where:  { id: input.auftragId },
        select: { typ: true, positionen: { select: { logId: true, colli: true } } },
      });
      if (!auftrag) return { hauptcollis: [], zuordnung: [] };

      // (a) Alle bekannten Hauptcollis + Stellplatz (ein Eintrag je Hauptcolli;
      //     der ganze Wagen liegt an einem Stellplatz).
      const wagen = await prisma.lagerwagen.findMany({
        distinct: ["hauptcolli"],
        select:   { hauptcolli: true, stellplatz: true },
      });

      // (b) Karton-(Untercolli-)Schlüssel je Position — bei LOGID-Aufträgen über
      //     das Colli-Feld (= Karton, NICHT die LogID!), bei COLLI-Aufträgen über
      //     logId (= Untercolli). Beide via nurZiffern, Join gegen Lagerwagen.
      const kartons = [...new Set(
        auftrag.positionen
          .map((p) => (auftrag.typ === "COLLI" ? nurZiffern(p.logId) : nurZiffern(p.colli ?? "")))
          .filter((d) => d.length > 0),
      )];
      const zuordnung = kartons.length
        ? await prisma.lagerwagen.findMany({
            where:  { untercolli: { in: kartons } },
            select: { untercolli: true, hauptcolli: true },
          })
        : [];

      return {
        hauptcollis: wagen.map((w) => ({ hauptcolli: w.hauptcolli, stellplatz: w.stellplatz })),
        zuordnung:   zuordnung.map((r) => ({ untercolli: r.untercolli, hauptcolli: r.hauptcolli })),
      };
    }),

  // Versehentlichen Treffer zurücksetzen: GEFUNDEN → OFFEN.
  treffersZuruecksetzen: pickupPick
    .input(z.object({ positionId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const pos = await prisma.pickupPosition.update({
        where: { id: input.positionId },
        data:  { status: "OFFEN", gefundenVon: null, gefundenAm: null },
      });
      void emitFortschritt(pos.auftragId); // Admin-Live-Update
      return { ok: true };
    }),

  // Auftrag abschließen (PICKUP_PICK). Idempotent: schon abgeschlossen → nur
  // aktuellen Stand zurück. Meldet Admins per Socket. Kein Bestand-Effekt.
  abschliessen: pickupPick
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const user    = ctx.session.user as SessionUser;
      const auftrag = await prisma.pickupAuftrag.findUnique({ where: { id: input.id } });
      if (!auftrag) throw new TRPCError({ code: "NOT_FOUND", message: "Pickup-Auftrag nicht gefunden" });

      const positionen    = await prisma.pickupPosition.findMany({ where: { auftragId: input.id }, select: { status: true } });
      const gesamt        = positionen.length;
      const gefunden      = positionen.filter((p) => p.status === "GEFUNDEN").length;
      const nichtGefunden = gesamt - gefunden;
      const zusammenfassung = { name: auftrag.name, gesamt, gefunden, nichtGefunden };

      // Idempotent
      if (auftrag.status === "abgeschlossen") {
        return { ...zusammenfassung, schonAbgeschlossen: true };
      }

      await prisma.pickupAuftrag.update({
        where: { id: input.id },
        data:  { status: "abgeschlossen", abgeschlossenAm: new Date(), abgeschlossenVon: user.id },
      });

      // Admin-Meldung (gleiche Schiene wie neue Anfrage) + Live-Update
      emitToAdmins(EVENTS.PICKUP_ABGESCHLOSSEN, { id: input.id, name: auftrag.name, gesamt, gefunden, nichtGefunden });
      void emitFortschritt(input.id);

      return { ...zusammenfassung, schonAbgeschlossen: false };
    }),

  // Auftrag wieder öffnen (nur Admin / PICKUP_MANAGE) — für Korrekturen.
  wiederOeffnen: pickupManage
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await prisma.pickupAuftrag.update({
        where: { id: input.id },
        data:  { status: "offen", abgeschlossenAm: null, abgeschlossenVon: null },
      });
      void emitFortschritt(input.id); // Admin-Live-Update (zurück ins offene Archiv)
      return { ok: true };
    }),
});

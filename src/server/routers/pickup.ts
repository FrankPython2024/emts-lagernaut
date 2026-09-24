import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";
import type { SessionUser } from "@/core/types";
import { normalizeLogId, formatLogId } from "@/lib/pickup/logId";
import { planeRest, restName, type LagerfuchsStand } from "@/lib/pickup/restAuftrag";
import { bereinigePositionsFelder } from "@/lib/pickup/position";
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
  vermisstAm?: Date | null;
  vermisser?: { name: string; kuerzel: string } | null;
};
const MIT_PERSONEN = {
  finder:    { select: { name: true, kuerzel: true } },
  vermisser: { select: { name: true, kuerzel: true } },
} as const;
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
    vermisstAm:      p.vermisstAm ?? null,
    vermisstVonName: p.vermisser?.kuerzel ?? p.vermisser?.name ?? null,
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

// Guard: lädt den Auftrag und stellt sicher, dass er OFFEN ist. Wirft sonst.
// Schützt Scan-/Treffer-Mutationen davor, abgeschlossene Aufträge zu verändern —
// serverseitig erzwungen, nicht nur per Frontend angenommen.
async function ladeOffenenAuftragOderWirf(auftragId: number): Promise<void> {
  const auftrag = await prisma.pickupAuftrag.findUnique({
    where: { id: auftragId }, select: { status: true },
  });
  if (!auftrag) throw new TRPCError({ code: "NOT_FOUND", message: "Pickup-Auftrag nicht gefunden" });
  if (auftrag.status !== "offen") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Auftrag ist abgeschlossen — keine Änderung möglich",
    });
  }
}

// „Rest übernehmen": offene Positionen des Auftrags + Lagerfuchs-Stand je LogID.
// Der Lagerfuchs schreibt LogIDs MIT Punkten („212.652.351"), der Pickup ohne —
// deshalb wird nach beiden Schreibweisen gesucht und über die Ziffern verbunden.
async function ladeRestPlan(id: number, ohneAusgeschiedene: boolean, ortAktualisieren: boolean) {
  const auftrag = await prisma.pickupAuftrag.findUnique({
    where:  { id },
    select: {
      id: true, name: true, typ: true, status: true, createdAt: true,
      positionen: { where: { status: "OFFEN" }, select: { logId: true, colli: true, stellplatz: true, bezeichnung: true } },
    },
  });
  if (!auftrag) throw new TRPCError({ code: "NOT_FOUND", message: "Pickup-Auftrag nicht gefunden" });

  const stand = new Map<string, LagerfuchsStand>();
  // Colli-Aufträge führen Colli-Nummern, keine Geräte — der Lagerfuchs hilft dort nicht.
  if (auftrag.typ === "LOGID" && auftrag.positionen.length > 0) {
    const schluessel = [...new Set(auftrag.positionen.flatMap((p) => {
      const d = nurZiffern(p.logId);
      return d ? [d, formatLogId(d)] : [];
    }))];
    for (let i = 0; i < schluessel.length; i += 1000) {
      const rows = await prisma.logIdStand.findMany({
        where:  { logId: { in: schluessel.slice(i, i + 1000) } },
        select: { logId: true, stellplatz: true, colli: true, zuletztGesehen: true, ausgeschieden: true, ausgeschiedenAm: true },
      });
      for (const row of rows) stand.set(nurZiffern(row.logId), row);
    }
  }
  const plan = planeRest({
    positionen: auftrag.positionen, stand, auftragAngelegt: auftrag.createdAt, ohneAusgeschiedene, ortAktualisieren,
  });
  const letzterImport = await prisma.logIdImport.findFirst({
    where:   { status: "fertig", typ: "LAGERFUCHS" },
    orderBy: { importiertAm: "desc" },
    select:  { importiertAm: true },
  });
  return { auftrag, plan, lagerfuchsStand: letzterImport?.importiertAm ?? null };
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

    // Ordnung (Paket 4, 24.09.2026): Geräte, die gleichzeitig in MEHREREN offenen
    // Aufträgen stehen (am 23.09. 114 LogIDs in #168 und #183), und als „nicht da"
    // gemeldete Positionen — beides braucht jemanden im Büro.
    const offeneIds = auftraege.filter((a) => a.status === "offen").map((a) => a.id);
    const offenPos = offeneIds.length
      ? await prisma.pickupPosition.findMany({
          where:  { auftragId: { in: offeneIds }, status: "OFFEN" },
          select: { auftragId: true, logId: true },
        })
      : [];
    const auftraegeJeLogId = new Map<string, Set<number>>();
    for (const x of offenPos) {
      const set = auftraegeJeLogId.get(x.logId) ?? new Set<number>();
      set.add(x.auftragId);
      auftraegeJeLogId.set(x.logId, set);
    }
    const doppelt = new Map<number, number>();
    for (const x of offenPos) {
      if ((auftraegeJeLogId.get(x.logId)?.size ?? 0) > 1) doppelt.set(x.auftragId, (doppelt.get(x.auftragId) ?? 0) + 1);
    }
    const vermisst = await prisma.pickupPosition.groupBy({
      by:     ["auftragId"],
      where:  { status: "OFFEN", vermisstAm: { not: null } },
      _count: { _all: true },
    });
    const vermisstJe = new Map(vermisst.map((v) => [v.auftragId, v._count._all]));

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
      doppelt:         doppelt.get(a.id) ?? 0,
      vermisst:        vermisstJe.get(a.id) ?? 0,
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
          positionen:   { include: MIT_PERSONEN },
        },
      });
      if (!auftrag) throw new TRPCError({ code: "NOT_FOUND", message: "Pickup-Auftrag nicht gefunden" });
      return auftrag;
    }),

  // Auftrag aus importierten Positionen anlegen. Server-seitig nochmal nach
  // normalisiertem logId deduppen. Transaktional.
  /**
   * Welche dieser LogIDs stehen schon auf einem OFFENEN Auftrag?
   *
   * Der Technik-Export wird immer wieder neu eingelesen. Ohne diese Prüfung
   * stünde ein Gerät, das beim letzten Import schon eingeplant war, beim
   * nächsten Mal ein zweites Mal auf einer Abholliste — und jemand liefe
   * hinterher, obwohl es längst auf dem Wagen liegt.
   *
   * Abgeschlossene Aufträge zählen bewusst NICHT: Was dort steht, ist erledigt,
   * und wenn ein Gerät wieder im Export auftaucht, gehört es wieder abgeholt.
   */
  bereitsOffen: pickupManage
    .input(z.object({ logIds: z.array(z.string()).min(1).max(5000) }))
    .query(async ({ input }) => {
      const gesucht = [...new Set(input.logIds.map(normalizeLogId).filter(Boolean))];
      if (gesucht.length === 0) return { treffer: [] };

      const rows = await prisma.pickupPosition.findMany({
        where:  { logId: { in: gesucht }, auftrag: { status: "offen" } },
        select: { logId: true, status: true, auftrag: { select: { id: true, name: true } } },
      });

      return {
        treffer: rows.map((r) => ({
          logId:      r.logId,
          auftragId:  r.auftrag.id,
          auftrag:    r.auftrag.name,
          // GEFUNDEN heißt: liegt schon auf dem Wagen. OFFEN heißt: eingeplant,
          // aber noch nicht geholt. Beides ist ein Grund, nicht neu einzuplanen.
          schonGefunden: r.status === "GEFUNDEN",
        })),
      };
    }),

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
          ...bereinigePositionsFelder(p),
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
            ...bereinigePositionsFelder(p),
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
      include: { ersteller: { select: { name: true, kuerzel: true } } },
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
    // Für die Picker-Liste: Wie viel Weg steckt drin? (Plätze mit noch zu Suchendem)
    const zuSuchen = ids.length
      ? await prisma.pickupPosition.findMany({
          where:  { auftragId: { in: ids }, status: "OFFEN", vermisstAm: null },
          select: { auftragId: true, stellplatz: true },
        })
      : [];
    const plaetze = new Map<number, Set<string>>();
    for (const x of zuSuchen) {
      const set = plaetze.get(x.auftragId) ?? new Set<string>();
      set.add(x.stellplatz ?? "");
      plaetze.set(x.auftragId, set);
    }
    return auftraege.map((a) => ({
      id:         a.id,
      name:       a.name,
      typ:        a.typ,
      // Die automatische Technik-Bemerkung ist Büro-Wissen, nicht für den Picker.
      bemerkung:  a.bemerkung?.startsWith("Automatisch aus dem Technik-Export") ? null : a.bemerkung,
      createdAt:  a.createdAt,
      ersteller:  a.ersteller?.kuerzel ?? a.ersteller?.name ?? null,
      plaetze:    plaetze.get(a.id)?.size ?? 0,
      ...(zaehler.get(a.id) ?? { gesamt: 0, gefunden: 0 }),
    }));
  }),

  // Auftrag + Positionen für die Scan-Ansicht (inkl. Finder-Name + gefundenAm).
  pickDetails: pickupPick
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const auftrag = await prisma.pickupAuftrag.findUnique({
        where:   { id: input.id },
        include: { positionen: { include: MIT_PERSONEN } },
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
      // Guard: nur offene Aufträge dürfen gescannt werden (abgeschlossene → Fehler).
      await ladeOffenenAuftragOderWirf(input.auftragId);

      const logId = normalizeLogId(input.logIdRaw);
      if (!logId) return { result: "FREMD" as const, logId: "", position: null };

      const pos = await prisma.pickupPosition.findFirst({
        where:   { auftragId: input.auftragId, logId },
        include: MIT_PERSONEN,
      });

      // Nicht auf dieser Liste → NICHTS in der DB ändern.
      if (!pos) return { result: "FREMD" as const, logId, position: null };

      // ⚠️ Die Scan-Seite entscheidet seit 24.09.2026 selbst (src/lib/pickup/
      // scanAuswertung.ts) und schickt Funde über eine Warteschlange mit
      // Wiederholung. Ging nur die ANTWORT verloren, kommt derselbe Scan erneut —
      // das ist dann kein „schon gefunden", sondern der eigene Fund. Wer die
      // Position selbst gebucht hat, bekommt deshalb GEFUNDEN zurück.
      if (pos.status === "GEFUNDEN") {
        const eigener = pos.gefundenVon === user.id;
        return { result: eigener ? ("GEFUNDEN" as const) : ("SCHON" as const), logId, position: shapePos(pos) };
      }

      // OFFEN → GEFUNDEN, aber NUR, wenn sie in diesem Moment noch offen ist.
      // Vorher: lesen, dann bedingungslos schreiben — scannten zwei Picker dasselbe
      // Gerät gleichzeitig, galt es für beide als gefunden, der Letzte gewann.
      // Ein Fund hebt ein früheres „Colli nicht da" auf — das Gerät ist ja da.
      const { count } = await prisma.pickupPosition.updateMany({
        where: { id: pos.id, status: "OFFEN" },
        data:  { status: "GEFUNDEN", gefundenVon: user.id, gefundenAm: new Date(), vermisstAm: null, vermisstVon: null },
      });
      const aktuell = await prisma.pickupPosition.findUniqueOrThrow({
        where:   { id: pos.id },
        include: MIT_PERSONEN,
      });
      if (count === 0) {
        const eigener = aktuell.gefundenVon === user.id;
        return { result: eigener ? ("GEFUNDEN" as const) : ("SCHON" as const), logId, position: shapePos(aktuell) };
      }
      void emitFortschritt(input.auftragId); // Admin-Live-Update (ohne Ton/Toast)
      return { result: "GEFUNDEN" as const, logId, position: shapePos(aktuell) };
    }),

  // ⚠️ Seit 24.09.2026 von der Scan-Seite NICHT mehr aufgerufen: Die Prüfung läuft
  // auf dem Gerät (`werteScanAus` in src/lib/pickup/scanAuswertung.ts) mit genau
  // dieser Regel — ohne Netz und ohne den 30-s-Cache, der alte Treffer zeigte.
  // Wer die Regel hier ändert, muss sie dort mitziehen.
  // Colli-Inhalt akustisch prüfen (nur LOGID-Aufträge). REIN LESEND — ändert nichts
  // in der DB, hakt nichts ab. Quelle sind AUSSCHLIESSLICH die Positionen des Auftrags
  // (deren Colli-Nr aus der beim Auftrag frisch gezogenen CSV = aktueller Standort).
  // Der Geräte-Reise-Snapshot (LogIdStand) wird bewusst NICHT herangezogen — andere
  // Datenquelle, die auseinanderlaufen kann.
  colliPruefen: pickupPick
    .input(z.object({ auftragId: z.number().int().positive(), colliNummer: z.string() }))
    .query(async ({ input }) => {
      const ziffern = nurZiffern(input.colliNummer);
      if (!ziffern) {
        return { colliZiffern: "", colliBekannt: false, treffer: [], anzahlTreffer: 0 };
      }

      // Maßgeblich sind AUSSCHLIESSLICH die Positionen dieses Auftrags. Deren Colli-Nr
      // stammt aus der beim Auftrag frisch (live) gezogenen CSV = aktueller Standort.
      // Der Geräte-Reise-Snapshot (LogIdStand) ist eine ANDERE Datenquelle und spielt
      // hier bewusst KEINE Rolle — er lief zuvor auseinander (Umpacken), was fälschlich
      // 0 Treffer erzeugte, obwohl der Auftrag den Colli klar führt.
      const alle = await prisma.pickupPosition.findMany({
        where:  { auftragId: input.auftragId },
        select: { logId: true, colli: true, bezeichnung: true, status: true },
      });

      // Positionen, deren eigene Colli-Nr dem Scan entspricht (Punkte ignoriert).
      const imColli = alle.filter((p) => nurZiffern(p.colli ?? "") === ziffern);
      // „Bekannt" = dieser Colli gehört überhaupt zum Auftrag (auch wenn alles darin
      // schon gefunden ist → „kein gesuchtes Gerät drin" statt „unbekannt").
      const colliBekannt = imColli.length > 0;

      // Treffer = noch OFFENE Positionen in diesem Colli, über die LogID dedupliziert.
      const treffer: { logId: string; bezeichnung: string | null }[] = [];
      const seen = new Set<string>();
      for (const p of imColli) {
        if (p.status !== "OFFEN") continue;
        const d = normalizeLogId(p.logId);
        if (seen.has(d)) continue;
        seen.add(d);
        treffer.push({ logId: d, bezeichnung: p.bezeichnung });
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

  // „Colli nicht da": Der Picker steht am Platz, der Karton fehlt. Markiert die
  // OFFENEN Positionen (nie gefundene) als vermisst — Status bleibt OFFEN, die
  // Wegführung geht zum nächsten Halt, das Büro sieht sie in der Klärliste.
  // Vorbild: „Pick Denial" in SAP EWM — ein Tipp, keine Pflicht-Texteingabe.
  nichtDa: pickupPick
    .input(z.object({
      auftragId:   z.number().int().positive(),
      positionIds: z.array(z.number().int().positive()).min(1).max(500),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      await ladeOffenenAuftragOderWirf(input.auftragId);
      const { count } = await prisma.pickupPosition.updateMany({
        where: { id: { in: input.positionIds }, auftragId: input.auftragId, status: "OFFEN" },
        data:  { vermisstAm: new Date(), vermisstVon: user.id },
      });
      void emitFortschritt(input.auftragId);
      return { count };
    }),

  // Rückgängig für „nicht da" (Fehltipp, oder der Karton ist doch aufgetaucht).
  nichtDaZuruecknehmen: pickupPick
    .input(z.object({
      auftragId:   z.number().int().positive(),
      positionIds: z.array(z.number().int().positive()).min(1).max(500),
    }))
    .mutation(async ({ input }) => {
      await ladeOffenenAuftragOderWirf(input.auftragId);
      const { count } = await prisma.pickupPosition.updateMany({
        where: { id: { in: input.positionIds }, auftragId: input.auftragId },
        data:  { vermisstAm: null, vermisstVon: null },
      });
      void emitFortschritt(input.auftragId);
      return { count };
    }),

  // Versehentlichen Treffer zurücksetzen: GEFUNDEN → OFFEN.
  treffersZuruecksetzen: pickupPick
    .input(z.object({ positionId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      // Position laden, um den Auftrag zu ermitteln, dann Offen-Guard.
      const ziel = await prisma.pickupPosition.findUnique({
        where: { id: input.positionId }, select: { auftragId: true },
      });
      if (!ziel) throw new TRPCError({ code: "NOT_FOUND", message: "Position nicht gefunden" });
      await ladeOffenenAuftragOderWirf(ziel.auftragId);

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

  // „Rest in neuen Auftrag übernehmen" — Vorschau: was käme mit, was nicht?
  restVorschau: pickupManage
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const { auftrag, plan, lagerfuchsStand } = await ladeRestPlan(input.id, true, true);
      return {
        name:            auftrag.name,
        typ:             auftrag.typ,
        status:          auftrag.status,
        vorschlagName:   restName(auftrag.name),
        offen:           auftrag.positionen.length,
        uebernehmen:     plan.uebernehmen.length,
        umgezogen:       plan.umgezogen,
        unbekannt:       plan.unbekannt,
        ausgeschieden:   plan.ausgeschieden.length,
        ausgeschiedenBeispiele: plan.ausgeschieden.slice(0, 20),
        lagerfuchsStand,
      };
    }),

  // Rest übernehmen: neuer Auftrag mit den offenen Positionen, alter wird
  // abgeschlossen — in EINER Transaktion, damit nie beide offen sind (genau das
  // war das Problem: 114 LogIDs gleichzeitig in #168 und #183).
  restUebernehmen: pickupManage
    .input(z.object({
      id:                 z.number().int().positive(),
      name:               z.string().trim().min(1).max(200),
      ohneAusgeschiedene: z.boolean(),
      ortAktualisieren:   z.boolean(),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user as SessionUser;
      const { auftrag, plan } = await ladeRestPlan(input.id, input.ohneAusgeschiedene, input.ortAktualisieren);
      if (plan.uebernehmen.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Nichts zu übernehmen — es ist kein Gerät mehr offen." });
      }
      const neu = await prisma.$transaction(async (tx) => {
        const a = await tx.pickupAuftrag.create({
          data: {
            name: input.name.trim(), typ: auftrag.typ, status: "offen", erstelltVon: user.id,
            bemerkung: `Rest aus „${auftrag.name}" (#${auftrag.id})`,
          },
        });
        await tx.pickupPosition.createMany({
          data: plan.uebernehmen.map((p) => ({
            auftragId: a.id,
            logId:     p.logId,
            ...bereinigePositionsFelder(p),
            status:    "OFFEN",
          })),
        });
        if (auftrag.status === "offen") {
          await tx.pickupAuftrag.update({
            where: { id: auftrag.id },
            data:  { status: "abgeschlossen", abgeschlossenAm: new Date(), abgeschlossenVon: user.id },
          });
        }
        return a;
      }, { timeout: 30_000 });
      void emitFortschritt(auftrag.id);
      void emitFortschritt(neu.id);
      return {
        id:          neu.id,
        anzahl:      plan.uebernehmen.length,
        umgezogen:   input.ortAktualisieren ? plan.umgezogen : 0,
        ausgelassen: input.ohneAusgeschiedene ? plan.ausgeschieden.length : 0,
      };
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

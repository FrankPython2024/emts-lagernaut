import { z } from "zod";
import { Prisma } from "@prisma/client";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { nichtUmlagerungSql } from "@/lib/buchungen/umlagerung";

// ── Kategorie-Preise (Laptop-Ersatzteile) ───────────────────────────────────
// Laptop-Artikel haben keinen eigenen Preis. Hier wird ein Stückpreis je
// Artikel-Kategorie gepflegt (Tabelle KategoriePreis). Die Kategorie-Liste
// kommt LIVE aus der Artikel-Tabelle, damit sie immer der echten DB entspricht.
//
// Lesen:  ARTIKEL_VIEW   ·  Schreiben: ARTIKEL_EDIT
// Auswertung „Wert ausgegeben": STATISTIK_VIEW
// (bewusst keine neuen Permissions → kein seed-rbac-Lauf nötig)

// Prisma.Decimal / BigInt (SUM) / String ($queryRaw) → plain number.
// superjson serialisiert Decimal nicht sinnvoll; $queryRaw liefert SUM als
// BigInt oder String je nach Treiber.
function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "bigint") return Number(v);
  return typeof v === "number" ? v : Number(v);
}

const MS_PRO_TAG = 24 * 60 * 60 * 1000;

// Pauschale für erledigte Sonderanfragen ohne manuell gesetzten Wert (`sonderWert`).
// Bewusst niedrig — nur damit „alles erfasst" ist; genaue Werte per Admin-Review.
const SONDER_PAUSCHALE = 5;

export const preiseRouter = createTRPCRouter({

  // Alle Artikel-Kategorien (live) mit Artikel-Anzahl + ggf. hinterlegtem Preis.
  // Sortiert nach Anzahl absteigend (die großen Kategorien zuerst).
  kategorienMitPreis: permissionProcedure("ARTIKEL_VIEW").query(async ({ ctx }) => {
    const [gruppen, preise] = await Promise.all([
      ctx.prisma.artikel.groupBy({
        by:      ["kategorie"],
        _count:  { _all: true },
      }),
      ctx.prisma.kategoriePreis.findMany(),
    ]);

    const preisMap = new Map(preise.map((p) => [p.kategorie, num(p.preis)]));

    return gruppen
      .filter((g) => g.kategorie != null && g.kategorie.trim() !== "")
      .map((g) => ({
        kategorie: g.kategorie,
        anzahl:    g._count._all,
        preis:     preisMap.get(g.kategorie) ?? null,
      }))
      .sort((a, b) => b.anzahl - a.anzahl || a.kategorie.localeCompare(b.kategorie, "de"));
  }),

  // Preise setzen/ändern/entfernen. preis = null → Eintrag löschen (kein Preis).
  // Idempotenter Upsert je Kategorie in einer Transaktion.
  setzePreise: permissionProcedure("ARTIKEL_EDIT")
    .input(z.object({
      eintraege: z.array(z.object({
        kategorie: z.string().min(1).max(191),
        preis:     z.number().min(0).max(1_000_000).nullable(),
      })).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      let gespeichert = 0;
      let geloescht   = 0;

      await ctx.prisma.$transaction(async (tx) => {
        for (const e of input.eintraege) {
          const kategorie = e.kategorie.trim();
          if (!kategorie) continue;

          if (e.preis == null) {
            const res = await tx.kategoriePreis.deleteMany({ where: { kategorie } });
            geloescht += res.count;
          } else {
            await tx.kategoriePreis.upsert({
              where:  { kategorie },
              update: { preis: e.preis },
              create: { kategorie, preis: e.preis },
            });
            gespeichert++;
          }
        }
      });

      return { gespeichert, geloescht };
    }),

  // Auswertung „Wert ausgegeben über Anfragen": Summe menge × Kategorie-Preis
  // über die echten Ausgabe-Buchungen (AUSGANG + DIREKT/BEDARF), gejoint
  // Buchung→Artikel(kategorie)→KategoriePreis. Kategorien ohne hinterlegten
  // Preis werden separat ausgewiesen (zählen NICHT in die Summe).
  //
  // Folgt demselben tage-/standortId-Filter wie die übrige Statistik-Seite.
  // tage = null/0 → alle Buchungen (Gesamt). standortId = null → alle Standorte.
  //
  // Hinweis: Buchung speichert keinen Preis-Snapshot → bewertet wird mit dem
  // AKTUELLEN Kategorie-Preis. Ändert sich ein Preis, ändert sich rückwirkend
  // auch der ausgewiesene Vergangenheitswert (für groben Überblick ok).
  wertAusgegeben: permissionProcedure("STATISTIK_VIEW")
    .input(z.object({
      tage:       z.number().int().positive().nullable().optional(),
      standortId: z.number().int().positive().nullable().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const tage       = input?.tage ?? null;
      const standortId = input?.standortId ?? null;
      const cutoff     = tage ? new Date(Date.now() - tage * MS_PRO_TAG) : null;

      const datumFilter    = cutoff     ? Prisma.sql`AND b.datum >= ${cutoff}`     : Prisma.empty;
      const standortFilter = standortId ? Prisma.sql`AND a.standortId = ${standortId}` : Prisma.empty;

      const rows = await ctx.prisma.$queryRaw<
        { kategorie: string | null; menge: unknown; preis: unknown }[]
      >(Prisma.sql`
        SELECT a.kategorie AS kategorie,
               SUM(b.menge) AS menge,
               kp.preis     AS preis
        FROM Buchung b
        JOIN Artikel a       ON a.id = b.artikelId
        LEFT JOIN KategoriePreis kp ON kp.kategorie = a.kategorie
        WHERE b.typ IN ('AUSGANG', 'DIREKT') ${nichtUmlagerungSql("b")} ${datumFilter} ${standortFilter}
        GROUP BY a.kategorie, kp.preis
        ORDER BY a.kategorie
      `);

      const proKategorie: { kategorie: string; menge: number; preis: number; wert: number }[] = [];
      const ohnePreis:    { kategorie: string; menge: number }[] = [];
      let gesamt = 0;
      let mengeGesamt = 0;

      for (const r of rows) {
        const kategorie = r.kategorie?.trim() || "(ohne Kategorie)";
        const menge     = num(r.menge);
        mengeGesamt += menge;
        if (r.preis == null) {
          ohnePreis.push({ kategorie, menge });
        } else {
          const preis = num(r.preis);
          const wert  = Math.round(menge * preis * 100) / 100;
          gesamt += wert;
          proKategorie.push({ kategorie, menge, preis, wert });
        }
      }

      proKategorie.sort((a, b) => b.wert - a.wert);
      ohnePreis.sort((a, b) => b.menge - a.menge);

      const teileWert = Math.round(gesamt * 100) / 100;

      // ── Sonderanfragen (kein Lagerartikel → keine Kategorie/Preis) ────────────
      // Erledigte Sonderanfragen (ohne Test) im Zeitraum: Wert = sonderWert ?? Pauschale.
      // Sonderanfragen sind NICHT standort-gebunden → nur bei „alle Standorte" (kein
      // standortId-Filter) einbezogen, um einen einzelnen Standort nicht zu verfälschen.
      let sonderAnzahl = 0, sonderBewertet = 0, sonderWertSumme = 0;
      if (!standortId) {
        const sonder = await ctx.prisma.anfrage.findMany({
          where: {
            istSonderAnfrage: true,
            testModus:        false,
            status:           "ABGESCHLOSSEN",
            ...(cutoff ? { datum: { gte: cutoff } } : {}),
          },
          select: { sonderWert: true },
        });
        sonderAnzahl = sonder.length;
        for (const s of sonder) {
          if (s.sonderWert != null) { sonderWertSumme += num(s.sonderWert); sonderBewertet++; }
          else                        sonderWertSumme += SONDER_PAUSCHALE;
        }
        sonderWertSumme = Math.round(sonderWertSumme * 100) / 100;
      }

      return {
        // Gesamt-Wert inkl. Sonderanfragen (Antwort auf „was bringt das eigentlich").
        gesamt:      Math.round((teileWert + sonderWertSumme) * 100) / 100,
        teileWert,        // nur Katalog-Ersatzteile (menge × Kategorie-Preis)
        mengeGesamt,      // Anzahl ausgegebener Katalog-Teile
        proKategorie,
        ohnePreis,
        sonderanfragen: {
          anzahl:    sonderAnzahl,
          bewertet:  sonderBewertet,                 // davon mit manuellem Wert
          pauschal:  sonderAnzahl - sonderBewertet,  // Rest zählt mit Pauschale
          pauschale: SONDER_PAUSCHALE,
          wert:      sonderWertSumme,
        },
      };
    }),

  // ── Auswertung „Bauteil-Ernte" ──────────────────────────────────────────────
  // Was wurde aus welchen Spender-Altgeräten gewonnen — und was ist es wert?
  // Basis: EINGANG-Buchungen MIT herkunftLogId (nur die kommen aus dem
  // Einlager-Assistenten mit gescanntem Spendergerät). Bewertung wie bei
  // `wertAusgegeben` über den Kategorie-Preis des Artikels.
  //
  // WICHTIG: Erst ab Einführung des Feldes gefüllt — ältere Einlagerungen haben
  // keine Herkunft (die gescannte LogID wurde vorher nicht gespeichert). Die
  // Auswertung zeigt deshalb bewusst NUR Buchungen mit Herkunft und weist die
  // Anzahl der Einlagerungen ohne Herkunft separat aus.
  wertGeerntet: permissionProcedure("STATISTIK_VIEW")
    .input(z.object({
      tage:       z.number().int().positive().nullable().optional(),
      standortId: z.number().int().positive().nullable().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const tage       = input?.tage ?? null;
      const standortId = input?.standortId ?? null;
      const cutoff     = tage ? new Date(Date.now() - tage * MS_PRO_TAG) : null;

      const datumFilter    = cutoff     ? Prisma.sql`AND b.datum >= ${cutoff}`         : Prisma.empty;
      const standortFilter = standortId ? Prisma.sql`AND a.standortId = ${standortId}` : Prisma.empty;

      // 1) Je Kategorie: geerntete Menge + Preis (für den Wert)
      const rows = await ctx.prisma.$queryRaw<
        { kategorie: string | null; menge: unknown; preis: unknown }[]
      >(Prisma.sql`
        SELECT a.kategorie AS kategorie,
               SUM(b.menge) AS menge,
               kp.preis     AS preis
        FROM Buchung b
        JOIN Artikel a              ON a.id = b.artikelId
        LEFT JOIN KategoriePreis kp ON kp.kategorie = a.kategorie
        WHERE b.typ = 'EINGANG' AND b.herkunftLogId IS NOT NULL
          ${datumFilter} ${standortFilter}
        GROUP BY a.kategorie, kp.preis
        ORDER BY a.kategorie
      `);

      // 2) Kennzahlen: wie viele verschiedene Spendergeräte, wie viele Einlagerungen
      //    ohne Herkunft (Alt-Daten bzw. Einlagern ohne LogID-Scan).
      const [kopf] = await ctx.prisma.$queryRaw<
        { geraete: unknown; mitHerkunft: unknown; ohneHerkunft: unknown }[]
      >(Prisma.sql`
        SELECT COUNT(DISTINCT b.herkunftLogId)                        AS geraete,
               SUM(CASE WHEN b.herkunftLogId IS NOT NULL THEN 1 ELSE 0 END) AS mitHerkunft,
               SUM(CASE WHEN b.herkunftLogId IS NULL     THEN 1 ELSE 0 END) AS ohneHerkunft
        FROM Buchung b
        JOIN Artikel a ON a.id = b.artikelId
        WHERE b.typ = 'EINGANG' ${datumFilter} ${standortFilter}
      `);

      // 3) Top-Spendermodelle: LogID über den Geräte-Lookup zum Modellnamen auflösen.
      const topModelle = await ctx.prisma.$queryRaw<
        { modell: string | null; geraete: unknown; teile: unknown }[]
      >(Prisma.sql`
        SELECT COALESCE(g.bereinigt, '(Modell unbekannt)')  AS modell,
               COUNT(DISTINCT b.herkunftLogId)              AS geraete,
               SUM(b.menge)                                 AS teile
        FROM Buchung b
        JOIN Artikel a          ON a.id = b.artikelId
        LEFT JOIN GeraeteLookup g ON g.logId = b.herkunftLogId
        WHERE b.typ = 'EINGANG' AND b.herkunftLogId IS NOT NULL
          ${datumFilter} ${standortFilter}
        GROUP BY modell
        ORDER BY teile DESC
        LIMIT 10
      `);

      // 4) ALTDATEN (vor Einführung der Herkunfts-Erfassung): Der Gerätename steht
      //    in der Buchungs-Notiz („… | Gerät: HP EliteBook 840 G5 | …"). Damit ist
      //    rückwirkend nur die MODELL-Ebene rekonstruierbar — NICHT, aus wie vielen
      //    einzelnen Geräten die Teile stammen. Deshalb bewusst getrennt gehalten
      //    und ohne „Teile je Gerät": Eine Buchung kann eine Sammel-Einlagerung sein.
      const altModelle = await ctx.prisma.$queryRaw<
        { modell: string | null; buchungen: unknown; teile: unknown }[]
      >(Prisma.sql`
        SELECT SUBSTRING_INDEX(SUBSTRING_INDEX(b.notiz, 'Gerät: ', -1), ' | ', 1) AS modell,
               COUNT(*)     AS buchungen,
               SUM(b.menge) AS teile
        FROM Buchung b
        JOIN Artikel a ON a.id = b.artikelId
        WHERE b.typ = 'EINGANG' AND b.herkunftLogId IS NULL AND b.notiz LIKE '%Gerät: %'
          ${datumFilter} ${standortFilter}
        GROUP BY modell
        ORDER BY teile DESC
        LIMIT 10
      `);

      const proKategorie: { kategorie: string; menge: number; preis: number; wert: number }[] = [];
      const ohnePreis:    { kategorie: string; menge: number }[] = [];
      let wert = 0, mengeGesamt = 0;

      for (const r of rows) {
        const kategorie = r.kategorie?.trim() || "(ohne Kategorie)";
        const menge     = num(r.menge);
        mengeGesamt += menge;
        if (r.preis == null) {
          ohnePreis.push({ kategorie, menge });
        } else {
          const preis = num(r.preis);
          const w     = Math.round(menge * preis * 100) / 100;
          wert += w;
          proKategorie.push({ kategorie, menge, preis, wert: w });
        }
      }
      proKategorie.sort((a, b) => b.wert - a.wert);
      ohnePreis.sort((a, b) => b.menge - a.menge);

      const geraete = num(kopf?.geraete);

      return {
        geraete,                                   // verschiedene Spender-Altgeräte
        mengeGesamt,                               // daraus gewonnene Teile
        wert: Math.round(wert * 100) / 100,        // Materialwert der Ernte
        proGeraet: geraete > 0 ? Math.round((mengeGesamt / geraete) * 10) / 10 : 0,
        proKategorie,
        ohnePreis,
        topModelle: topModelle.map((t) => ({
          modell:  t.modell ?? "(Modell unbekannt)",
          geraete: num(t.geraete),
          teile:   num(t.teile),
        })),
        // Transparenz: wie viele Einlagerungen haben (noch) keine Herkunft?
        erfassung: {
          mitHerkunft:  num(kopf?.mitHerkunft),
          ohneHerkunft: num(kopf?.ohneHerkunft),
        },
        // Altdaten aus der Notiz — NUR Modell-Ebene, bewusst ohne „je Gerät".
        altModelle: altModelle
          .map((t) => ({
            modell:    (t.modell ?? "").trim() || "(unbekannt)",
            buchungen: num(t.buchungen),
            teile:     num(t.teile),
          }))
          .filter((t) => t.modell !== "(unbekannt)"),
      };
    }),
});

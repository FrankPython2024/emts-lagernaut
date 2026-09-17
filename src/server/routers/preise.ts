import { z } from "zod";
import { Prisma } from "@prisma/client";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { nichtUmlagerungSql } from "@/lib/buchungen/umlagerung";
import { ausgabeAnTechnikSql } from "@/lib/buchungen/technikAusgabe";
import { statistikStandortFilter } from "@/lib/auth/standortFilter";
import { zeitraum } from "@/lib/zeit/berlin";
import { anfrageStandortWhere, artikelStandortSql } from "@/modules/statistik/standort";

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

  // ── Auswertung „Wert ausgegeben" (an die Technik) ───────────────────────────
  // Summe menge × Stückpreis über die Ausgabe-Buchungen zu Anfragen, plus
  // erledigte Anfragen ohne Lagerartikel und Sonderanfragen.
  //
  // Regeln (Prüfung 17.09.2026):
  //   • Nur Buchungen MIT Anfrage-Bezug → `ausgabeAnTechnikSql` (Handkorrekturen raus).
  //   • Stückpreis = Einzelpreis des Artikels, sonst Kategoriepreis. Vorher nur der
  //     Kategoriepreis — entgegen der Regel „Einzelpreis schlägt Kategoriepreis",
  //     die Abgaben schon immer so rechnen.
  //   • Anfragen OHNE Artikel, die keine Sonderanfrage sind (BEDARF zu einem
  //     Teiltyp ohne angelegten Artikel), laufen als DIREKT ohne Buchung und
  //     fehlten in jeder Summe — 12 Stück am 17.09.2026. Bewertet mit dem
  //     Kategoriepreis ihres Teiltyps.
  //   • Standort serverseitig geprüft; Anfragen ohne Artikel zählen am Standort
  //     ihres Technikers. Sonderanfragen deshalb jetzt AUCH bei gewähltem Standort
  //     (vorher still weggelassen, obwohl die Oberfläche „inkl." schrieb).
  //   • Zeitraum = `zeitraum()`, dieselbe Regel wie der Rest der Statistik.
  //
  // tage = null → alles. Buchung speichert keinen Preis-Snapshot → bewertet wird
  // mit dem AKTUELLEN Preis (für den Überblick ausreichend).
  wertAusgegeben: permissionProcedure("STATISTIK_VIEW")
    .input(z.object({
      tage:       z.number().int().positive().nullable().optional(),
      standortId: z.number().int().positive().nullable().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const tage   = input?.tage ?? null;
      const sId    = statistikStandortFilter(ctx, input?.standortId ?? null);
      const cutoff = tage ? zeitraum(tage).von : null;

      const datumFilter = cutoff ? Prisma.sql`AND b.datum >= ${cutoff}` : Prisma.empty;

      const rows = await ctx.prisma.$queryRaw<
        { kategorie: string | null; mengeMitPreis: unknown; mengeOhnePreis: unknown; wert: unknown }[]
      >(Prisma.sql`
        SELECT a.kategorie AS kategorie,
               SUM(CASE WHEN COALESCE(a.preis, kp.preis) IS NULL THEN 0 ELSE b.menge END) AS mengeMitPreis,
               SUM(CASE WHEN COALESCE(a.preis, kp.preis) IS NULL THEN b.menge ELSE 0 END) AS mengeOhnePreis,
               SUM(CASE WHEN COALESCE(a.preis, kp.preis) IS NULL THEN 0
                        ELSE b.menge * COALESCE(a.preis, kp.preis) END)                 AS wert
        FROM Buchung b
        JOIN Artikel a              ON a.id = b.artikelId
        LEFT JOIN KategoriePreis kp ON kp.kategorie = a.kategorie
        WHERE 1 = 1 ${ausgabeAnTechnikSql("b")} ${datumFilter} ${artikelStandortSql("a", sId)}
        GROUP BY a.kategorie
      `);

      // Je Kategorie sammeln — Buchungen und Anfragen ohne Artikel laufen zusammen.
      const proKat = new Map<string, { mitPreis: number; ohnePreis: number; wert: number }>();
      const eintrag = (k: string) => {
        const e = proKat.get(k) ?? { mitPreis: 0, ohnePreis: 0, wert: 0 };
        proKat.set(k, e);
        return e;
      };
      for (const r of rows) {
        const e = eintrag(r.kategorie?.trim() || "(ohne Kategorie)");
        e.mitPreis  += num(r.mengeMitPreis);
        e.ohnePreis += num(r.mengeOhnePreis);
        e.wert      += num(r.wert);
      }

      const standortAnfragen = await anfrageStandortWhere(sId);
      // ⚠️ Anfragen ohne Buchung zählen nach ANLEGEdatum (ein Abschlussdatum wird
      // nicht gespeichert), Buchungen nach Buchungsdatum. Im Mittel 2,6 h Abstand,
      // selten mehr als ein Tag — am Rand des Zeitraums kann eine Anfrage fehlen.
      const datumAnfrage     = cutoff ? { datum: { gte: cutoff } } : {};

      // ── Erledigte Anfragen ohne Lagerartikel (keine Sonderanfrage) ────────────
      const ohneArtikel = await ctx.prisma.anfrage.findMany({
        where: {
          ...standortAnfragen,
          artikelId:        null,
          istSonderAnfrage: false,
          testModus:        false,
          status:           "ABGESCHLOSSEN",
          // Sicherheitsgurt: Hat die Anfrage doch eine Buchung, zählt sie oben.
          buchungen:        { none: {} },
          ...datumAnfrage,
        },
        select: { teil: true, menge: true },
      });
      if (ohneArtikel.length > 0) {
        const preise = new Map(
          (await ctx.prisma.kategoriePreis.findMany({
            where:  { kategorie: { in: [...new Set(ohneArtikel.map((a) => a.teil))] } },
            select: { kategorie: true, preis: true },
          })).map((p) => [p.kategorie.toLowerCase(), num(p.preis)]),
        );
        for (const a of ohneArtikel) {
          const e     = eintrag(a.teil.trim() || "(ohne Kategorie)");
          const preis = preise.get(a.teil.trim().toLowerCase());
          if (preis == null) e.ohnePreis += a.menge;
          else { e.mitPreis += a.menge; e.wert += a.menge * preis; }
        }
      }

      const proKategorie: { kategorie: string; menge: number; preis: number; wert: number }[] = [];
      const ohnePreis:    { kategorie: string; menge: number }[] = [];
      let gesamt = 0;
      let mengeGesamt = 0;
      for (const [kategorie, e] of proKat) {
        mengeGesamt += e.mitPreis + e.ohnePreis;
        if (e.mitPreis > 0) {
          const wert = Math.round(e.wert * 100) / 100;
          gesamt += wert;
          // Bei Einzelpreisen gibt es je Kategorie keinen einheitlichen Preis mehr →
          // Durchschnitt je Stück (die Oberfläche beschriftet die Spalte „Ø Preis").
          proKategorie.push({ kategorie, menge: e.mitPreis, preis: Math.round((wert / e.mitPreis) * 100) / 100, wert });
        }
        if (e.ohnePreis > 0) ohnePreis.push({ kategorie, menge: e.ohnePreis });
      }

      proKategorie.sort((a, b) => b.wert - a.wert);
      ohnePreis.sort((a, b) => b.menge - a.menge);

      const teileWert = Math.round(gesamt * 100) / 100;

      // ── Sonderanfragen (kein Lagerartikel → keine Kategorie/Preis) ────────────
      // Erledigte Sonderanfragen (ohne Test) im Zeitraum: Wert = sonderWert ?? Pauschale.
      // Standort über den Techniker (siehe anfrageStandortWhere).
      let sonderAnzahl = 0, sonderBewertet = 0, sonderWertSumme = 0;
      const sonder = await ctx.prisma.anfrage.findMany({
        where: {
          ...standortAnfragen,
          istSonderAnfrage: true,
          testModus:        false,
          status:           "ABGESCHLOSSEN",
          ...datumAnfrage,
        },
        select: { sonderWert: true },
      });
      sonderAnzahl = sonder.length;
      for (const s of sonder) {
        if (s.sonderWert != null) { sonderWertSumme += num(s.sonderWert); sonderBewertet++; }
        else                        sonderWertSumme += SONDER_PAUSCHALE;
      }
      sonderWertSumme = Math.round(sonderWertSumme * 100) / 100;

      return {
        // Gesamt-Wert inkl. Sonderanfragen (Antwort auf „was bringt das eigentlich").
        gesamt:      Math.round((teileWert + sonderWertSumme) * 100) / 100,
        teileWert,        // Ersatzteile (Buchungen + Anfragen ohne Lagerartikel)
        mengeGesamt,      // Anzahl ausgegebener Teile
        ohneLagerartikel: ohneArtikel.length, // davon Anfragen ohne Artikel (keine Buchung)
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
  // `wertAusgegeben`: Einzelpreis, sonst Kategoriepreis.
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
      const tage   = input?.tage ?? null;
      const sId    = statistikStandortFilter(ctx, input?.standortId ?? null);
      const cutoff = tage ? zeitraum(tage).von : null;

      const datumFilter    = cutoff ? Prisma.sql`AND b.datum >= ${cutoff}` : Prisma.empty;
      const standortFilter = artikelStandortSql("a", sId);

      // 1) Je Kategorie: geerntete Menge + Wert (Einzelpreis vor Kategoriepreis)
      const rows = await ctx.prisma.$queryRaw<
        { kategorie: string | null; mengeMitPreis: unknown; mengeOhnePreis: unknown; wert: unknown }[]
      >(Prisma.sql`
        SELECT a.kategorie AS kategorie,
               SUM(CASE WHEN COALESCE(a.preis, kp.preis) IS NULL THEN 0 ELSE b.menge END) AS mengeMitPreis,
               SUM(CASE WHEN COALESCE(a.preis, kp.preis) IS NULL THEN b.menge ELSE 0 END) AS mengeOhnePreis,
               SUM(CASE WHEN COALESCE(a.preis, kp.preis) IS NULL THEN 0
                        ELSE b.menge * COALESCE(a.preis, kp.preis) END)                 AS wert
        FROM Buchung b
        JOIN Artikel a              ON a.id = b.artikelId
        LEFT JOIN KategoriePreis kp ON kp.kategorie = a.kategorie
        WHERE b.typ = 'EINGANG' AND b.herkunftLogId IS NOT NULL
          AND (b.herkunftArt IS NULL OR b.herkunftArt <> 'DRUCK')
          ${datumFilter} ${standortFilter}
        GROUP BY a.kategorie
        ORDER BY a.kategorie
      `);

      // 2) Kennzahlen: wie viele verschiedene Spendergeräte, wie viele Einlagerungen
      //    ohne Herkunft (Alt-Daten bzw. Einlagern ohne LogID-Scan).
      //    ⚠️ „ohne Herkunft" zählt Druck (herkunftArt DRUCK) und die EINGANG-Hälfte
      //    von Verschiebungen NICHT mehr mit — beides erschien sonst doppelt bzw.
      //    als fehlende Ernte, obwohl es nie eine war.
      const [kopf] = await ctx.prisma.$queryRaw<
        { geraete: unknown; mitHerkunft: unknown; ohneHerkunft: unknown; druckTeile: unknown }[]
      >(Prisma.sql`
        SELECT COUNT(DISTINCT b.herkunftLogId)                        AS geraete,
               SUM(CASE WHEN b.herkunftLogId IS NOT NULL THEN 1 ELSE 0 END) AS mitHerkunft,
               SUM(CASE WHEN b.herkunftLogId IS NULL AND b.herkunftArt IS NULL THEN 1 ELSE 0 END) AS ohneHerkunft,
               -- Selbst gedruckte Teile: eigene Zahl, zählt NICHT als Ernte
               COALESCE(SUM(CASE WHEN b.herkunftArt = 'DRUCK' THEN b.menge ELSE 0 END), 0) AS druckTeile
        FROM Buchung b
        JOIN Artikel a ON a.id = b.artikelId
        WHERE b.typ = 'EINGANG' ${nichtUmlagerungSql("b")} ${datumFilter} ${standortFilter}
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
          AND (b.herkunftArt IS NULL OR b.herkunftArt <> 'DRUCK')
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
        const mit  = num(r.mengeMitPreis);
        const ohne = num(r.mengeOhnePreis);
        mengeGesamt += mit + ohne;
        if (mit > 0) {
          const w = Math.round(num(r.wert) * 100) / 100;
          wert += w;
          proKategorie.push({ kategorie, menge: mit, preis: Math.round((w / mit) * 100) / 100, wert: w });
        }
        if (ohne > 0) ohnePreis.push({ kategorie, menge: ohne });
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
          // Eigenfertigung getrennt ausgewiesen — bewusst NICHT Teil der Ernte.
          druckTeile:   num(kopf?.druckTeile),
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

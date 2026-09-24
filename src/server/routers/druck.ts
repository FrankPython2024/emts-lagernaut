import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";
import type { SessionUser } from "@/core/types";
import { zeitraum } from "@/lib/zeit/berlin";
import { fuersArchiv } from "@/lib/bilder/groesse";
import { zerlegeGeraetename } from "@/lib/geraete/schildName";
import { modellSchluessel } from "@/modules/teilespender/service";
import { bucheLager, loescheBuchung } from "@/modules/buchungen/service";
import { standortWhere } from "@/lib/auth/standortFilter";
import { BuchungsTyp } from "@prisma/client";
import { STAND_ID, hashSchluessel, neuerSchluessel } from "@/modules/druck/bruecke";
import { BRUECKE_STILL_MS, darfStarten, istDerAuftrag } from "@/lib/druck/warteschlange";
import {
  DRUCK_TEILTYPEN_STANDARD, planeDruckliste, teiltypenAus, teiltypenText,
  type BedarfZeile, type VorlageKurz,
} from "@/lib/druck/druckliste";

// ── 3D-Druck: Druckvorlagen + Druckliste (Paket 1, 24.09.2026) ───────────────
// Lesen: ARTIKEL_VIEW. Pflegen: ARTIKEL_EDIT. Kein neues Recht, kein seed-rbac.
// Dateien laden hoch/runter über /api/druck/datei (Pages-API, rohe Bytes).
const lesen   = permissionProcedure("ARTIKEL_VIEW");
const pflegen = permissionProcedure("ARTIKEL_EDIT");
// Einbuchen wie im Einlager-Assistenten — wer einlagern darf, darf Gedrucktes einbuchen.
const einbuchenRecht = permissionProcedure("ARTIKEL_EINLAGERN");
// Drucken über den Server (Stufe 3): nur mit eigenem Recht — ein Druck bewegt eine Maschine.
const druckStarten = permissionProcedure("DRUCK_STARTEN");
/** So lange lässt sich ein „Druck fertig" zurücknehmen (Tippfehler: 400 statt 40). */
const ZURUECK_STUNDEN = 24;

const TAGE = 90;
const VORRAT_TAGE = 30;
const OFFEN = ["NEU", "BEDARF", "IN_BEARBEITUNG"] as const;
const FOTO_MAX_BYTES = 12 * 1024 * 1024;

function kuerzelVon(ctx: { session: { user?: unknown } }): string {
  return ((ctx.session.user as SessionUser | undefined)?.kuerzel ?? "?").slice(0, 50);
}

/** „Lenovo ThinkPad L13 Gen 1 20R4-S37W0N" → „Lenovo ThinkPad L13 Gen 1". */
function sauberName(name: string, hersteller?: string | null): string {
  const s = zerlegeGeraetename(name, hersteller);
  return [s.hersteller ?? "", s.serie, s.modell, s.zusatz].filter((x) => x).join(" ").trim() || name.trim();
}

/**
 * Nachfrage und Bestand je Modellschlüssel + Teiltyp.
 * Nachfrage = Anfragen der letzten `tage` Tage ohne Storno und Test-Modus —
 * auch „nicht verfügbar": genau das ist die ungedeckte Nachfrage.
 * Offen = heute noch offene Anfragen, unabhängig vom Zeitraum.
 */
async function ladeBedarf(teiltypen: string[], tage: number): Promise<BedarfZeile[]> {
  if (teiltypen.length === 0) return [];
  const { von } = zeitraum(tage);
  const [imZeitraum, offen, kompat] = await Promise.all([
    prisma.anfrage.findMany({
      where:  { teil: { in: teiltypen }, testModus: false, status: { not: "STORNIERT" }, datum: { gte: von } },
      select: { geraeteName: true, geraet: true, teil: true, menge: true },
    }),
    prisma.anfrage.findMany({
      where:  { teil: { in: teiltypen }, testModus: false, status: { in: [...OFFEN] } },
      select: { geraeteName: true, geraet: true, teil: true, menge: true },
    }),
    prisma.kompatibilitaet.findMany({
      where:  { teiltyp: { in: teiltypen }, artikel: { bestand: { gt: 0 } } },
      select: { geraet: true, teiltyp: true, artikel: { select: { id: true, bestand: true } } },
    }),
  ]);

  const zeilen = new Map<string, BedarfZeile & { namen: Map<string, number> }>();
  const zeile = (key: string, teiltyp: string) => {
    const k = `${key}\u0000${teiltyp}`;
    let z = zeilen.get(k);
    if (!z) {
      z = { key, teiltyp, name: "", anfragen: 0, stueck: 0, offenStueck: 0, bestand: 0, namen: new Map() };
      zeilen.set(k, z);
    }
    return z;
  };
  const merkeName = (z: { namen: Map<string, number> }, roh: string) => {
    const n = sauberName(roh);
    z.namen.set(n, (z.namen.get(n) ?? 0) + 1);
  };

  for (const a of imZeitraum) {
    const roh = a.geraeteName ?? a.geraet;
    const key = modellSchluessel(roh);
    if (!key) continue;
    const z = zeile(key, a.teil);
    z.anfragen++;
    z.stueck += Math.max(1, a.menge);
    merkeName(z, roh);
  }
  for (const a of offen) {
    const roh = a.geraeteName ?? a.geraet;
    const key = modellSchluessel(roh);
    if (!key) continue;
    const z = zeile(key, a.teil);
    z.offenStueck += Math.max(1, a.menge);
    merkeName(z, roh);
  }
  // Ein Artikel kann über mehrere Kompatibilitäts-Zeilen am selben Modell
  // hängen — Bestand nur einmal zählen.
  const gezaehlt = new Set<string>();
  for (const k of kompat) {
    const key = modellSchluessel(k.geraet);
    if (!key) continue;
    const merk = `${key}\u0000${k.teiltyp}\u0000${k.artikel.id}`;
    if (gezaehlt.has(merk)) continue;
    gezaehlt.add(merk);
    const z = zeile(key, k.teiltyp);
    z.bestand += k.artikel.bestand;
    merkeName(z, k.geraet);
  }

  return [...zeilen.values()].map(({ namen, ...z }) => ({
    ...z,
    name: [...namen].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0] ?? z.key,
  }));
}

/**
 * Artikel, auf die ein Druck dieser Vorlage gebucht werden kann: Artikel des
 * Teiltyps, die über die Kompatibilität an einem der zugeordneten Modelle hängen
 * (Varianten mit Maschinennummer eingeschlossen). Meiste Stück zuerst — das ist
 * in aller Regel der „Haupt-Artikel" (L13: 209 Stück, die Varianten 0).
 */
async function zielArtikelFuer(vorlageId: number, standortFilter: Record<string, unknown>) {
  const v = await prisma.druckvorlage.findUnique({
    where:  { id: vorlageId },
    select: { id: true, name: true, teiltypen: true, stueckProPlatte: true, modelle: { select: { modellKey: true } } },
  });
  if (!v) throw new TRPCError({ code: "NOT_FOUND", message: "Vorlage nicht gefunden" });
  const teiltypen = teiltypenAus(v.teiltypen);
  const keys = new Set(v.modelle.map((m) => m.modellKey));
  const rows = keys.size === 0 ? [] : await prisma.kompatibilitaet.findMany({
    where:  { teiltyp: { in: teiltypen }, artikel: { ...standortFilter, kategorie: { in: teiltypen } } },
    select: { geraet: true, artikel: { select: { id: true, bezeichnung: true, kategorie: true, bestand: true } } },
  });
  const je = new Map<number, { id: number; bezeichnung: string; teiltyp: string; bestand: number; geraete: number }>();
  for (const k of rows) {
    if (!keys.has(modellSchluessel(k.geraet))) continue;
    const e = je.get(k.artikel.id);
    if (e) e.geraete++;
    else je.set(k.artikel.id, { id: k.artikel.id, bezeichnung: k.artikel.bezeichnung, teiltyp: k.artikel.kategorie, bestand: k.artikel.bestand, geraete: 1 });
  }
  const artikel = [...je.values()].sort((a, b) =>
    b.bestand - a.bestand || a.bezeichnung.length - b.bezeichnung.length || a.bezeichnung.localeCompare(b.bezeichnung));
  return { vorlage: { ...v, teiltypen }, artikel };
}

async function ladeVorlagenKurz(): Promise<VorlageKurz[]> {
  const v = await prisma.druckvorlage.findMany({
    where:  { aktiv: true },
    select: { id: true, name: true, teiltypen: true, stueckProPlatte: true, modelle: { select: { modellKey: true } } },
  });
  return v.map((x) => ({
    id: x.id, name: x.name, teiltypen: teiltypenAus(x.teiltypen), stueckProPlatte: x.stueckProPlatte,
    modellKeys: x.modelle.map((m) => m.modellKey),
  }));
}

const vorlageInput = z.object({
  id:              z.number().int().positive().optional(),
  name:            z.string().trim().min(1).max(191),
  teiltypen:       z.array(z.string().trim().min(1).max(100)).min(1).max(10),
  stueckProPlatte: z.number().int().positive().max(10_000).nullable(),
  druckzeitMin:    z.number().int().positive().max(100_000).nullable(),
  material:        z.string().trim().max(100).nullable(),
  notiz:           z.string().max(5000).nullable(),
  aktiv:           z.boolean(),
  modelle:         z.array(z.object({ key: z.string().min(1).max(191), anzeige: z.string().min(1).max(255) })).max(200),
});

export const druckRouter = createTRPCRouter({

  // Alle Vorlagen (ohne Bytes) mit Bestand/Nachfrage je Vorlage.
  liste: lesen.query(async () => {
    const vorlagen = await prisma.druckvorlage.findMany({
      orderBy: [{ aktiv: "desc" }, { name: "asc" }],
      select: {
        id: true, name: true, teiltypen: true, stueckProPlatte: true, druckzeitMin: true, material: true,
        aktiv: true, fotoAm: true, updatedAt: true,
        modelle: { select: { modellKey: true, anzeige: true }, orderBy: { anzeige: "asc" } },
        dateien: { select: { id: true, art: true, dateiname: true, groesse: true, createdAt: true }, orderBy: { createdAt: "desc" } },
        protokoll: { where: { zurueckgenommenAm: null }, select: { createdAt: true, stueck: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    const alleTeiltypen = [...new Set(vorlagen.flatMap((v) => teiltypenAus(v.teiltypen)))];
    const bedarf = await ladeBedarf(alleTeiltypen, TAGE);
    const je = new Map(bedarf.map((b) => [`${b.key}\u0000${b.teiltyp}`, b]));
    return vorlagen.map((v) => {
      const tt = teiltypenAus(v.teiltypen);
      let bestand = 0, stueck = 0, offenStueck = 0;
      for (const m of v.modelle) for (const t of tt) {
        const b = je.get(`${m.modellKey}\u0000${t}`);
        if (b) { bestand += b.bestand; stueck += b.stueck; offenStueck += b.offenStueck; }
      }
      const { protokoll, ...rest } = v;
      return { ...rest, teiltypen: tt, bestand, stueck90: stueck, offenStueck, letzterDruck: protokoll[0] ?? null };
    });
  }),

  // Was drucken, was konstruieren? Aus den echten Anfragen.
  druckliste: lesen.query(async () => {
    const vorlagen = await ladeVorlagenKurz();
    const teiltypen = [...new Set([...DRUCK_TEILTYPEN_STANDARD, ...vorlagen.flatMap((v) => v.teiltypen)])];
    const bedarf = await ladeBedarf(teiltypen, TAGE);
    const liste = planeDruckliste(bedarf, vorlagen, { tage: TAGE, vorratTage: VORRAT_TAGE, minAnfragenKonstruieren: 2 });
    return { ...liste, tage: TAGE, vorratTage: VORRAT_TAGE, anzahlVorlagen: vorlagen.length };
  }),

  details: lesen
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const v = await prisma.druckvorlage.findUnique({
        where:  { id: input.id },
        select: {
          id: true, name: true, teiltypen: true, stueckProPlatte: true, druckzeitMin: true, material: true,
          notiz: true, aktiv: true, fotoAm: true, erstelltVon: true, createdAt: true, updatedAt: true,
          modelle: { select: { modellKey: true, anzeige: true }, orderBy: { anzeige: "asc" } },
          dateien: { select: { id: true, art: true, dateiname: true, groesse: true, hochgeladenVon: true, createdAt: true }, orderBy: { createdAt: "desc" } },
        },
      });
      if (!v) throw new TRPCError({ code: "NOT_FOUND", message: "Vorlage nicht gefunden" });
      const protokoll = await prisma.druckProtokoll.findMany({
        where: { vorlageId: v.id }, orderBy: { createdAt: "desc" }, take: 30,
      });
      const artikelNamen = new Map((await prisma.artikel.findMany({
        where: { id: { in: [...new Set(protokoll.map((p) => p.artikelId))] } }, select: { id: true, bezeichnung: true },
      })).map((a) => [a.id, a.bezeichnung]));
      const grenze = Date.now() - ZURUECK_STUNDEN * 3600_000;
      return {
        ...v,
        teiltypen: teiltypenAus(v.teiltypen),
        protokoll: protokoll.map((p) => ({
          ...p,
          artikel: artikelNamen.get(p.artikelId) ?? `Artikel #${p.artikelId} (gelöscht)`,
          zuruecknehmbar: !p.zurueckgenommenAm && p.buchungId != null && p.createdAt.getTime() > grenze,
        })),
      };
    }),

  // Teiltypen zur Auswahl: Füße zuerst, dann die übrigen aktiven.
  teiltypen: lesen.query(async () => {
    const t = await prisma.teiltyp.findMany({ where: { aktiv: true }, select: { name: true }, orderBy: [{ sortierung: "asc" }, { name: "asc" }] });
    const rest = t.map((x) => x.name).filter((n) => !(DRUCK_TEILTYPEN_STANDARD as readonly string[]).includes(n));
    return [...DRUCK_TEILTYPEN_STANDARD, ...rest];
  }),

  // Gerätemodelle suchen — gruppiert nach Modellschlüssel, damit die vielen
  // Varianten mit Maschinennummer („L13 Gen 1 20R4-S37W0N") EIN Eintrag sind.
  modellSuche: lesen
    .input(z.object({ suche: z.string().trim().min(2).max(100) }))
    .query(async ({ input }) => {
      const woerter = input.suche.split(/\s+/).filter((w) => w.length > 0).slice(0, 5);
      const treffer = await prisma.geraeteModell.findMany({
        where: {
          aktiv: true,
          AND: woerter.map((w) => ({ OR: [{ modell: { contains: w } }, { hersteller: { contains: w } }] })),
        },
        select: { hersteller: true, modell: true },
        take: 400,
      });
      const je = new Map<string, { key: string; anzeige: string; varianten: number }>();
      for (const t of treffer) {
        const key = modellSchluessel(t.modell, t.hersteller);
        if (!key) continue;
        const anzeige = sauberName(t.modell, t.hersteller);
        const e = je.get(key);
        if (e) {
          e.varianten++;
          if (anzeige.length < e.anzeige.length) e.anzeige = anzeige;
        } else {
          je.set(key, { key, anzeige, varianten: 1 });
        }
      }
      return [...je.values()].sort((a, b) => a.anzeige.localeCompare(b.anzeige, "de")).slice(0, 40);
    }),

  speichern: pflegen
    .input(vorlageInput)
    .mutation(async ({ ctx, input }) => {
      const daten = {
        name:            input.name,
        teiltypen:       teiltypenText(input.teiltypen),
        stueckProPlatte: input.stueckProPlatte,
        druckzeitMin:    input.druckzeitMin,
        material:        input.material?.trim() || null,
        notiz:           input.notiz?.trim() || null,
        aktiv:           input.aktiv,
      };
      const modelle = [...new Map(input.modelle.map((m) => [m.key, m])).values()];
      return prisma.$transaction(async (tx) => {
        const v = input.id
          ? await tx.druckvorlage.update({ where: { id: input.id }, data: daten })
          : await tx.druckvorlage.create({ data: { ...daten, erstelltVon: kuerzelVon(ctx) } });
        await tx.druckvorlageModell.deleteMany({ where: { vorlageId: v.id } });
        if (modelle.length) {
          await tx.druckvorlageModell.createMany({
            data: modelle.map((m) => ({ vorlageId: v.id, modellKey: m.key, anzeige: m.anzeige })),
          });
        }
        return { id: v.id };
      });
    }),

  loeschen: pflegen
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await prisma.druckvorlage.delete({ where: { id: input.id } });
      return { ok: true };
    }),

  fotoSetzen: pflegen
    .input(z.object({ id: z.number().int().positive(), dataBase64: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const roh = Buffer.from(input.dataBase64, "base64");
      if (roh.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Bild ist leer" });
      if (roh.length > FOTO_MAX_BYTES) throw new TRPCError({ code: "BAD_REQUEST", message: "Bild ist zu groß (max. 12 MB)" });
      const bild = await fuersArchiv(roh);
      await prisma.druckvorlage.update({
        where: { id: input.id },
        data:  { fotoDaten: bild.bytes, fotoMime: bild.mimeType, fotoAm: new Date() },
      });
      return { ok: true };
    }),

  fotoEntfernen: pflegen
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await prisma.druckvorlage.update({ where: { id: input.id }, data: { fotoDaten: null, fotoMime: null, fotoAm: null } });
      return { ok: true };
    }),

  // Worauf kann gebucht werden? (Dialog „Druck fertig")
  zielArtikel: einbuchenRecht
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const { vorlage, artikel } = await zielArtikelFuer(input.id, standortWhere(ctx));
      return { teiltypen: vorlage.teiltypen, stueckProPlatte: vorlage.stueckProPlatte, artikel };
    }),

  // „Druck fertig": EINGANG mit herkunftArt DRUCK über bucheLager — derselbe Weg
  // wie der Einlager-Assistent (Bestand, Suchindex, Live-Update, Statistik).
  einbuchen: einbuchenRecht
    .input(z.object({
      vorlageId: z.number().int().positive(),
      artikelId: z.number().int().positive(),
      platten:   z.number().int().positive().max(1000).nullable(),
      stueck:    z.number().int().positive().max(5000),
    }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session.user as SessionUser;
      // Serverseitig prüfen, dass der Artikel wirklich zur Vorlage passt — der
      // Client könnte sonst jede Artikel-Id schicken.
      const { vorlage, artikel } = await zielArtikelFuer(input.vorlageId, standortWhere(ctx));
      const ziel = artikel.find((a) => a.id === input.artikelId);
      if (!ziel) throw new TRPCError({ code: "BAD_REQUEST", message: "Dieser Artikel passt nicht zur Vorlage." });
      const kuerzel = (user.kuerzel || user.name || "?").slice(0, 50);
      const notiz = [
        "3D-gedruckt",
        `Vorlage: ${vorlage.name} (#${vorlage.id})`,
        input.platten ? `${input.platten} ${input.platten === 1 ? "Platte" : "Platten"}` : null,
      ].filter(Boolean).join(" | ");
      const buchung = await bucheLager({
        artikelId:     ziel.id,
        menge:         input.stueck,
        typ:           BuchungsTyp.EINGANG,
        mitarbeiter:   kuerzel,
        notiz,
        herkunftLogId: null,
        herkunftArt:   "DRUCK",
      });
      await prisma.druckProtokoll.create({
        data: {
          vorlageId: vorlage.id, vorlageName: vorlage.name, artikelId: ziel.id, teiltyp: ziel.teiltyp,
          platten: input.platten, stueck: input.stueck, buchungId: buchung.id, gedrucktVon: kuerzel,
        },
      });
      // Die Frage „fertig → einbuchen?" auf der Druckerkarte ist damit beantwortet.
      await prisma.druckAuftrag.updateMany({
        where: { vorlageId: vorlage.id, status: "GESTARTET", erledigtAm: null },
        data:  { erledigtAm: new Date() },
      });
      return { artikel: ziel.bezeichnung, stueck: input.stueck, neuerBestand: ziel.bestand + input.stueck };
    }),

  // Tippfehler korrigieren: Buchung löschen, Bestand neu rechnen. Nur kurz nach
  // dem Einbuchen und nur, solange die Stücke noch da sind — sonst wäre der
  // Bestand danach negativ, weil schon ausgegeben wurde.
  zuruecknehmen: einbuchenRecht
    .input(z.object({ protokollId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const p = await prisma.druckProtokoll.findUnique({ where: { id: input.protokollId } });
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Eintrag nicht gefunden" });
      if (p.zurueckgenommenAm) throw new TRPCError({ code: "BAD_REQUEST", message: "Schon zurückgenommen." });
      if (p.buchungId == null || p.createdAt.getTime() < Date.now() - ZURUECK_STUNDEN * 3600_000) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Nur in den ersten ${ZURUECK_STUNDEN} Stunden möglich — danach über die Buchungen korrigieren.` });
      }
      const a = await prisma.artikel.findUnique({ where: { id: p.artikelId }, select: { bestand: true } });
      if (!a || a.bestand < p.stueck) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Es sind nur noch ${a?.bestand ?? 0} Stück da — ein Teil wurde schon ausgegeben.` });
      }
      const buchung = await prisma.buchung.findUnique({ where: { id: p.buchungId }, select: { id: true } });
      if (buchung) await loescheBuchung(buchung.id);
      const user = ctx.session.user as SessionUser;
      await prisma.druckProtokoll.update({
        where: { id: p.id },
        data:  { zurueckgenommenAm: new Date(), zurueckgenommenVon: (user.kuerzel || user.name || "?").slice(0, 50) },
      });
      return { ok: true };
    }),

  // ── Drucken über den Server ────────────────────────────────────────────────
  // Stand der Druckbrücke + Warteschlange — für JEDEN PC (die Brücke meldet an
  // den Server, nicht an den Browser).
  druckerStand: lesen.query(async () => {
    const jetzt = new Date();
    const [stand, warteschlange, zuletzt] = await Promise.all([
      prisma.druckerStand.findUnique({ where: { id: STAND_ID } }),
      prisma.druckAuftrag.findMany({
        where: { status: { in: ["WARTET", "ABGEHOLT"] } }, orderBy: { createdAt: "asc" },
        select: { id: true, titel: true, status: true, erstelltVon: true, createdAt: true, vorlageId: true },
      }),
      prisma.druckAuftrag.findMany({
        where: { status: { in: ["GESTARTET", "FEHLER", "ABGEBROCHEN"] }, createdAt: { gte: new Date(jetzt.getTime() - 24 * 3600_000) } },
        orderBy: { createdAt: "desc" }, take: 5,
        select: { id: true, titel: true, dateiname: true, status: true, meldung: true, erstelltVon: true, createdAt: true, gestartetAm: true, vorlageId: true, erledigtAm: true },
      }),
    ]);
    const drucker = (stand?.drucker ?? null) as null | {
      zustand?: string | null; zustandText?: string; datei?: string | null; fortschritt?: number | null;
      restMinuten?: number | null; schicht?: number | null; schichten?: number | null;
      duese?: number | null; dueseZiel?: number | null; bett?: number | null; bettZiel?: number | null;
      fehlercode?: number | null; meldungen?: number; spule?: { typ: string | null; farbe: string | null } | null;
    };
    const online = !!stand?.gemeldetAm && jetzt.getTime() - stand.gemeldetAm.getTime() <= BRUECKE_STILL_MS;
    const start = darfStarten({
      gemeldetAm: stand?.gemeldetAm ?? null, verbindung: stand?.verbindung ?? null,
      zustand: drucker?.zustand ?? null, platteFrei: stand?.platteFrei ?? false, jetzt,
    });
    // „Fertig → einbuchen?": der zuletzt gestartete, noch nicht erledigte Auftrag,
    // wenn der Drucker genau ihn als fertig meldet.
    const letzter = zuletzt.find((a) => a.status === "GESTARTET");
    const einbuchen = letzter && !letzter.erledigtAm && letzter.vorlageId && drucker?.zustand === "FINISH"
      && istDerAuftrag(letzter.titel, letzter.dateiname, drucker.datei ?? null)
      ? { auftragId: letzter.id, vorlageId: letzter.vorlageId, titel: letzter.titel } : null;
    return {
      gekoppelt:     !!stand?.schluesselHash,
      gekoppeltAm:   stand?.schluesselAm ?? null,
      online,
      gemeldetAm:    stand?.gemeldetAm ?? null,
      version:       stand?.version ?? null,
      verbindung:    stand?.verbindung ?? null,
      fehler:        stand?.fehler ?? null,
      drucker:       online ? drucker : null,
      platteFrei:    stand?.platteFrei ?? false,
      platteFreiVon: stand?.platteFreiVon ?? null,
      platteFreiAm:  stand?.platteFreiAm ?? null,
      startbereit:   start.ok,
      wartegrund:    start.ok ? null : start.grund,
      warteschlange,
      zuletzt:       zuletzt.map((a) => ({
        id: a.id, titel: a.titel, status: a.status, meldung: a.meldung, erstelltVon: a.erstelltVon,
        createdAt: a.createdAt, gestartetAm: a.gestartetAm, vorlageId: a.vorlageId,
      })),
      einbuchen,
    };
  }),

  // Druckauftrag anlegen — die Brücke holt ihn ab, sobald Drucker und Platte frei sind.
  auftragAnlegen: druckStarten
    .input(z.object({ dateiId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const d = await prisma.druckvorlageDatei.findUnique({
        where:  { id: input.dateiId },
        select: { id: true, art: true, dateiname: true, vorlage: { select: { id: true, name: true } } },
      });
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Druckdatei nicht gefunden" });
      if (d.art !== "DRUCK") throw new TRPCError({ code: "BAD_REQUEST", message: "Nur geslicte Druckdateien (.gcode.3mf) lassen sich drucken." });
      const a = await prisma.druckAuftrag.create({
        data: {
          vorlageId: d.vorlage.id, dateiId: d.id, titel: d.vorlage.name.slice(0, 100), dateiname: d.dateiname,
          status: "WARTET", erstelltVon: kuerzelVon(ctx),
        },
      });
      return { id: a.id };
    }),

  // Nur wartende Aufträge — ein abgeholter ist schon unterwegs zum Drucker.
  auftragAbbrechen: druckStarten
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const r = await prisma.druckAuftrag.updateMany({
        where: { id: input.id, status: "WARTET" },
        data:  { status: "ABGEBROCHEN", abgebrochenVon: kuerzelVon(ctx), beendetAm: new Date() },
      });
      if (r.count !== 1) throw new TRPCError({ code: "BAD_REQUEST", message: "Der Auftrag ist schon unterwegs zum Drucker oder erledigt." });
      return { ok: true };
    }),

  // „Platte ist leer" — nur per Knopf (Frank, 24.09.2026). Wer die gedruckten
  // Teile abnimmt, hat auch das Recht zum Einlagern.
  platteIstLeer: einbuchenRecht.mutation(async ({ ctx }) => {
    const stand = await prisma.druckerStand.findUnique({ where: { id: STAND_ID }, select: { id: true } });
    if (!stand) throw new TRPCError({ code: "BAD_REQUEST", message: "Die Druckbrücke ist noch nicht gekoppelt." });
    await prisma.druckerStand.update({
      where: { id: STAND_ID },
      data:  { platteFrei: true, platteFreiVon: kuerzelVon(ctx), platteFreiAm: new Date() },
    });
    return { ok: true };
  }),

  // „Fertig → einbuchen?" ausblenden, ohne einzubuchen.
  einbuchenAusblenden: einbuchenRecht
    .input(z.object({ auftragId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await prisma.druckAuftrag.updateMany({ where: { id: input.auftragId, erledigtAm: null }, data: { erledigtAm: new Date() } });
      return { ok: true };
    }),

  // Neuen Brücken-Schlüssel erzeugen. Wird EINMAL angezeigt; gespeichert wird
  // nur der Hash. Ein neuer Schlüssel sperrt den alten sofort aus.
  brueckeKoppeln: druckStarten.mutation(async ({ ctx }) => {
    const schluessel = neuerSchluessel();
    const daten = { schluesselHash: hashSchluessel(schluessel), schluesselAm: new Date(), schluesselVon: kuerzelVon(ctx) };
    await prisma.druckerStand.upsert({ where: { id: STAND_ID }, create: { id: STAND_ID, ...daten }, update: daten });
    return { schluessel };
  }),

  dateiLoeschen: pflegen
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await prisma.druckvorlageDatei.delete({ where: { id: input.id } });
      return { ok: true };
    }),
});

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import { prisma } from "@/core/db/prisma";
import type { SessionUser } from "@/core/types";
import { zeitraum } from "@/lib/zeit/berlin";
import { fuersArchiv } from "@/lib/bilder/groesse";
import { zerlegeGeraetename } from "@/lib/geraete/schildName";
import { modellSchluessel } from "@/modules/teilespender/service";
import {
  DRUCK_TEILTYPEN_STANDARD, planeDruckliste, teiltypenAus, teiltypenText,
  type BedarfZeile, type VorlageKurz,
} from "@/lib/druck/druckliste";

// ── 3D-Druck: Druckvorlagen + Druckliste (Paket 1, 24.09.2026) ───────────────
// Lesen: ARTIKEL_VIEW. Pflegen: ARTIKEL_EDIT. Kein neues Recht, kein seed-rbac.
// Dateien laden hoch/runter über /api/druck/datei (Pages-API, rohe Bytes).
const lesen   = permissionProcedure("ARTIKEL_VIEW");
const pflegen = permissionProcedure("ARTIKEL_EDIT");

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
      return { ...v, teiltypen: tt, bestand, stueck90: stueck, offenStueck };
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
      return { ...v, teiltypen: teiltypenAus(v.teiltypen) };
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

  dateiLoeschen: pflegen
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await prisma.druckvorlageDatei.delete({ where: { id: input.id } });
      return { ok: true };
    }),
});

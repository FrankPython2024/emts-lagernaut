import { prisma } from "@/core/db/prisma";
import { TRPCError } from "@trpc/server";
import { normalisiereHersteller } from "@/lib/geraete/herstellerFilter";
import { bereinigeBezeichnung } from "@/lib/geraete/bezeichnungBereinigen";
import { sucheShopBilder, ladeBild } from "@/lib/geraete/shopBild";
import { redis } from "@/core/infra/redis";
import { fuersArchiv } from "@/lib/bilder/groesse";

// ── Fotos je Gerätemodell ────────────────────────────────────────────────────
//
// Zweck: Im Pickup soll sichtbar sein, wonach gesucht wird. Ein Bild erkennt
// man schneller als „HP EliteBook 840 G5", und wer die Baureihen nicht im Kopf
// hat, erkennt es überhaupt erst.
//
// ⚠️ Der Schlüssel ist der bereinigte Modellname, kein Fremdschlüssel. Die
// Pickup-Positionen tragen nur einen Bezeichnungstext aus ReForm, und der
// lässt sich nicht immer sicher einem Katalogeintrag zuordnen. Über den Namen
// klappt es auch für Geräte, die gar nicht im Katalog stehen.
//
// ⚠️ Die Schlüsselbildung steht AUSSCHLIESSLICH hier. An zwei Stellen gebaut
// entstünden zwei Fotos für dasselbe Modell — derselbe Fehler wie bei den
// Artikelbezeichnungen.

const MAX_BYTES = 6 * 1024 * 1024;

const ERLAUBT: Record<string, true> = {
  "image/jpeg": true, "image/png": true, "image/webp": true,
};

/** Vergleichsform des Modellnamens: klein, ohne Sonderzeichen, ohne Leerraum. */
export function fotoSchluessel(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export type GeraetInfo = {
  /** Anzeigename mit Hersteller, z. B. „HP EliteBook 840 G5". */
  anzeige:    string;
  hersteller: string | null;
  modell:     string;
  schluessel: string;
  hatFoto:    boolean;
  /** Alle Ansichten dieses Modells, Titelbild zuerst. */
  bilder:     { position: number; ansicht: string | null; quelle: string; stand: string }[];
};

/**
 * Aus dem rohen ReForm-Text Hersteller und Modell herausziehen.
 *
 * Nutzt dieselben Bausteine wie der Geräte-Import, damit derselbe Text hier
 * und dort zum gleichen Ergebnis führt.
 */
export async function deuteBezeichnung(roh: string | null): Promise<GeraetInfo | null> {
  const text = (roh ?? "").trim();
  if (!text) return null;

  // Der Hersteller steht bei den ReForm-Texten praktisch immer vorn.
  const hersteller = normalisiereHersteller(text.split(/\s+/)[0] ?? "");
  const modell = hersteller
    ? bereinigeBezeichnung(hersteller, text)
    : text;

  const anzeige    = [hersteller, modell].filter(Boolean).join(" ").trim() || text;
  const schluessel = fotoSchluessel(anzeige);

  const fotos = await prisma.geraeteFoto.findMany({
    where:   { schluessel },
    orderBy: { position: "asc" },
    select:  { position: true, ansicht: true, quelle: true, aktualisiertAm: true },
  });

  return {
    anzeige,
    hersteller,
    modell,
    schluessel,
    hatFoto: fotos.length > 0,
    bilder: fotos.map((f) => ({
      position: f.position,
      ansicht:  f.ansicht,
      quelle:   f.quelle,
      // Zeitstempel als Zwischenspeicher-Stopper in der Bild-Adresse: Ohne ihn
      // zeigt der Browser nach dem Austauschen weiter das alte Bild.
      stand:    String(f.aktualisiertAm.getTime()),
    })),
  };
}

export async function speichereFoto(input: {
  anzeige:  string;
  base64:   string;
  mimeType: string;
  benutzer?: string | null;
}): Promise<{ schluessel: string; groesse: number; ersetzt: boolean }> {
  if (!ERLAUBT[input.mimeType]) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Nur JPEG, PNG oder WebP." });
  }
  const anzeige = input.anzeige.trim();
  if (anzeige.length < 3) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Ohne Modellnamen lässt sich das Foto nicht zuordnen." });
  }

  const bytes = Buffer.from(input.base64.replace(/^data:[^;]+;base64,/, ""), "base64");
  if (bytes.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Leeres Bild." });
  if (bytes.length > MAX_BYTES) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Bild zu groß (${(bytes.length / 1048576).toFixed(1)} MB, erlaubt sind 6 MB).`,
    });
  }

  // Auch selbst aufgenommene Bilder nochmal durch die Größenbremse: Der
  // Browser verkleinert schon, aber wer die Schnittstelle direkt anspricht,
  // umgeht das sonst.
  const klein = await fuersArchiv(bytes);

  const schluessel = fotoSchluessel(anzeige);
  const vorher = await prisma.geraeteFoto.findUnique({
    where: { schluessel_position: { schluessel, position: 0 } }, select: { id: true },
  });

  // Position 0 ist das Titelbild. Ein selbst aufgenommenes Foto belegt immer
  // diesen Platz und steht damit vorn — auch wenn daneben sieben Katalogbilder
  // liegen. Wer das Gerät in der Hand hatte, weiß besser, wie es aussieht.
  await prisma.geraeteFoto.upsert({
    where:  { schluessel_position: { schluessel, position: 0 } },
    create: { schluessel, position: 0, anzeige, ansicht: "eigenes Foto", mimeType: klein.mimeType, daten: klein.bytes, quelle: "SELBST", erstelltVon: input.benutzer ?? null },
    update: { anzeige, ansicht: "eigenes Foto", mimeType: klein.mimeType, daten: klein.bytes, quelle: "SELBST", erstelltVon: input.benutzer ?? null },
  });

  return { schluessel, groesse: klein.bytes.length, ersetzt: !!vorher };
}

export async function leseFoto(
  schluessel: string,
  position = 0,
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const f = await prisma.geraeteFoto.findUnique({
    where:  { schluessel_position: { schluessel: fotoSchluessel(schluessel), position } },
    select: { daten: true, mimeType: true },
  });
  return f ? { bytes: Buffer.from(f.daten), mimeType: f.mimeType } : null;
}

export async function loescheFoto(schluessel: string): Promise<void> {
  await prisma.geraeteFoto.deleteMany({ where: { schluessel: fotoSchluessel(schluessel) } });
}

/** Übersicht für eine Pflegeseite: welche Modelle haben schon ein Bild. */
export async function liste(limit = 300) {
  return prisma.geraeteFoto.findMany({
    where:   { position: 0 },
    orderBy: { aktualisiertAm: "desc" },
    take:    limit,
    select:  { schluessel: true, anzeige: true, quelle: true, erstelltVon: true, aktualisiertAm: true },
  });
}

// ── Bild aus dem AfB-Shop ────────────────────────────────────────────────────
//
// Wird beim ersten Öffnen eines Modells versucht, das noch kein Bild hat.
// Danach nie wieder: Erfolg landet in der Datenbank, Misserfolg in einer
// Merkliste mit Verfallsdatum.
//
// ⚠️ Ein SELBST aufgenommenes Bild wird niemals überschrieben. Der Shop zeigt
// ein makelloses Gerät, im Regal liegt ein gebrauchtes — wer fotografiert hat,
// hatte das echte Teil in der Hand.

/** Modelle, zu denen der Shop nichts hatte. 30 Tage, dann darf es neu versuchen. */
const LEER_TAGE = 30;

function leerSchluessel(s: string): string { return `shopbild:leer:${s}`; }

export async function holeAusShop(anzeige: string, modell?: string | null): Promise<{
  ok: boolean; grund?: string; anzahl?: number;
}> {
  const key = fotoSchluessel(anzeige);

  const vorhanden = await prisma.geraeteFoto.findMany({
    where: { schluessel: key }, select: { position: true, quelle: true },
  });

  // Katalogbilder liegen ab Position 1. Sind sie schon da, ist nichts zu tun.
  if (vorhanden.some((v) => v.quelle === "SHOP")) {
    return { ok: true, anzahl: vorhanden.filter((v) => v.quelle === "SHOP").length };
  }

  // Schon einmal erfolglos gesucht? Dann nicht bei jedem Öffnen erneut.
  try {
    if (await redis.get(leerSchluessel(key))) {
      return { ok: false, grund: "Der Shop führt dieses Modell nicht." };
    }
  } catch { /* Redis weg: dann eben suchen */ }

  const treffer = await sucheShopBilder(anzeige, modell ?? null);
  if (treffer.length === 0) {
    try {
      await redis.set(leerSchluessel(key), "1", "EX", LEER_TAGE * 86_400);
    } catch { /* egal */ }
    return { ok: false, grund: "Im Shop kein passendes Bild gefunden." };
  }

  // ⚠️ Ab Position 1 ablegen. Die 0 bleibt dem selbst aufgenommenen Foto
  // vorbehalten — es soll immer vorn stehen, auch wenn es später dazukommt.
  let position = 1, gespeichert = 0;
  for (const t of treffer) {
    const bild = await ladeBild(t.url);
    if (!bild) continue;
    // ⚠️ Verkleinern, bevor es in die Datenbank geht. Ein Verkaufsfoto aus dem
    // Shop hat volle Auflösung; sieben davon in einer Galerie sind im
    // Hallen-WLAN auf einem Handgerät deutlich zu spüren.
    const klein = await fuersArchiv(bild.bytes);
    await prisma.geraeteFoto.upsert({
      where:  { schluessel_position: { schluessel: key, position } },
      create: {
        schluessel: key, position, anzeige: anzeige.trim(), ansicht: t.ansicht,
        mimeType: klein.mimeType, daten: klein.bytes,
        quelle: "SHOP", erstelltVon: "AfB-Shop",
      },
      update: {
        anzeige: anzeige.trim(), ansicht: t.ansicht,
        mimeType: klein.mimeType, daten: klein.bytes,
        quelle: "SHOP", erstelltVon: "AfB-Shop",
      },
    });
    position++; gespeichert++;
  }

  if (gespeichert === 0) return { ok: false, grund: "Bilder konnten nicht geladen werden." };
  return { ok: true, anzahl: gespeichert };
}

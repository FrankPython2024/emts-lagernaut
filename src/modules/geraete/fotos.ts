import { prisma } from "@/core/db/prisma";
import { TRPCError } from "@trpc/server";
import { normalisiereHersteller } from "@/lib/geraete/herstellerFilter";
import { bereinigeBezeichnung } from "@/lib/geraete/bezeichnungBereinigen";
import { sucheShopBild, ladeBild } from "@/lib/geraete/shopBild";
import { redis } from "@/core/infra/redis";

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
  fotoStand:  string | null;
  /** SELBST | SHOP — woher das vorhandene Bild stammt. */
  quelle:     string | null;
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

  const foto = await prisma.geraeteFoto.findUnique({
    where:  { schluessel },
    select: { aktualisiertAm: true, quelle: true },
  });

  return {
    anzeige,
    hersteller,
    modell,
    schluessel,
    hatFoto:   !!foto,
    // Zeitstempel als Zwischenspeicher-Stopper in der Bild-Adresse: Ohne ihn
    // zeigt der Browser nach dem Austauschen weiter das alte Bild.
    fotoStand: foto ? String(foto.aktualisiertAm.getTime()) : null,
    quelle:    foto?.quelle ?? null,
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

  const schluessel = fotoSchluessel(anzeige);
  const vorher = await prisma.geraeteFoto.findUnique({ where: { schluessel }, select: { id: true } });

  await prisma.geraeteFoto.upsert({
    where:  { schluessel },
    create: { schluessel, anzeige, mimeType: input.mimeType, daten: bytes, quelle: "SELBST", erstelltVon: input.benutzer ?? null },
    // Ein selbst aufgenommenes Bild darf immer ersetzen — auch ein Shop-Bild.
    // Wer das Gerät gerade vor sich hat, weiß besser, wie es aussieht.
    update: { anzeige, mimeType: input.mimeType, daten: bytes, quelle: "SELBST", erstelltVon: input.benutzer ?? null },
  });

  return { schluessel, groesse: bytes.length, ersetzt: !!vorher };
}

export async function leseFoto(schluessel: string): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const f = await prisma.geraeteFoto.findUnique({
    where:  { schluessel: fotoSchluessel(schluessel) },
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
    orderBy: { aktualisiertAm: "desc" },
    take:    limit,
    select:  { schluessel: true, anzeige: true, erstelltVon: true, aktualisiertAm: true },
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
  ok: boolean; grund?: string; wie?: string;
}> {
  const key = fotoSchluessel(anzeige);

  const vorhanden = await prisma.geraeteFoto.findUnique({
    where: { schluessel: key }, select: { quelle: true },
  });
  if (vorhanden?.quelle === "SELBST") {
    return { ok: false, grund: "Es gibt bereits ein selbst aufgenommenes Foto." };
  }
  if (vorhanden) return { ok: true, wie: "war schon da" };

  // Schon einmal erfolglos gesucht? Dann nicht bei jedem Öffnen erneut.
  try {
    if (await redis.get(leerSchluessel(key))) {
      return { ok: false, grund: "Der Shop führt dieses Modell nicht." };
    }
  } catch { /* Redis weg: dann eben suchen */ }

  const treffer = await sucheShopBild(anzeige, modell ?? null);
  if (!treffer) {
    try {
      await redis.set(leerSchluessel(key), "1", "EX", LEER_TAGE * 86_400);
    } catch { /* egal */ }
    return { ok: false, grund: "Im Shop kein passendes Bild gefunden." };
  }

  const bild = await ladeBild(treffer.bildUrl);
  if (!bild) return { ok: false, grund: "Bild konnte nicht geladen werden." };

  await prisma.geraeteFoto.upsert({
    where:  { schluessel: key },
    create: {
      schluessel: key, anzeige: anzeige.trim(),
      mimeType: bild.mimeType, daten: bild.bytes,
      quelle: "SHOP", erstelltVon: "AfB-Shop",
    },
    update: {
      anzeige: anzeige.trim(), mimeType: bild.mimeType, daten: bild.bytes,
      quelle: "SHOP", erstelltVon: "AfB-Shop",
    },
  });

  return { ok: true, wie: treffer.wie };
}

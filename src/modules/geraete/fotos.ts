import { prisma } from "@/core/db/prisma";
import { TRPCError } from "@trpc/server";
import { normalisiereHersteller } from "@/lib/geraete/herstellerFilter";
import { bereinigeBezeichnung } from "@/lib/geraete/bezeichnungBereinigen";

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
    select: { aktualisiertAm: true },
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
    create: { schluessel, anzeige, mimeType: input.mimeType, daten: bytes, erstelltVon: input.benutzer ?? null },
    // Ein besseres Bild darf ein schlechteres ersetzen — wer eines schießt,
    // hat das Gerät gerade vor sich und weiß, ob das alte taugt.
    update: { anzeige, mimeType: input.mimeType, daten: bytes, erstelltVon: input.benutzer ?? null },
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

import sharp from "sharp";

// ── Bilder auf vernünftige Größe bringen ─────────────────────────────────────
//
// Läuft auf dem Server, weil die Katalogbilder aus dem AfB-Shop dort ankommen
// und niemand sie vorher im Browser verkleinern kann.
//
// ⚠️ Warum das nötig ist: Ein Produktfoto aus dem Shop ist ein Verkaufsbild in
// voller Auflösung. Sieben davon in einer Galerie sind schnell zweistellige
// Megabyte — im Hallen-WLAN auf einem Handgerät merkt man das sofort.
//
// Zum Wiedererkennen eines Notebooks im Regal reicht eine deutlich kleinere
// Fassung. Der Unterschied ist nicht sichtbar, die Ladezeit schon.

/** Längste Kante für die große Ansicht. */
const ANSICHT = 1400;

/** Längste Kante für die Vorschaukacheln in der Leiste. */
const MINIATUR = 200;

async function verkleinere(bytes: Buffer, kante: number, guete: number): Promise<Buffer> {
  return sharp(bytes)
    // `withoutEnlargement` sorgt dafür, dass ein ohnehin kleines Bild nicht
    // künstlich hochgerechnet wird — das würde es nur größer machen, nicht
    // besser.
    .resize({ width: kante, height: kante, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: guete, mozjpeg: true })
    .toBuffer();
}

/**
 * Bild fürs Speichern aufbereiten.
 *
 * Gibt immer JPEG zurück. Das kostet bei Fotos nichts an sichtbarer Qualität
 * und macht die Ausgabe einheitlich — sonst müsste an jeder Stelle der
 * ursprüngliche Typ mitgeschleppt werden.
 */
export async function fuersArchiv(bytes: Buffer): Promise<{ bytes: Buffer; mimeType: string }> {
  try {
    return { bytes: await verkleinere(bytes, ANSICHT, 82), mimeType: "image/jpeg" };
  } catch {
    // Lässt sich das Bild nicht verarbeiten, lieber das Original behalten als
    // gar keines. Ein zu großes Bild ist ärgerlich, ein fehlendes schlimmer.
    return { bytes, mimeType: "image/jpeg" };
  }
}

/** Kleine Fassung für die Vorschauleiste. */
export async function alsMiniatur(bytes: Buffer): Promise<Buffer | null> {
  try {
    return await verkleinere(bytes, MINIATUR, 70);
  } catch {
    return null;
  }
}

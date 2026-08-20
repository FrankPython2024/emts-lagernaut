import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/core/auth/config";
import { leseFoto } from "@/modules/teilenummern/service";
import { alsMiniatur } from "@/lib/bilder/groesse";

// Liefert das Vergleichsfoto einer Teilenummer aus. Eigener Endpunkt statt
// tRPC, weil hier Bytes rausgehen und kein JSON — dasselbe Muster wie bei den
// Geräte- und Verbrauchsmaterial-Bildern.

function q1(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) return res.status(401).json({ error: "Nicht angemeldet" });

  const id = parseInt(q1(req.query.id), 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "id fehlt" });

  const foto = await leseFoto(id);
  if (!foto) return res.status(404).json({ error: "Kein Foto" });

  // Kleine Fassung für Vorschauen — sonst lädt ein 60-Pixel-Bildchen die
  // volle Aufnahme.
  const mini  = q1(req.query.mini) === "1";
  const daten = mini ? (await alsMiniatur(foto.bytes)) ?? foto.bytes : foto.bytes;

  res.setHeader("Content-Type", mini && daten !== foto.bytes ? "image/jpeg" : foto.mimeType);
  res.setHeader("Content-Length", daten.length);
  // Die Adresse trägt einen Zeitstempel, ein ausgetauschtes Bild bekommt also
  // ohnehin eine neue Adresse.
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  return res.status(200).send(daten);
}

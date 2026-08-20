import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/core/auth/config";
import { leseFoto } from "@/modules/geraete/fotos";

// Liefert das Foto zu einem Gerätemodell aus. Eigener Endpunkt statt tRPC,
// weil hier Bytes rausgehen und kein JSON — dasselbe Muster wie bei den
// Verbrauchsmaterial-Bildern.
//
// Nur angemeldet erreichbar. Ein Bild eines Notebook-Modells ist zwar nichts
// Geheimes, aber es gibt keinen Grund, die Datenbank offen ins Netz zu stellen.

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

  const schluessel = q1(req.query.schluessel).trim();
  if (!schluessel) return res.status(400).json({ error: "schluessel fehlt" });

  // Position wählt die Ansicht: 0 = Titelbild, ab 1 die Katalogansichten.
  const position = Math.max(0, Math.min(20, parseInt(q1(req.query.position) || "0", 10) || 0));

  const foto = await leseFoto(schluessel, position);
  if (!foto) return res.status(404).json({ error: "Kein Foto" });

  res.setHeader("Content-Type", foto.mimeType);
  res.setHeader("Content-Length", foto.bytes.length);
  // Ein Jahr zwischenspeichern — die Adresse trägt einen Zeitstempel, ein
  // ausgetauschtes Bild bekommt also ohnehin eine neue Adresse.
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  return res.status(200).send(foto.bytes);
}

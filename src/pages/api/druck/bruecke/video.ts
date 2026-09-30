// Druckbrücke schickt ein Video-Paket (alle ~0,4 s, Bilder seitdem).
// POST /api/druck/bruecke/video — Authorization: Bearer <Brücken-Schlüssel>
// Kopf „X-Codec: avc1.641029", Rumpf = packeVideo(…) (max 4 MB).
// Antwort: { ok, weiter } — weiter=false heißt „niemand schaut mehr Video".
// Das jeweils neueste Schlüsselbild wird zusätzlich als Standbild abgelegt.

import type { NextApiRequest, NextApiResponse } from "next";
import { brueckeAngemeldet } from "@/modules/druck/bruecke";
import { codecGueltig, siehtAusWieH264, kameraBildSpeichern } from "@/modules/druck/kamera";
import { VIDEO_PAKET_MAX_BYTES, entpackeVideo, videoAufnehmen, videoGewuenscht } from "@/modules/druck/kameraVideo";

export const config = { api: { bodyParser: false } };

async function leseRumpf(req: NextApiRequest, max: number): Promise<Buffer | null> {
  const teile: Buffer[] = [];
  let laenge = 0;
  for await (const stueck of req) {
    const b = stueck as Buffer;
    laenge += b.length;
    if (laenge > max) return null;
    teile.push(b);
  }
  return Buffer.concat(teile);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  if (!(await brueckeAngemeldet(req))) return res.status(401).json({ error: "Schlüssel ungültig" });
  const codec = req.headers["x-codec"];
  if (!codecGueltig(codec)) return res.status(400).json({ error: "X-Codec fehlt oder ungültig" });
  const rumpf = await leseRumpf(req, VIDEO_PAKET_MAX_BYTES);
  if (!rumpf) return res.status(413).json({ error: "Paket zu groß" });
  const bilder = entpackeVideo(rumpf);
  if (!bilder || bilder.some((b) => !siehtAusWieH264(b.daten))) return res.status(400).json({ error: "Kein gültiges Video-Paket" });
  videoAufnehmen(bilder, codec);
  const letzterKey = [...bilder].reverse().find((b) => b.key);
  if (letzterKey) kameraBildSpeichern(Buffer.from(letzterKey.daten), codec);
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true, weiter: videoGewuenscht() });
}

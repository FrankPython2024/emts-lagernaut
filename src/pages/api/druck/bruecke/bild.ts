// Druckbrücke schickt ein Kamerabild (Schlüsselbild, H.264 Annex-B).
// POST /api/druck/bruecke/bild — Authorization: Bearer <Brücken-Schlüssel>
// Kopf „X-Codec: avc1.641029", Rumpf = rohe Bytes (max 1 MB).
// Antwort: { ok, weiter } — weiter=false heißt „niemand schaut mehr zu".

import type { NextApiRequest, NextApiResponse } from "next";
import { brueckeAngemeldet } from "@/modules/druck/bruecke";
import {
  KAMERA_MAX_BYTES, codecGueltig, siehtAusWieH264, kameraBildSpeichern, kameraGewuenscht,
} from "@/modules/druck/kamera";

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
  const daten = await leseRumpf(req, KAMERA_MAX_BYTES);
  if (!daten) return res.status(413).json({ error: "Bild zu groß" });
  if (!siehtAusWieH264(daten)) return res.status(400).json({ error: "Kein H.264-Bild" });
  kameraBildSpeichern(daten, codec);
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true, weiter: kameraGewuenscht() });
}

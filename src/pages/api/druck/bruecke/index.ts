// Druckbrücke meldet sich (alle 5 s) und holt dabei höchstens einen Auftrag ab.
// POST /api/druck/bruecke  — Authorization: Bearer <Brücken-Schlüssel>
// Body: Status der Brücke (verbindung, fehler, drucker, version).
// Antwort: { auftrag: { id, titel, vorlageId } | null, kamera: boolean }
// kamera = jemand schaut aufs Kamerabild → die Brücke soll Bilder schicken;
// video = jemand schaut Video → durchgehender Strom (Brücke 1.5+).

import type { NextApiRequest, NextApiResponse } from "next";
import { brueckeAngemeldet, meldenUndAbholen } from "@/modules/druck/bruecke";
import { kameraGewuenscht } from "@/modules/druck/kamera";
import { videoGewuenscht } from "@/modules/druck/kameraVideo";

export const config = { api: { bodyParser: { sizeLimit: "256kb" } } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  if (!(await brueckeAngemeldet(req))) return res.status(401).json({ error: "Schlüssel ungültig" });
  const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  const antwort = await meldenUndAbholen(body);
  res.setHeader("Cache-Control", "no-store");
  // `kamera` bleibt „irgendwer schaut" (Brücke 1.4 kennt nur das), `video` sagt 1.5+, dass es Video sein soll.
  const video = videoGewuenscht();
  return res.status(200).json({ ...antwort, kamera: kameraGewuenscht() || video, video });
}

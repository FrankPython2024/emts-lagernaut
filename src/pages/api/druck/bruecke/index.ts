// Druckbrücke meldet sich (alle 5 s) und holt dabei höchstens einen Auftrag ab.
// POST /api/druck/bruecke  — Authorization: Bearer <Brücken-Schlüssel>
// Body: Status der Brücke (verbindung, fehler, drucker, version).
// Antwort: { auftrag: { id, titel, vorlageId } | null, kamera: boolean }
// kamera = jemand schaut aufs Kamerabild → die Brücke soll Standbilder schicken.
// Video (Brücke 1.5.x) ist seit dem Audit 30.09.2026 wieder raus; eine alte Brücke
// bekommt nie „video: true" und macht deshalb nur noch Standbilder.

import type { NextApiRequest, NextApiResponse } from "next";
import { brueckeAngemeldet, meldenUndAbholen } from "@/modules/druck/bruecke";
import { kameraGewuenscht } from "@/modules/druck/kamera";

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
  return res.status(200).json({ ...antwort, kamera: kameraGewuenscht() });
}

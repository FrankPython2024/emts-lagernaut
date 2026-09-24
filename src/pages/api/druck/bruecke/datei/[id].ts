// Druckbrücke holt die Druckdatei eines abgeholten Auftrags.
// GET /api/druck/bruecke/datei/<auftragId> — Authorization: Bearer <Brücken-Schlüssel>
// Nur für Aufträge im Status ABGEHOLT: Die Brücke bekommt nie beliebige Dateien.

import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/core/db/prisma";
import { brueckeAngemeldet } from "@/modules/druck/bruecke";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  if (!(await brueckeAngemeldet(req))) return res.status(401).json({ error: "Schlüssel ungültig" });

  const id = Number(Array.isArray(req.query.id) ? req.query.id[0] : req.query.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Ungültige id" });
  const auftrag = await prisma.druckAuftrag.findUnique({ where: { id }, select: { status: true, dateiId: true } });
  if (!auftrag || auftrag.status !== "ABGEHOLT") return res.status(409).json({ error: "Auftrag ist nicht abgeholt" });

  const d = await prisma.druckvorlageDatei.findUnique({ where: { id: auftrag.dateiId }, select: { daten: true } });
  if (!d) return res.status(404).json({ error: "Druckdatei wurde inzwischen gelöscht" });

  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Length", d.daten.length);
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(Buffer.from(d.daten));
}

// Vorschaubild einer Druckdatei (aus der .gcode.3mf, von Bambu Studio erzeugt).
// GET /api/druck/vorschau/[dateiId]?platte=N&ansicht=oben — Recht ARTIKEL_VIEW.
// ansicht fehlt = Plattenvorschau (plate_N.png), „oben" = Draufsicht (top_N.png).

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/core/auth/config";
import { getMeinePermissions, hasPermission } from "@/modules/rollen/service";
import type { SessionUser } from "@/core/types";
import { druckdateiInfo, waehlePlatte } from "@/modules/druck/vorschau";

const erstes = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) return res.status(401).json({ error: "Nicht angemeldet" });
  const user = session.user as SessionUser;
  const perms = await getMeinePermissions(user.rolle, user.id);
  if (!hasPermission(perms, "ARTIKEL_VIEW")) return res.status(403).json({ error: "Keine Berechtigung (ARTIKEL_VIEW)" });

  const dateiId = Number(erstes(req.query.dateiId));
  if (!Number.isInteger(dateiId) || dateiId <= 0) return res.status(400).json({ error: "Ungültige dateiId" });
  const info = await druckdateiInfo(dateiId);
  const platte = info ? waehlePlatte(info, Number(erstes(req.query.platte)) || null) : null;
  const bild = erstes(req.query.ansicht) === "oben" ? (platte?.oben ?? platte?.bild) : (platte?.bild ?? platte?.oben);
  if (!bild) return res.status(404).json({ error: "Keine Vorschau in der Druckdatei" });

  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.setHeader("Content-Length", bild.length);
  return res.status(200).send(bild);
}

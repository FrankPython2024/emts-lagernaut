// 3D-Druck — Datei einer Druckvorlage herunterladen.
// GET /api/druck/datei/[id] — Recht ARTIKEL_VIEW. Echter Link mit
// Content-Disposition (bewährt wie Mobil-/Notizbuch-Export), kein Blob-Klick.

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/core/auth/config";
import { prisma } from "@/core/db/prisma";
import { getMeinePermissions, hasPermission } from "@/modules/rollen/service";
import type { SessionUser } from "@/core/types";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) return res.status(401).json({ error: "Nicht angemeldet" });
  const user = session.user as SessionUser;
  const perms = await getMeinePermissions(user.rolle, user.id);
  if (!hasPermission(perms, "ARTIKEL_VIEW")) {
    return res.status(403).json({ error: "Keine Berechtigung (ARTIKEL_VIEW)" });
  }

  const id = Number(Array.isArray(req.query.id) ? req.query.id[0] : req.query.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Ungültige id" });

  const d = await prisma.druckvorlageDatei.findUnique({ where: { id }, select: { dateiname: true, daten: true } });
  if (!d) return res.status(404).json({ error: "Datei nicht gefunden" });

  // ASCII-Rückfall + UTF-8-Name, damit „Füße" im Dateinamen heil ankommt.
  const ascii = d.dateiname.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(d.dateiname)}`);
  res.setHeader("Content-Length", d.daten.length);
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).send(Buffer.from(d.daten));
}

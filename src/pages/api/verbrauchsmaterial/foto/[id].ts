// Verbrauchsmaterial — einzelnes Galerie-Foto ausliefern (Pages-API, rohe Bytes).
// GET /api/verbrauchsmaterial/foto/[id]?v=<ms> — id = fotoId (VerbrauchsArtikelFoto).
// ?v ist nur ein Cache-Buster. Für das Titelbild eines Artikels siehe
// /api/verbrauchsmaterial/bild/[artikelId].
//
// Auth wie beim Titelbild-Endpoint: Session + Recht MATERIAL_VIEW.

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

  const user  = session.user as SessionUser;
  const perms = await getMeinePermissions(user.rolle, user.id);
  if (!hasPermission(perms, "MATERIAL_VIEW")) {
    return res.status(403).json({ error: "Keine Berechtigung (MATERIAL_VIEW)" });
  }

  const id = Number(Array.isArray(req.query.id) ? req.query.id[0] : req.query.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Ungültige id" });

  const foto = await prisma.verbrauchsArtikelFoto.findUnique({
    where:  { id },
    select: { mimeType: true, daten: true },
  });
  if (!foto) return res.status(404).json({ error: "Kein Foto" });

  res.setHeader("Content-Type", foto.mimeType);
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.setHeader("Content-Length", foto.daten.length);
  return res.status(200).send(Buffer.from(foto.daten));
}

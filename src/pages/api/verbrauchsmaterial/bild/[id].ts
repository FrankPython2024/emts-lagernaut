// Verbrauchsmaterial — TITELBILD eines Artikels ausliefern (Pages-API, weil rohe
// Bytes gestreamt werden). GET /api/verbrauchsmaterial/bild/[id]?v=<ms> — id =
// artikelId; geliefert wird das Foto mit der kleinsten position (= Titelbild).
// ?v ist nur ein Cache-Buster. Einzelne Galerie-Fotos: /api/…/foto/[fotoId].
//
// Auth wie beim Upload-Endpoint: Session + Recht MATERIAL_VIEW. Kein offener
// Endpoint (die Bilder liegen in der DB, nicht in public/).

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

  // ── Auth + Recht ──────────────────────────────────────────────────────────
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) return res.status(401).json({ error: "Nicht angemeldet" });

  const user  = session.user as SessionUser;
  const perms = await getMeinePermissions(user.rolle, user.id);
  if (!hasPermission(perms, "MATERIAL_VIEW")) {
    return res.status(403).json({ error: "Keine Berechtigung (MATERIAL_VIEW)" });
  }

  const id = Number(Array.isArray(req.query.id) ? req.query.id[0] : req.query.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Ungültige id" });

  // Titelbild = Foto mit der kleinsten position dieses Artikels.
  const bild = await prisma.verbrauchsArtikelFoto.findFirst({
    where:   { artikelId: id },
    orderBy: { position: "asc" },
    select:  { mimeType: true, daten: true },
  });
  if (!bild) return res.status(404).json({ error: "Kein Foto" });

  // Inhalt ist über ?v=<Zeitstempel> versioniert → lange, private Cache-Zeit.
  res.setHeader("Content-Type", bild.mimeType);
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.setHeader("Content-Length", bild.daten.length);
  return res.status(200).send(Buffer.from(bild.daten));
}

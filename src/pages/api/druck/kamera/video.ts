// Kamera-Video für die Druckerkarte. GET /api/druck/kamera/video?ab=<nr>
// Recht ARTIKEL_VIEW. Jeder Abruf meldet „jemand schaut Video" (schaltet die
// Kamera an der Brücke ein). Warte-Abruf: gibt es nichts Neues, bleibt die Anfrage
// bis zu 2,5 s offen. Antwort:
//   200 + packeVideo(Bilder), Köpfe X-Letzte-Nr / X-Codec / X-Alter-Ms
//   204, wenn in der Zeit nichts kam
// Neue Zuschauer (ab=0) und solche mit Lücke bekommen ab dem letzten Schlüsselbild.

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/core/auth/config";
import { getMeinePermissions, hasPermission } from "@/modules/rollen/service";
import type { SessionUser } from "@/core/types";
import { bilderFuer, packeVideo, videoAnfordern, videoPuffer, videoWarten } from "@/modules/druck/kameraVideo";

const WARTEN_MS = 2500;

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

  videoAnfordern();
  const ab = Math.max(0, Number(Array.isArray(req.query.ab) ? req.query.ab[0] : req.query.ab) || 0);
  let bilder = bilderFuer(videoPuffer(), ab);
  if (bilder.length === 0) {
    await videoWarten(ab, WARTEN_MS);
    bilder = bilderFuer(videoPuffer(), ab);
  }
  const p = videoPuffer();
  res.setHeader("Cache-Control", "no-store");
  if (bilder.length === 0) {
    res.setHeader("X-Letzte-Nr", String(p.seq));
    return res.status(204).end();
  }
  const rumpf = packeVideo(bilder);
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("X-Letzte-Nr", String(bilder[bilder.length - 1]!.seq));
  res.setHeader("X-Codec", p.codec ?? "avc1.640029");
  res.setHeader("X-Alter-Ms", String(Date.now() - p.am));
  res.setHeader("Content-Length", rumpf.length);
  return res.status(200).send(rumpf);
}

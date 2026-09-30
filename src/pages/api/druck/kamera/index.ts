// Kamerabild des Druckers für die Druckerkarte. GET /api/druck/kamera?nach=<nr>
// Recht DRUCK_STARTEN (Audit 30.09.2026 — Kamera nicht für Leserollen).
//
// Jeder Abruf meldet „jemand schaut zu" — erst dadurch schaltet die Brücke die
// Kamera ein (siehe modules/druck/kamera.ts). Antwort:
//   200 + rohes H.264-Schlüsselbild, Köpfe X-Bild-Nr / X-Codec / X-Alter-Ms
//   204, wenn es kein neueres Bild als `nach` gibt (Kopf X-Bild-Nr)
// Das Alter rechnet der Server, damit eine falsch gehende PC-Uhr nichts verdreht.

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/core/auth/config";
import { getMeinePermissions, hasPermission } from "@/modules/rollen/service";
import type { SessionUser } from "@/core/types";
import { kameraAnfordern, kameraBild } from "@/modules/druck/kamera";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) return res.status(401).json({ error: "Nicht angemeldet" });
  const user = session.user as SessionUser;
  const perms = await getMeinePermissions(user.rolle, user.id);
  // Kamera nur mit DRUCK_STARTEN (Audit 30.09.2026): Sie kann Beschäftigte aufnehmen,
  // und jeder Abruf schaltet sie an der Brücke ein — nichts für reine Leserollen.
  if (!hasPermission(perms, "DRUCK_STARTEN")) {
    return res.status(403).json({ error: "Keine Berechtigung (DRUCK_STARTEN)" });
  }

  kameraAnfordern();
  const nach = Number(Array.isArray(req.query.nach) ? req.query.nach[0] : req.query.nach) || 0;
  const bild = kameraBild();
  res.setHeader("Cache-Control", "no-store");
  if (!bild || bild.nr <= nach) {
    res.setHeader("X-Bild-Nr", String(bild?.nr ?? 0));
    if (bild) res.setHeader("X-Alter-Ms", String(Date.now() - bild.am));
    return res.status(204).end();
  }
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("X-Bild-Nr", String(bild.nr));
  res.setHeader("X-Codec", bild.codec);
  res.setHeader("X-Alter-Ms", String(Date.now() - bild.am));
  res.setHeader("Content-Length", bild.daten.length);
  return res.status(200).send(bild.daten);
}

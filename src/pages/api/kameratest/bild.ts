import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/core/auth/config";
import { getMeinePermissions, hasPermission } from "@/modules/rollen/service";
import { leseFoto } from "@/modules/kameratest/service";
import type { SessionUser } from "@/core/types";

// Liefert ein Testfoto aus. Eigener Endpunkt statt tRPC, weil hier Bytes
// rausgehen und kein JSON — dasselbe Muster wie bei den Verbrauchsmaterial-
// Bildern. Angemeldet und rechtegeprüft, damit die Bilder nicht offen im Netz
// liegen; die Namensprüfung gegen Pfadwechsel steckt im Service.

function q1(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) return res.status(401).json({ error: "Nicht angemeldet" });

  const user  = session.user as SessionUser;
  const perms = await getMeinePermissions(user.rolle, user.id);
  if (!hasPermission(perms, "ARTIKEL_EINLAGERN")) {
    return res.status(403).json({ error: "Keine Berechtigung (ARTIKEL_EINLAGERN)" });
  }

  try {
    const { bytes, mimeType } = await leseFoto(q1(req.query.name).trim());
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Length", bytes.length);
    // Der Dateiname ist eindeutig und der Inhalt ändert sich nie — kurz cachen
    // ist unbedenklich und spart auf dem Handgerät Ladezeit.
    res.setHeader("Cache-Control", "private, max-age=3600");
    return res.status(200).send(bytes);
  } catch {
    return res.status(404).json({ error: "Foto nicht gefunden" });
  }
}

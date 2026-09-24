// Druckbrücke meldet, ob ein abgeholter Auftrag gestartet ist.
// POST /api/druck/bruecke/ergebnis — Authorization: Bearer <Brücken-Schlüssel>
// Body: { auftragId, ok, bestaetigt?, meldung? }

import type { NextApiRequest, NextApiResponse } from "next";
import { brueckeAngemeldet, ergebnisMelden } from "@/modules/druck/bruecke";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  if (!(await brueckeAngemeldet(req))) return res.status(401).json({ error: "Schlüssel ungültig" });
  const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  const auftragId = Number(b.auftragId);
  if (!Number.isInteger(auftragId) || auftragId <= 0) return res.status(400).json({ error: "auftragId fehlt" });
  const gespeichert = await ergebnisMelden({
    auftragId,
    ok:         b.ok === true,
    bestaetigt: typeof b.bestaetigt === "boolean" ? b.bestaetigt : undefined,
    meldung:    typeof b.meldung === "string" ? b.meldung : null,
  });
  return res.status(gespeichert ? 200 : 409).json({ ok: gespeichert });
}

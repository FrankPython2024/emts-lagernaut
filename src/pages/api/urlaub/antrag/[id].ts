// Urlaubsantrag als Word-Datei herunterladen.
// GET /api/urlaub/antrag/<abwesenheitId> — nur für das eigene Konto (wie alles in
// der Urlaubsplanung), nur für Einträge der Art URLAUB, und nur wenn Name/Vorname/
// Personal-Nr. hinterlegt sind. Vorlage: src/lib/urlaub/vorlage/urlaubsantrag.docx
// (Franks Original mit Platzhaltern — liegt bewusst nicht unter public/).

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import fs from "fs";
import path from "path";
import { authOptions } from "@/core/auth/config";
import { prisma } from "@/core/db/prisma";
import type { SessionUser } from "@/core/types";
import { darfBearbeiten, istImUrlaubTeam } from "@/lib/urlaub/team";
import { arbeitstage } from "@/lib/urlaub/tage";
import { antragDateiname, fuelleAntrag, URLAUBSARTEN, type Urlaubsart } from "@/lib/urlaub/antrag";
import { berlinTag } from "@/lib/zeit/berlin";

const VORLAGE = path.join(process.cwd(), "src", "lib", "urlaub", "vorlage", "urlaubsantrag.docx");
const alsTag = (d: Date) => d.toISOString().slice(0, 10); // @db.Date = UTC-Mitternacht

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) return res.status(401).json({ error: "Nicht angemeldet" });
  const ich = Number((session.user as SessionUser).id);
  if (!istImUrlaubTeam(ich)) return res.status(403).json({ error: "Kein Zugang zur Urlaubsplanung." });

  const id = Number(Array.isArray(req.query.id) ? req.query.id[0] : req.query.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Ungültige id" });
  const e = await prisma.abwesenheit.findUnique({ where: { id } });
  if (!e) return res.status(404).json({ error: "Eintrag nicht gefunden" });
  if (!darfBearbeiten(ich, e.userId)) return res.status(403).json({ error: "Nur für eigene Einträge." });
  if (e.art !== "URLAUB") return res.status(400).json({ error: "Einen Urlaubsantrag gibt es nur für Urlaub." });

  const stamm = await prisma.urlaubStammdaten.findUnique({ where: { userId: ich } });
  if (!stamm) return res.status(409).json({ error: "Bitte zuerst Name, Vorname und Personal-Nr. für den Antrag eintragen." });

  const von = alsTag(e.von), bis = alsTag(e.bis);
  const art: Urlaubsart = (URLAUBSARTEN as readonly string[]).includes(e.urlaubsart ?? "") ? (e.urlaubsart as Urlaubsart) : "ERHOLUNG";
  let datei: Buffer;
  try {
    datei = fuelleAntrag(fs.readFileSync(VORLAGE), {
      nachname: stamm.nachname, vorname: stamm.vorname, personalnr: stamm.personalnummer,
      von, bis, tage: arbeitstage({ von, bis, halberTag: e.halberTag }),
      urlaubsart: art, sondergrund: e.sondergrund, datum: berlinTag(new Date()),
    });
  } catch (err) {
    console.error("[Urlaubsantrag]", err);
    return res.status(500).json({ error: "Antrag konnte nicht erzeugt werden." });
  }

  const name = antragDateiname(stamm.nachname, von);
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader("Content-Length", datei.length);
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).send(datei);
}

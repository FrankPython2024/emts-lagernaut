// 3D-Druck — Datei zu einer Druckvorlage hochladen (Pages-API, roher Body).
//   fetch('/api/druck/datei?vorlageId=3&name=' + encodeURIComponent(file.name),
//         { method: 'POST', body: file })
// Recht ARTIKEL_EDIT. Die Dateiart ergibt sich aus der Endung (dateiArt):
// .gcode.3mf = Druckdatei, .3mf = Projekt, STEP/STL/… = Konstruktion.
// Alles andere wird abgelehnt — hier landen keine beliebigen Dateien.

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/core/auth/config";
import { prisma } from "@/core/db/prisma";
import { getMeinePermissions, hasPermission } from "@/modules/rollen/service";
import type { SessionUser } from "@/core/types";
import { DATEI_MAX_BYTES, dateiArt } from "@/lib/druck/druckliste";

export const config = { api: { bodyParser: false } };

function leseKoerper(req: NextApiRequest, max: number): Promise<Buffer | "zu_gross"> {
  return new Promise((resolve, reject) => {
    const teile: Buffer[] = [];
    let groesse = 0;
    let abgebrochen = false;
    req.on("data", (c: Buffer) => {
      if (abgebrochen) return;
      groesse += c.length;
      if (groesse > max) { abgebrochen = true; resolve("zu_gross"); return; }
      teile.push(c);
    });
    req.on("end", () => { if (!abgebrochen) resolve(Buffer.concat(teile)); });
    req.on("error", reject);
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) return res.status(401).json({ error: "Nicht angemeldet" });
  const user = session.user as SessionUser;
  const perms = await getMeinePermissions(user.rolle, user.id);
  if (!hasPermission(perms, "ARTIKEL_EDIT")) {
    return res.status(403).json({ error: "Keine Berechtigung (ARTIKEL_EDIT)" });
  }

  const vorlageId = Number(req.query.vorlageId);
  if (!Number.isInteger(vorlageId) || vorlageId <= 0) return res.status(400).json({ error: "Ungültige Vorlage" });
  const dateiname = (typeof req.query.name === "string" ? req.query.name : "").trim().slice(0, 255);
  const art = dateiArt(dateiname);
  if (!art) {
    return res.status(400).json({ error: "Nur Druckdateien (.gcode.3mf), Bambu-Projekte (.3mf) oder Konstruktionen (STEP, STL …)" });
  }

  const vorlage = await prisma.druckvorlage.findUnique({ where: { id: vorlageId }, select: { id: true } });
  if (!vorlage) return res.status(404).json({ error: "Vorlage nicht gefunden" });

  const daten = await leseKoerper(req, DATEI_MAX_BYTES);
  if (daten === "zu_gross") {
    return res.status(413).json({ error: `Datei ist zu groß (max. ${DATEI_MAX_BYTES / 1024 / 1024} MB)` });
  }
  if (daten.length === 0) return res.status(400).json({ error: "Datei ist leer" });

  const d = await prisma.druckvorlageDatei.create({
    data: {
      vorlageId, art, dateiname, groesse: daten.length, daten,
      hochgeladenVon: (user.kuerzel ?? "?").slice(0, 50),
    },
    select: { id: true, art: true },
  });
  // Vorlage als geändert markieren (Sortierung/Anzeige „zuletzt geändert").
  await prisma.druckvorlage.update({ where: { id: vorlageId }, data: { updatedAt: new Date() } }).catch(() => {});
  return res.status(200).json(d);
}

// Teilespender — Upload-Endpoint für den ReForm-Verwertungs-Export.
//
// Pages-API, weil die Rohdatei gestreamt wird (kein Voll-Load in den Speicher).
// Der Client schickt die CSV als rohen Request-Body:
//   fetch('/api/teilespender/upload?name=' + encodeURIComponent(file.name),
//         { method:'POST', body:file })
//
// Ablauf: Session + Recht TEILESPENDER_IMPORT prüfen → VerwertungsImport
// anlegen → Body auf Platte schreiben → BullMQ-Job einreihen → { importId }.

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { authOptions } from "@/core/auth/config";
import { prisma } from "@/core/db/prisma";
import { queues } from "@/modules/jobs/worker";
import { getMeinePermissions, hasPermission } from "@/modules/rollen/service";
import type { SessionUser } from "@/core/types";

export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) return res.status(401).json({ error: "Nicht angemeldet" });

  const user = session.user as SessionUser;
  const perms = await getMeinePermissions(user.rolle, user.id);
  // Bewusst das IMPORT-Recht, nicht das Leserecht: Dieser Import ersetzt den
  // kompletten Spender-Bestand und entscheidet, was das Lager überhaupt findet.
  if (!hasPermission(perms, "TEILESPENDER_IMPORT")) {
    return res.status(403).json({ error: "Keine Berechtigung (TEILESPENDER_IMPORT)" });
  }

  const nameRaw = typeof req.query.name === "string" ? req.query.name : "verwertung.csv";
  const dateiname = nameRaw.slice(0, 255);

  const imp = await prisma.verwertungsImport.create({
    data: { dateiname, status: "laeuft", erstelltVon: user.id ?? null },
  });

  const tmpPath = path.join(os.tmpdir(), `teilespender-${imp.id}-${crypto.randomUUID()}.csv`);

  try {
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(tmpPath);
      req.pipe(out);
      out.on("finish", resolve);
      out.on("error", reject);
      req.on("error", reject);
    });
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    await prisma.verwertungsImport
      .update({ where: { id: imp.id }, data: { status: "fehler", fehlerText: `Upload fehlgeschlagen: ${text}` } })
      .catch(() => {});
    await fs.promises.unlink(tmpPath).catch(() => {});
    return res.status(500).json({ error: "Upload fehlgeschlagen" });
  }

  try {
    await queues.logidImport.add(
      // Der Job-Name unterscheidet die beiden Import-Arten in derselben Queue.
      // Gemeinsame Queue ist Absicht: Beide schreiben schwer in dieselbe DB und
      // sollen sich nicht überholen (concurrency 1).
      "teilespender",
      { tmpPath, importId: imp.id },
      { removeOnComplete: true, removeOnFail: false, attempts: 1 },
    );
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    await prisma.verwertungsImport
      .update({ where: { id: imp.id }, data: { status: "fehler", fehlerText: `Job konnte nicht eingereiht werden: ${text}` } })
      .catch(() => {});
    await fs.promises.unlink(tmpPath).catch(() => {});
    return res.status(500).json({ error: "Import-Job konnte nicht gestartet werden" });
  }

  return res.status(200).json({ importId: imp.id });
}

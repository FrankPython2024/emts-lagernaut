// Geräte-Reise — Upload-Endpoint (Pages-API, weil große Rohdatei gestreamt wird).
//
// Der Client schickt die CSV als rohen Request-Body:
//   fetch('/api/geraete-reise/upload?name=' + encodeURIComponent(file.name),
//         { method:'POST', body:file })
//
// Ablauf: Session + Recht GERAETE_REISE_VIEW prüfen → LogIdImport (status „läuft")
// anlegen → Body streamend auf Platte schreiben → BullMQ-Job einreihen →
// { importId } zurückgeben. KEIN Voll-Load in den Speicher.

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

// bodyParser AUS — wir streamen den Rohkörper selbst auf die Platte.
export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // ── Auth + Recht (kein offener Endpoint) ──────────────────────────────────
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) return res.status(401).json({ error: "Nicht angemeldet" });

  const user  = session.user as SessionUser;
  const perms = await getMeinePermissions(user.rolle, user.id);
  if (!hasPermission(perms, "GERAETE_REISE_VIEW")) {
    return res.status(403).json({ error: "Keine Berechtigung (GERAETE_REISE_VIEW)" });
  }

  const nameRaw   = typeof req.query.name === "string" ? req.query.name : "upload.csv";
  const dateiname = nameRaw.slice(0, 255);

  // Import-Datensatz anlegen (Fortschritt/Status hängen daran).
  const imp = await prisma.logIdImport.create({
    data: { dateiname, status: "läuft", erstelltVon: user.id ?? null },
  });

  const tmpPath = path.join(os.tmpdir(), `logid-import-${imp.id}-${crypto.randomUUID()}.csv`);

  // ── Rohkörper streamend auf Platte schreiben ──────────────────────────────
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
    await prisma.logIdImport
      .update({ where: { id: imp.id }, data: { status: "fehler", fehlerText: `Upload fehlgeschlagen: ${text}` } })
      .catch(() => {});
    await fs.promises.unlink(tmpPath).catch(() => {});
    return res.status(500).json({ error: "Upload fehlgeschlagen" });
  }

  // ── Import-Job einreihen ──────────────────────────────────────────────────
  try {
    await queues.logidImport.add(
      "import",
      { tmpPath, importId: imp.id },
      { removeOnComplete: true, removeOnFail: false, attempts: 1 },
    );
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    await prisma.logIdImport
      .update({ where: { id: imp.id }, data: { status: "fehler", fehlerText: `Job konnte nicht eingereiht werden: ${text}` } })
      .catch(() => {});
    await fs.promises.unlink(tmpPath).catch(() => {});
    return res.status(500).json({ error: "Import-Job konnte nicht gestartet werden" });
  }

  return res.status(200).json({ importId: imp.id });
}

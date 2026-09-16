// Notizbuch — Export einer Notiz als CSV oder Excel (Pages-API, GET).
//
// Bewusst SERVERSEITIG mit Content-Disposition: attachment, wie beim Mobil-
// Export: Ein echter Link lädt in jedem Browser zuverlässig herunter, der
// client-seitige Blob-Klick startete in manchen Umgebungen still nicht.
//
// Aufruf: <a href="/api/notizbuch/export?id=12&format=csv">

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/core/auth/config";
import { prisma } from "@/core/db/prisma";
import { getMeinePermissions, hasPermission } from "@/modules/rollen/service";
import type { SessionUser } from "@/core/types";

const SPALTEN = ["Nr.", "Eintrag", "Erfasst am", "Erfasst von"] as const;

const q1 = (v: string | string[] | undefined): string =>
  (Array.isArray(v) ? v[0] : v) ?? "";

function csvCell(v: string): string {
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function dateiname(titel: string, ext: string): string {
  const base = titel
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
    .slice(0, 80);
  return `notiz_${base || "export"}.${ext}`;
}

function zeitDe(d: Date): string {
  return d.toLocaleString("de-DE", {
    timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
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
  if (!hasPermission(perms, "NOTIZBUCH_VIEW")) {
    return res.status(403).json({ error: "Keine Berechtigung (NOTIZBUCH_VIEW)" });
  }

  const id     = parseInt(q1(req.query.id), 10);
  const format = q1(req.query.format) === "xlsx" ? "xlsx" : "csv";
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "id fehlt" });

  const notiz = await prisma.notiz.findUnique({
    where:   { id },
    include: { eintraege: { orderBy: { id: "asc" } } },
  });
  if (!notiz) return res.status(404).json({ error: "Notiz nicht gefunden" });

  const matrix: string[][] = notiz.eintraege.map((e, i) => [
    String(i + 1), e.wert, zeitDe(e.createdAt), e.erfasstVon,
  ]);

  if (format === "xlsx") {
    const XLSX = await import("xlsx");
    // ⚠️ Einträge als TEXT schreiben: Excel macht sonst aus „212569941" eine Zahl
    // und aus langen Barcodes eine Exponentialschreibweise (2,12E+08) — die
    // Nummer wäre danach nicht mehr scanbar oder suchbar.
    const ws = XLSX.utils.aoa_to_sheet([[...SPALTEN], ...matrix]);
    for (let r = 1; r <= matrix.length; r++) {
      const zelle = ws[XLSX.utils.encode_cell({ r, c: 1 })];
      if (zelle) { zelle.t = "s"; zelle.z = "@"; }
    }
    ws["!cols"] = [{ wch: 6 }, { wch: 36 }, { wch: 18 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Einträge");
    const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${dateiname(notiz.titel, "xlsx")}"`);
    return res.status(200).send(buf);
  }

  // CSV: UTF-8-BOM (deutsches Excel), ;-getrennt, CRLF.
  const csv = "﻿" + [SPALTEN, ...matrix]
    .map((zeile) => zeile.map((z) => csvCell(String(z))).join(";"))
    .join("\r\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${dateiname(notiz.titel, "csv")}"`);
  return res.status(200).send(csv);
}

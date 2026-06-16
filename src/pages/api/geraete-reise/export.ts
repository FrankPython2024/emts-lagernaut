// Geräte-Reise — Export-Endpoint (Pages-API, GET). Exportiert die GESAMTE
// gefilterte Treffermenge (nicht nur eine Seite) als CSV oder Excel.
//
// Aufruf vom Client: window.location.href = "/api/geraete-reise/export?format=csv&<filter>"
//
// Nutzt denselben where-Builder wie die Liste (geraeteReise.geraeteListe).
// SheetJS (xlsx) wird per dynamischem import NUR hier serverseitig geladen —
// landet nicht im Client-Bundle. Reine Auswertung, kein Bestandseffekt.

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/core/auth/config";
import { prisma } from "@/core/db/prisma";
import { getMeinePermissions, hasPermission } from "@/modules/rollen/service";
import { buildGeraeteWhere, filterFromQuery } from "@/modules/geraete-reise/filter";
import type { SessionUser } from "@/core/types";

const SPALTEN = [
  "LogID", "Hersteller", "Bezeichnung", "Geräteart", "Verweildauer (Tage)",
  "Verbleib", "Stellplatz", "Colli", "Lager", "In Verbleib seit", "In Verbleib durch",
  "Grading", "Aktueller Zustand",
] as const;

function fmtDatum(d: Date | null): string {
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function csvCell(v: string): string {
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

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
  if (!hasPermission(perms, "GERAETE_REISE_VIEW")) {
    return res.status(403).json({ error: "Keine Berechtigung (GERAETE_REISE_VIEW)" });
  }

  const format = (Array.isArray(req.query.format) ? req.query.format[0] : req.query.format) === "xlsx" ? "xlsx" : "csv";

  // Gleiche Filterlogik wie die Liste.
  const where = buildGeraeteWhere(filterFromQuery(req.query));

  const rows = await prisma.logIdStand.findMany({
    where,
    orderBy: { verweildauerTage: "desc" },
    select: {
      logId: true, hersteller: true, bezeichnung: true, geraeteart: true,
      verweildauerTage: true, verbleib: true, stellplatz: true, colli: true, lager: true,
      inVerbleibSeit: true, inVerbleibDurch: true, grading: true, aktuellerZustand: true,
    },
  });

  // Einheitliche, lesbare Zeilen (Strings) — für CSV und Excel identisch.
  const matrix: (string | number)[][] = rows.map((r) => [
    r.logId,
    r.hersteller ?? "",
    r.bezeichnung ?? "",
    r.geraeteart ?? "",
    r.verweildauerTage ?? "",
    r.verbleib ?? "",
    r.stellplatz ?? "",
    r.colli ?? "",
    r.lager ?? "",
    fmtDatum(r.inVerbleibSeit),
    r.inVerbleibDurch ?? "",
    r.grading ?? "",
    r.aktuellerZustand ?? "",
  ]);

  const datum = new Date().toISOString().slice(0, 10);

  if (format === "xlsx") {
    // SheetJS nur hier serverseitig laden.
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([[...SPALTEN], ...matrix]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Geräte");
    const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="geraete_${datum}.xlsx"`);
    return res.status(200).send(buf);
  }

  // CSV: UTF-8-BOM, ;-getrennt, CRLF.
  const csv = "﻿" + [SPALTEN, ...matrix]
    .map((zeile) => zeile.map((z) => csvCell(String(z))).join(";"))
    .join("\r\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="geraete_${datum}.csv"`);
  return res.status(200).send(csv);
}

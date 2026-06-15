// Fehlteile — Export-Endpoint (Pages-API, GET). Exportiert die GESAMTE
// gefilterte Treffermenge (nicht nur eine Seite) als CSV oder Excel.
//
// Aufruf vom Client: window.location.href = "/api/fehlteile/export?format=csv&<filter>"
//
// Nutzt denselben where-Builder wie die Liste (fehlteile.liste). SheetJS (xlsx)
// wird per dynamischem import NUR hier serverseitig geladen — nicht im Client-
// Bundle. Reine Auswertung, kein Bestandseffekt.

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/core/auth/config";
import { prisma } from "@/core/db/prisma";
import { getMeinePermissions, hasPermission } from "@/modules/rollen/service";
import { buildFehlteilWhere, filterFromQuery } from "@/modules/fehlteile/filter";
import type { SessionUser } from "@/core/types";

const SPALTEN = [
  "LogID", "Seriennummer", "Hersteller", "Bezeichnung", "Geräteart", "Unterart",
  "Aktueller Zustand", "Grading", "Sortiment", "AAN", "in Verbleib seit", "in Verbleib durch",
] as const;

function fmtDatum(d: Date | null): string {
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
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
  if (!hasPermission(perms, "FEHLTEILE_VIEW")) {
    return res.status(403).json({ error: "Keine Berechtigung (FEHLTEILE_VIEW)" });
  }

  const format = (Array.isArray(req.query.format) ? req.query.format[0] : req.query.format) === "xlsx" ? "xlsx" : "csv";

  // Gleiche Filterlogik wie die Liste.
  const where = buildFehlteilWhere(filterFromQuery(req.query));

  const rows = await prisma.fehlteilStand.findMany({
    where,
    orderBy: { inVerbleibSeit: "desc" },
    select: {
      logId: true, seriennummer: true, hersteller: true, bezeichnung: true,
      geraeteart: true, unterart: true, aktuellerZustand: true, grading: true,
      sortiment: true, aan: true, inVerbleibSeit: true, inVerbleibDurch: true,
    },
  });

  // Einheitliche, lesbare Zeilen (Strings) — für CSV und Excel identisch.
  const matrix: string[][] = rows.map((r) => [
    r.logId,
    r.seriennummer ?? "",
    r.hersteller ?? "",
    r.bezeichnung ?? "",
    r.geraeteart ?? "",
    r.unterart ?? "",
    r.aktuellerZustand ?? "",
    r.grading ?? "",
    r.sortiment ?? "",
    r.aan ?? "",
    fmtDatum(r.inVerbleibSeit),
    r.inVerbleibDurch ?? "",
  ]);

  const datum = new Date().toISOString().slice(0, 10);

  if (format === "xlsx") {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([[...SPALTEN], ...matrix]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fehlteile");
    const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="fehlteile_${datum}.xlsx"`);
    return res.status(200).send(buf);
  }

  // CSV: UTF-8-BOM, ;-getrennt, CRLF.
  const csv = "﻿" + [SPALTEN, ...matrix]
    .map((zeile) => zeile.map((z) => csvCell(String(z))).join(";"))
    .join("\r\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="fehlteile_${datum}.csv"`);
  return res.status(200).send(csv);
}

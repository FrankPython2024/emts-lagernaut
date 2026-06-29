// Mobil-Ersatzteile — Export-Endpoint (Pages-API, GET). Liefert die LogIDs einer
// Modell+Teiltyp-Gruppe als CSV oder Excel mit Content-Disposition: attachment.
//
// Bewusst SERVERSEITIG (nicht programmatischer Blob-Download im Client): ein echter
// Link-Aufruf lädt zuverlässig in jedem Browser/Gerät herunter — der client-seitige
// `a.click()`-Blob-Download startete in manchen Umgebungen still nicht.
//
// Aufruf: <a href="/api/mobil/export?format=csv&modellId=123&teiltyp=Akku">
// Spalten identisch zur früheren Client-Export-Logik (src/lib/mobil/export.ts).

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/core/auth/config";
import { prisma } from "@/core/db/prisma";
import { getMeinePermissions, hasPermission } from "@/modules/rollen/service";
import type { SessionUser } from "@/core/types";

const SPALTEN = ["LogID", "Colli", "Stellplatz", "Farbe", "AAN", "EK", "Lieferant", "Bezeichnung"] as const;

const q1 = (v: string | string[] | undefined): string =>
  (Array.isArray(v) ? v[0] : v) ?? "";

// EK (Prisma.Decimal | null) → DE-Format mit Komma, 2 Nachkommastellen; null = leer.
function ekText(ek: unknown): string {
  if (ek == null) return "";
  const n = Number(ek);
  return Number.isFinite(n) ? n.toFixed(2).replace(".", ",") : "";
}

function csvCell(v: string): string {
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function sichererDateiname(teile: string[], ext: string): string {
  const base = teile
    .map((t) => t.trim())
    .filter(Boolean)
    .join("_")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return `${base || "mobil-export"}.${ext}`;
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
  if (!hasPermission(perms, "MOBIL_VIEW")) {
    return res.status(403).json({ error: "Keine Berechtigung (MOBIL_VIEW)" });
  }

  // ── Parameter ───────────────────────────────────────────────────────────────
  const modellId = parseInt(q1(req.query.modellId), 10);
  const teiltyp  = q1(req.query.teiltyp).trim();
  const format   = q1(req.query.format) === "xlsx" ? "xlsx" : "csv";
  const bereich  = q1(req.query.bereich) === "DIGITAL_EDUCATION" ? "DIGITAL_EDUCATION" : "STANDARD";
  if (!Number.isInteger(modellId) || modellId <= 0 || !teiltyp) {
    return res.status(400).json({ error: "modellId und teiltyp erforderlich" });
  }

  // ── Daten — identischer Filter wie tRPC logIdsProTeiltyp ─────────────────────
  const [modell, teile] = await Promise.all([
    prisma.mobilModell.findUnique({ where: { id: modellId }, select: { hersteller: true, modell: true } }),
    prisma.mobilTeil.findMany({
      where: {
        ausgeschieden: false,                       // nur aktiver Bestand
        bereich,                                    // nur dieser Bereich/Kostenstelle
        teiltyp: { name: teiltyp },
        modelle: { some: { modellId } },
      },
      select: {
        logId: true, colli: true, stellplatz: true, originalBezeichnung: true,
        ek: true, aan: true, lieferant: true, farbe: true,
      },
    }),
  ]);

  // Sortierung wie im Client: Colli (leere zuletzt), dann LogID.
  teile.sort((a, b) =>
    (a.colli ?? "￿").localeCompare(b.colli ?? "￿", "de", { numeric: true }) ||
    a.logId.localeCompare(b.logId, "de", { numeric: true }),
  );

  const matrix: string[][] = teile.map((t) => [
    t.logId,
    t.colli ?? "",
    t.stellplatz ?? "",
    t.farbe ?? "",
    t.aan ?? "",
    ekText(t.ek),
    t.lieferant ?? "",
    t.originalBezeichnung,
  ]);

  const dateiBasis = ["mobil", modell?.hersteller ?? "", modell?.modell ?? "", teiltyp];

  if (format === "xlsx") {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([[...SPALTEN], ...matrix]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Teile");
    const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${sichererDateiname(dateiBasis, "xlsx")}"`);
    return res.status(200).send(buf);
  }

  // CSV: UTF-8-BOM (DE-Excel), ;-getrennt, CRLF.
  const csv = "﻿" + [SPALTEN, ...matrix]
    .map((zeile) => zeile.map((z) => csvCell(String(z))).join(";"))
    .join("\r\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${sichererDateiname(dateiBasis, "csv")}"`);
  return res.status(200).send(csv);
}

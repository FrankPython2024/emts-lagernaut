"use client";

// Abschlussbericht eines Pickup-Auftrags: CSV-Export (clientseitig) + Druck
// (eigenes Druckfenster, analog zu den bestehenden Druck-Funktionen). Reiner
// Nachweis — kein Bestand-Effekt.

import { formatLogId } from "@/lib/pickup/logId";

export type PickupBerichtData = {
  name:            string;
  bemerkung:       string | null;
  status:          string;
  createdAt:       Date | string;
  abgeschlossenAm: Date | string | null;
  ersteller:       { name: string; kuerzel: string } | null;
  abschliesser:    { name: string; kuerzel: string } | null;
  positionen: {
    logId:       string;
    colli:       string | null;
    stellplatz:  string | null;
    bezeichnung: string | null;
    status:      string;
    gefundenAm:  Date | string | null;
    finder:      { name: string; kuerzel: string } | null;
  }[];
};

function fmtDatum(d: Date | string | null): string {
  return d ? new Date(d).toLocaleString("de-DE") : "";
}

function person(p: { name: string; kuerzel: string } | null): string {
  return p?.kuerzel ?? p?.name ?? "";
}

// Positionen sortiert: Colli natürlich, dann Stellplatz, dann LogId.
function sortiert(positionen: PickupBerichtData["positionen"]) {
  return [...positionen].sort((a, b) => {
    const c = (a.colli ?? "").localeCompare(b.colli ?? "", "de", { numeric: true });
    if (c !== 0) return c;
    const s = (a.stellplatz ?? "").localeCompare(b.stellplatz ?? "", "de", { numeric: true });
    return s !== 0 ? s : a.logId.localeCompare(b.logId, "de", { numeric: true });
  });
}

// ── CSV ───────────────────────────────────────────────────────────────────────

function csvCell(v: string): string {
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function dateiName(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "auftrag";
  return `pickup-${slug}.csv`;
}

export function exportPickupCsv(data: PickupBerichtData): void {
  const kopf = ["LogID", "Colli", "Stellplatz", "Bezeichnung", "Status", "GefundenVon", "GefundenAm"];
  const zeilen = sortiert(data.positionen).map((p) => [
    formatLogId(p.logId),
    p.colli ?? "",
    p.stellplatz ?? "",
    p.bezeichnung ?? "",
    p.status === "GEFUNDEN" ? "Gefunden" : "Nicht gefunden",
    person(p.finder),
    fmtDatum(p.gefundenAm),
  ]);
  const csv = "﻿" + [kopf, ...zeilen].map((r) => r.map(csvCell).join(";")).join("\r\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = dateiName(data.name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Druck (A4-Bericht, eigenes Fenster) ────────────────────────────────────────

const PRINT_SCRIPT = `<script>(function(){function p(){window.focus();window.print();}document.readyState==='complete'?p():window.addEventListener('load',p);})();</script>`;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function printPickupBericht(data: PickupBerichtData): void {
  const w = window.open("", "_blank", "width=800,height=600");
  if (!w) { console.warn("Popup blockiert — Popup-Blocker deaktivieren"); return; }

  const gesamt        = data.positionen.length;
  const gefunden      = data.positionen.filter((p) => p.status === "GEFUNDEN").length;
  const nichtGefunden = gesamt - gefunden;
  const pct           = gesamt > 0 ? Math.round((gefunden / gesamt) * 100) : 0;

  const rows = sortiert(data.positionen).map((p) => {
    const ok = p.status === "GEFUNDEN";
    return `<tr${ok ? "" : ' class="miss"'}>
      <td class="mono">${esc(formatLogId(p.logId))}</td>
      <td>${esc(p.colli ?? "—")}</td>
      <td>${esc(p.stellplatz ?? "—")}</td>
      <td>${esc(p.bezeichnung ?? "—")}</td>
      <td><b style="color:${ok ? "#04713f" : "#b3261e"}">${ok ? "Gefunden" : "Nicht gefunden"}</b></td>
      <td>${esc(person(p.finder) || "—")}</td>
      <td>${esc(fmtDatum(p.gefundenAm) || "—")}</td>
    </tr>`;
  }).join("");

  const css = `@page{size:A4;margin:14mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-family:Arial,Helvetica,sans-serif}
    body{margin:0;color:#1a1a1a;font-size:9pt}
    .hdr{border-bottom:2px solid #202F61;padding-bottom:4mm;margin-bottom:5mm}
    .ttl{font-size:15pt;font-weight:800;color:#202F61}
    .name{font-size:11pt;font-weight:700;margin-top:1mm}
    .meta{font-size:8pt;color:#555;margin-top:1mm}
    .note{margin-top:2mm;padding:2mm 3mm;background:#008BD215;border-radius:2mm;font-size:8.5pt}
    .sum{display:flex;gap:4mm;margin:4mm 0}
    .box{flex:1;border:0.3mm solid #ccc;border-radius:2mm;padding:3mm;text-align:center}
    .box .n{font-size:16pt;font-weight:800}
    .box .l{font-size:7.5pt;color:#555}
    table{width:100%;border-collapse:collapse;margin-top:2mm}
    th{background:#202F61;color:#fff;text-align:left;padding:2mm;font-size:7.5pt}
    td{padding:1.6mm 2mm;border-bottom:0.2mm solid #ddd;font-size:7.8pt;vertical-align:top}
    tr.miss td{background:#fa3e3e10}
    .mono{font-family:"Courier New",monospace;font-weight:700}
    .ftr{margin-top:5mm;font-size:7pt;color:#888;text-align:right;border-top:0.2mm solid #ccc;padding-top:2mm}`;

  const meta = [
    `Erstellt: ${fmtDatum(data.createdAt)}${person(data.ersteller) ? " · " + esc(person(data.ersteller)) : ""}`,
    data.abgeschlossenAm ? `Abgeschlossen: ${fmtDatum(data.abgeschlossenAm)}${person(data.abschliesser) ? " · " + esc(person(data.abschliesser)) : ""}` : "",
  ].filter(Boolean).join(" &nbsp;|&nbsp; ");

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Pickup ${esc(data.name)}</title><style>${css}</style></head><body>
    <div class="hdr">
      <div class="ttl">Pickup — Abschlussbericht</div>
      <div class="name">${esc(data.name)}</div>
      <div class="meta">${meta}</div>
      ${data.bemerkung ? `<div class="note">📝 ${esc(data.bemerkung)}</div>` : ""}
    </div>
    <div class="sum">
      <div class="box"><div class="n">${gesamt}</div><div class="l">Gesamt</div></div>
      <div class="box"><div class="n" style="color:#04713f">${gefunden}</div><div class="l">Gefunden</div></div>
      <div class="box"><div class="n" style="color:#b3261e">${nichtGefunden}</div><div class="l">Nicht gefunden</div></div>
      <div class="box"><div class="n" style="color:#202F61">${pct}%</div><div class="l">Quote</div></div>
    </div>
    <table>
      <thead><tr><th>LogID</th><th>Colli</th><th>Stellplatz</th><th>Bezeichnung</th><th>Status</th><th>Gefunden von</th><th>Gefunden am</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#aaa;padding:6mm">Keine Positionen</td></tr>'}</tbody>
    </table>
    <div class="ftr">${gefunden}/${gesamt} gefunden · Gedruckt: ${new Date().toLocaleString("de-DE")}</div>
  </body></html>`;

  w.document.open();
  w.document.write(html.replace("</body>", PRINT_SCRIPT + "</body>"));
  w.document.close();
}

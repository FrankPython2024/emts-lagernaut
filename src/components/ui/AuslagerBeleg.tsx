"use client";
import QRCode from "qrcode";
import { normalizeLogId, formatLogId } from "@/lib/pickup/logId";

// ── Auslager-Etikett 55×30 mm (Thermodrucker) ────────────────────────────────
//
// ⚠️ Nur reines Schwarz, alles fett, nichts unter 6,5 pt (Frank, 29.09.2026:
// „ganz schön blass die LogID, erkennt man gar nicht"). Ein Thermodrucker kennt
// nur Schwarz/Weiß — Grau (#555/#888) und Farbe (Orange bei „Direkt", farbige
// Grading-Plakette mit weißer Schrift) werden zu einem Punktraster und drucken
// blass bzw. unlesbar. Genau dort standen LogID, Techniker und Beleg-Nr.
// Deshalb: LogID groß (11 pt) in eigener Zeile, Grading als schwarz umrandetes
// Kästchen, kein Emoji. EINE Vorlage (`etikettHtml` + `ETIKETT_CSS`) für
// Vorschau, Einzel- und Sammeldruck — vorher stand das Etikett dreimal im Code.
//
// QR-Code = die LogID in der Schreibweise mit Punkten, „212.574.254" (Frank,
// 29.09.2026). Vorher stand darin „AL:<Beleg-Nr>", was nirgends in Lagernaut
// ausgewertet wurde — Deko. Die Punkte stören kein Scanfeld (überall wird per
// normalizeLogId auf Ziffern reduziert); der Punkt gehört zum alphanumerischen
// QR-Zeichensatz, der Code bleibt Version 1 mit gleich großen Modulen.
// Ohne LogID gibt es keinen QR-Code statt eines irreführenden.

export type AuslagerBelegData = {
  belegNr:            string;
  artikelBezeichnung: string;
  lagerplatz:         string | null | undefined;
  kategorie:          string;
  grading:            string | null | undefined;
  techniker:          string;
  logId:              string;
  geraeteName?:       string;
  restBestand:        number;
  kommentar?:         string;
  ersteller:          string;
  datum:              Date | string;
  // DIREKT-Buchung: kein Lagerbezug
  istDirekt?:         boolean;
};

// ── Hilfsfunktionen ────────────────────────────────────────────────────────────

// "ETL-7-2-5" → "R7 · E2 · F5"
function etlKlartext(code: string): string | null {
  const m = code.match(/^ETL-(\d+)-(\d+)-(\d+)$/i);
  if (!m) return null;
  return `R${m[1]} · E${m[2]} · F${m[3]}`;
}

function esc(s: string | null | undefined): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Inhalt des QR-Codes: LogID mit Punkten („212.574.254"), sonst nichts. */
export function qrInhalt(d: Pick<AuslagerBelegData, "logId">): string | null {
  const ziffern = normalizeLogId(d.logId);
  return ziffern.length >= 6 ? formatLogId(ziffern) : null;
}

async function qrFuer(d: AuslagerBelegData): Promise<string> {
  const inhalt = qrInhalt(d);
  return inhalt ? genQrSvg(inhalt) : "";
}

// ── QR-Code als SVG Data-URL ─────────────────────────────────────────────────

async function genQrSvg(content: string): Promise<string> {
  const svg = await QRCode.toString(content, {
    type:                 "svg",
    margin:               1,
    errorCorrectionLevel: "M",
    color:                { dark: "#000000", light: "#ffffff" },
  });
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

// ── Die EINE Etikett-Vorlage ─────────────────────────────────────────────────

const ETIKETT_CSS = `
  .al    { width: 55mm; height: 30mm; padding: 1.5mm 1.8mm; display: flex; gap: 1.5mm; overflow: hidden;
           background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; }
  .left  { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; }
  .kopf  { display: flex; align-items: center; gap: 1.2mm; font-size: 7pt; font-weight: 900; letter-spacing: .4px; line-height: 1.1; }
  .gr    { border: 0.35mm solid #000; padding: 0 0.8mm; font-size: 7pt; font-weight: 900; line-height: 1.15; }
  .bez   { font-weight: 700; line-height: 1.12; word-break: break-word; overflow: hidden;
           display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .zeile { display: flex; align-items: baseline; gap: 1.2mm; white-space: nowrap; overflow: hidden; }
  .logid { font-size: 11pt; font-weight: 900; letter-spacing: .2px; line-height: 1.05; }
  .tech  { font-size: 7.5pt; font-weight: 900; }
  .ort   { font-size: 7pt; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.15; }
  .bnr   { font-size: 6.5pt; font-weight: 700; line-height: 1.1; }
  .right { width: 14.5mm; display: flex; flex-direction: column; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .emts  { font-size: 6.5pt; font-weight: 900; letter-spacing: 1.5px; }
  .qr    { width: 14mm; height: 14mm; image-rendering: pixelated; }
`;

function etikettHtml(d: AuslagerBelegData, qr: string): string {
  const lp = d.istDirekt ? null : d.lagerplatz;
  const kt = lp ? etlKlartext(lp) : null;
  const ort = d.istDirekt ? "ohne Lagerbezug" : lp ? `${lp}${kt ? ` · ${kt}` : ""}` : "—";
  // Lange Bezeichnungen etwas kleiner, damit zwei Zeilen reichen.
  const bezPt = d.artikelBezeichnung.length > 34 ? "7.5pt" : d.artikelBezeichnung.length > 22 ? "8pt" : "9pt";
  return `<div class="al">
      <div class="left">
        <div class="kopf"><span>${d.istDirekt ? "DIREKT" : "AUSLAGERUNG"}</span>${d.grading ? `<span class="gr">${esc(d.grading)}</span>` : ""}</div>
        <div class="bez" style="font-size:${bezPt}">${esc(d.artikelBezeichnung)}</div>
        <div class="zeile"><span class="logid">${esc(d.logId) || "—"}</span><span class="tech">${esc(d.techniker)}</span></div>
        <div class="ort">${esc(ort)}</div>
        <div class="bnr">${esc(d.belegNr)}</div>
      </div>
      <div class="right"><div class="emts">EMTS</div>${qr ? `<img class="qr" src="${qr}" alt="" />` : `<div class="qr"></div>`}</div>
    </div>`;
}

// ── HTML-Builder (für iframe-Vorschau und Einzeldruck) ───────────────────────

export async function buildAuslagerBelegHtml(data: AuslagerBelegData): Promise<string> {
  const qr = await qrFuer(data);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @media screen {
      body { margin: 0; padding: 0; width: 342px; height: 192px; overflow: hidden; background: #fff;
             display: flex; align-items: center; justify-content: center; }
      .wrap { transform: scale(1.64); transform-origin: center; display: inline-block; flex-shrink: 0; }
    }
    @media print {
      @page { size: 55mm 30mm; margin: 0; }
      body { margin: 0; padding: 0; width: 55mm; height: 30mm; overflow: hidden; background: #fff;
             display: flex; align-items: center; justify-content: center; }
      .wrap { transform: none; display: inline-block; }
    }
    ${ETIKETT_CSS}
  </style></head><body>
    <div class="wrap">${etikettHtml(data, qr)}</div>
  </body></html>`;
}

// ── Direkt-Druck einzeln (neues Fenster — window.open VOR await!) ─────────────

const PRINT_SCRIPT = `<script>(function(){function p(){window.focus();window.print();}document.readyState==='complete'?p():window.addEventListener('load',p);})();</script>`;

export async function printAuslagerBeleg(data: AuslagerBelegData): Promise<void> {
  const w = window.open("", "_blank", "width=400,height=300");
  if (!w) { console.warn("Popup blockiert — Popup-Blocker deaktivieren"); return; }

  const html = await buildAuslagerBelegHtml(data);
  w.document.open();
  w.document.write(html.replace("</body>", PRINT_SCRIPT + "</body>"));
  w.document.close();
}

// ── Mehrere Belege (ein Fenster, page-break-after) ────────────────────────────

export async function printMehrereAuslagerBelege(liste: AuslagerBelegData[]): Promise<void> {
  const w = window.open("", "_blank", "width=400,height=250");
  if (!w) { console.warn("Popup blockiert — Popup-Blocker deaktivieren"); return; }

  const entries = await Promise.all(
    liste.map(async (d) => ({ d, qr: await qrFuer(d) })),
  );

  const css = `
    @page { size: 55mm 30mm; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; padding: 0; background: #fff; }
    .lw   { width: 55mm; height: 30mm; overflow: hidden; page-break-after: always; }
    .lw:last-child { page-break-after: avoid; }
    ${ETIKETT_CSS}
  `;
  const body = entries.map(({ d, qr }) => `<div class="lw">${etikettHtml(d, qr)}</div>`).join("\n");

  w.document.open();
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${css}</style></head><body>${body}${PRINT_SCRIPT}</body></html>`);
  w.document.close();
}

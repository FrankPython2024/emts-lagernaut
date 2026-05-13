"use client";
import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";

export type EinlagerBelegData = {
  belegNr:            string;
  artikelBezeichnung: string;
  lagerplatz:         string | null | undefined;
  kategorie:          string;
  menge:              number;
  neuerBestand:       number;
  notiz?:             string;
  grading?:           string;
  ersteller:          string;
  datum:              Date | string;
};

function gradingFarbe(g?: string): string {
  switch (g) {
    case "A+": return "#04B475";
    case "A":  return "#04B475";
    case "B":  return "#008BD2";
    case "C":  return "#F59E0B";
    default:   return "#94A3B8";
  }
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

// ── Label-Inhalt (55×30mm, inline-Styles, Thermodruck-optimiert) ─────────────

function EinlagerBelegInner({ data, qr }: { data: EinlagerBelegData; qr: string }) {
  return (
    <div style={{
      width: "55mm", height: "30mm",
      border: "none",
      padding: "1.5mm", display: "flex", flexDirection: "row", gap: "1.5mm",
      fontFamily: "Arial, Helvetica, sans-serif",
      backgroundColor: "#fff", color: "#000",
      boxSizing: "border-box", overflow: "hidden",
    }}>
      {/* LINKE SEITE */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", overflow: "hidden" }}>
        {/* Z1: Typ */}
        <div style={{ fontSize: "7pt", fontWeight: "bold", letterSpacing: "0.5px" }}>EINLAGERUNG</div>

        {/* Z2: Bezeichnung */}
        <div style={{
          fontSize: data.artikelBezeichnung.length > 22 ? "7.5pt" : "9pt",
          fontWeight: "bold", lineHeight: 1.2,
          wordBreak: "break-word", overflow: "hidden",
          display: "-webkit-box", WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical" as const,
        }}>
          {data.artikelBezeichnung}
        </div>

        {/* Z3: Grading + Lagerplatz + Menge */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "7pt", gap: "1mm" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "1mm", overflow: "hidden" }}>
            {data.grading && (
              <span style={{ background: gradingFarbe(data.grading), color: "#fff", fontWeight: "bold", fontSize: "6pt", padding: "0.3mm 1mm", borderRadius: "0.5mm", flexShrink: 0 }}>
                {data.grading}
              </span>
            )}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: "bold" }}>
              {data.lagerplatz ?? "—"}
            </span>
          </div>
          <span style={{ fontWeight: "bold", color: "#006600", whiteSpace: "nowrap", flexShrink: 0 }}>
            +{data.menge} Stk
          </span>
        </div>

        {/* Z4: BelegNr */}
        <div style={{ fontSize: "6pt", color: "#666" }}>{data.belegNr}</div>
      </div>

      {/* RECHTE SEITE — EMTS oben, QR unten */}
      <div style={{
        width: "16mm", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "space-between", flexShrink: 0,
      }}>
        <div style={{ fontSize: "6pt", fontWeight: "bold", letterSpacing: "2px", color: "#000", textAlign: "center" }}>
          EMTS
        </div>
        {qr
          ? <img src={qr} alt="QR" style={{ width: "14mm", height: "14mm", imageRendering: "pixelated" }} />
          : <div style={{ width: "14mm", height: "14mm", background: "#f0f0f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "6px", color: "#999" }}>QR…</div>
        }
      </div>
    </div>
  );
}

// ── Print-CSS (identisch mit ArtikelLabel) ────────────────────────────────────

const PRINT_CSS_ID = "__lagernaut_einlager_print";

function injectPrintCss(cssId: string) {
  document.getElementById(PRINT_CSS_ID)?.remove();
  const style = document.createElement("style");
  style.id    = PRINT_CSS_ID;
  style.innerHTML = `
    @media print {
      @page { size: 55mm 30mm; margin: 0mm; }
      html, body { width: 55mm !important; height: 30mm !important; margin: 0 !important; padding: 0 !important;
                   display: flex !important; align-items: center !important; justify-content: center !important; }
      body * { visibility: hidden !important; }
      #${cssId} { visibility: visible !important; display: block !important; position: fixed !important;
                  left: 0 !important; top: 0 !important; width: 55mm !important; height: 30mm !important;
                  margin: auto !important; padding: 0 !important; box-sizing: border-box !important; }
      #${cssId} * { visibility: visible !important; }
    }
  `;
  document.head.appendChild(style);
}

function removePrintCss() { document.getElementById(PRINT_CSS_ID)?.remove(); }

// ── Manager-Komponente (Portal) ───────────────────────────────────────────────

type ManagerProps = {
  data:     EinlagerBelegData;
  onReady?: (printFn: () => void) => void;
};

export function EinlagerBelegManager({ data, onReady }: ManagerProps) {
  const [qr,      setQr]      = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { genQrSvg(`EL:${data.belegNr}`).then(setQr); }, [data.belegNr]);

  const cssId   = `einlager_${data.belegNr.replace(/-/g, "_")}`;
  const printFn = useCallback(() => {
    injectPrintCss(cssId);
    setTimeout(() => {
      window.print();
      setTimeout(removePrintCss, 1000);
    }, 150);
  }, [cssId]);

  useEffect(() => { if (qr && onReady) onReady(printFn); }, [qr, onReady, printFn]);

  if (!mounted) return null;
  return createPortal(
    <div id={cssId} style={{ position: "fixed", left: "-9999px", top: 0, visibility: "hidden" }}>
      <EinlagerBelegInner data={data} qr={qr} />
    </div>,
    document.body,
  );
}

// ── HTML-Builder (für iframe-Vorschau und Druck) ─────────────────────────────
// @media screen: label skaliert auf 342×192px für iframe-Vorschau
// @media print:  label exakt 55×30mm für Thermodrucker

function gradingBadgeHtml(grading?: string): string {
  if (!grading) return "";
  const farbe = gradingFarbe(grading);
  return `<span class="gr" style="background:${farbe}">${grading}</span>`;
}

export async function buildEinlagerBelegHtml(data: EinlagerBelegData): Promise<string> {
  const qr  = await genQrSvg(`EL:${data.belegNr}`);
  const bez = data.artikelBezeichnung.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const lp  = (data.lagerplatz ?? "—").replace(/&/g, "&amp;");
  const sm  = data.artikelBezeichnung.length > 22 ? "7.5pt" : "9pt";

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: Arial, Helvetica, sans-serif; }
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
    .el   { width: 55mm; height: 30mm; padding: 1.5mm; display: flex; gap: 1.5mm; overflow: hidden; background: #fff; color: #000; }
    .left { flex: 1; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; }
    .typ  { font-size: 7pt; font-weight: bold; letter-spacing: .5px; }
    .bez  { font-size: ${sm}; font-weight: bold; line-height: 1.2; word-break: break-word; overflow: hidden;
            display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .row3 { display: flex; justify-content: space-between; align-items: center; font-size: 7pt; gap: 1mm; }
    .lpi  { display: flex; align-items: center; gap: 1mm; overflow: hidden; }
    .gr   { color: #fff; font-weight: bold; font-size: 6pt; padding: 0.3mm 1mm; border-radius: 0.5mm; flex-shrink: 0; }
    .lp   { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: bold; }
    .mng  { font-weight: bold; color: #006600; white-space: nowrap; flex-shrink: 0; }
    .bnr  { font-size: 6pt; color: #666; }
    .right { width: 16mm; display: flex; flex-direction: column; align-items: center; justify-content: space-between; flex-shrink: 0; }
    .emts { font-size: 6pt; font-weight: bold; letter-spacing: 2px; }
    .qr   { width: 14mm; height: 14mm; }
  </style></head><body>
    <div class="wrap"><div class="el">
      <div class="left">
        <div class="typ">EINLAGERUNG</div>
        <div class="bez">${bez}</div>
        <div class="row3">
          <div class="lpi">${gradingBadgeHtml(data.grading)}<span class="lp">${lp}</span></div>
          <span class="mng">+${data.menge} Stk</span>
        </div>
        <div class="bnr">${data.belegNr}</div>
      </div>
      <div class="right"><div class="emts">EMTS</div><img class="qr" src="${qr}" alt="" /></div>
    </div></div>
  </body></html>`;
}

// ── Direkt-Druck (neues Fenster — window.open VOR await!) ─────────────────────

export async function printEinlagerBeleg(data: EinlagerBelegData): Promise<void> {
  const w = window.open("", "_blank", "width=400,height=300");
  if (!w) { console.warn("Popup blockiert — Popup-Blocker deaktivieren"); return; }

  const html = await buildEinlagerBelegHtml(data);
  const ps   = `<script>(function(){function p(){window.focus();window.print();}document.readyState==='complete'?p():window.addEventListener('load',p);})();</script>`;

  w.document.open();
  w.document.write(html.replace("</body>", ps + "</body>"));
  w.document.close();
}

// ── Multi-Beleg-Druck (alle in einem Fenster, mit Seitenumbrüchen) ────────────

export async function printAlleEinlagerBelege(belege: EinlagerBelegData[]): Promise<void> {
  if (belege.length === 0) return;
  // Popup-Blocker: window.open MUSS VOR jedem await stehen!
  const w = window.open("", "_blank", "width=400,height=300");
  if (!w) { console.warn("[printAlleEinlagerBelege] Popup blockiert"); return; }

  const qrCodes = await Promise.all(belege.map((b) => genQrSvg(`EL:${b.belegNr}`)));

  const labels = belege.map((b, i) => {
    const bez  = b.artikelBezeichnung.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const lp   = (b.lagerplatz ?? "—").replace(/&/g, "&amp;");
    const sm   = b.artikelBezeichnung.length > 22 ? "7.5pt" : "9pt";
    const last = i === belege.length - 1;
    return `<div class="wrap${last ? "" : " pb"}">
      <div class="el">
        <div class="left">
          <div class="typ">EINLAGERUNG</div>
          <div class="bez" style="font-size:${sm}">${bez}</div>
          <div class="row3">
            <div class="lpi">${gradingBadgeHtml(b.grading)}<span class="lp">${lp}</span></div>
            <span class="mng">+${b.menge} Stk</span>
          </div>
          <div class="bnr">${b.belegNr}</div>
        </div>
        <div class="right"><div class="emts">EMTS</div><img class="qr" src="${qrCodes[i]}" alt="" /></div>
      </div>
    </div>`;
  }).join("\n");

  const scaledGap = Math.round(192 * 0.64 + 16);
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: Arial, Helvetica, sans-serif; }
    @media screen {
      body { margin: 0; padding: 16px; background: #f0f0f0; display: flex; flex-direction: column; align-items: flex-start; gap: ${scaledGap}px; }
      .wrap { transform: scale(1.64); transform-origin: top left; display: inline-block; flex-shrink: 0; }
    }
    @media print {
      @page { size: 55mm 30mm; margin: 0; }
      body { margin: 0; padding: 0; }
      .wrap { display: block; }
      .pb { page-break-after: always; }
    }
    .el   { width: 55mm; height: 30mm; padding: 1.5mm; display: flex; gap: 1.5mm; overflow: hidden; background: #fff; color: #000; }
    .left { flex: 1; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; }
    .typ  { font-size: 7pt; font-weight: bold; letter-spacing: .5px; }
    .bez  { font-weight: bold; line-height: 1.2; word-break: break-word; overflow: hidden;
            display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .row3 { display: flex; justify-content: space-between; align-items: center; font-size: 7pt; gap: 1mm; }
    .lpi  { display: flex; align-items: center; gap: 1mm; overflow: hidden; }
    .gr   { color: #fff; font-weight: bold; font-size: 6pt; padding: 0.3mm 1mm; border-radius: 0.5mm; flex-shrink: 0; }
    .lp   { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: bold; }
    .mng  { font-weight: bold; color: #006600; white-space: nowrap; flex-shrink: 0; }
    .bnr  { font-size: 6pt; color: #666; }
    .right { width: 16mm; display: flex; flex-direction: column; align-items: center; justify-content: space-between; flex-shrink: 0; }
    .emts { font-size: 6pt; font-weight: bold; letter-spacing: 2px; }
    .qr   { width: 14mm; height: 14mm; image-rendering: pixelated; }
  </style></head><body>
    ${labels}
    <script>(function(){function p(){window.focus();window.print();}document.readyState==='complete'?p():window.addEventListener('load',p);})();</script>
  </body></html>`;

  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ── Vorschau (Bildschirm, skaliert) ──────────────────────────────────────────

export function EinlagerBelegPreview({ data, scale = 1 }: { data: EinlagerBelegData; scale?: number }) {
  const [qr, setQr] = useState("");
  useEffect(() => { genQrSvg(`EL:${data.belegNr}`).then(setQr); }, [data.belegNr]);

  const inner = <EinlagerBelegInner data={data} qr={qr} />;
  if (scale === 1) return inner;
  return (
    <div style={{ position: "relative", width: `${208 * scale}px`, height: `${113 * scale}px`, overflow: "hidden" }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", display: "inline-block" }}>
        {inner}
      </div>
    </div>
  );
}

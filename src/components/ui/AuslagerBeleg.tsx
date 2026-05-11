"use client";
import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";

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
};

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

function AuslagerBelegInner({ data, qr }: { data: AuslagerBelegData; qr: string }) {
  const grading = data.grading ?? "A+";

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
        {/* Z1: Typ + Grade */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1mm" }}>
          <span style={{ fontSize: "7pt", fontWeight: "bold", letterSpacing: "0.5px" }}>AUSLAGERUNG</span>
          <span style={{ fontSize: "6pt", color: "#444", whiteSpace: "nowrap", flexShrink: 0 }}>
            {grading}
          </span>
        </div>

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

        {/* Z3: Techniker · LogID */}
        <div style={{ fontSize: "7pt", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {data.techniker} · {data.logId}
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

const PRINT_CSS_ID = "__lagernaut_auslager_print";

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
  data:     AuslagerBelegData;
  onReady?: (printFn: () => void) => void;
};

export function AuslagerBelegManager({ data, onReady }: ManagerProps) {
  const [qr,      setQr]      = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { genQrSvg(`AL:${data.belegNr}`).then(setQr); }, [data.belegNr]);

  const cssId   = `auslager_${data.belegNr.replace(/-/g, "_")}`;
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
      <AuslagerBelegInner data={data} qr={qr} />
    </div>,
    document.body,
  );
}

// ── HTML-Builder (für iframe-Vorschau und Druck) ─────────────────────────────

export async function buildAuslagerBelegHtml(data: AuslagerBelegData): Promise<string> {
  const qr      = await genQrSvg(`AL:${data.belegNr}`);
  const grading = data.grading ?? "A+";
  const bez  = data.artikelBezeichnung.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const tech = data.techniker.replace(/&/g, "&amp;");
  const log  = data.logId.replace(/&/g, "&amp;");
  const sm   = data.artikelBezeichnung.length > 22 ? "7.5pt" : "9pt";

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
    .al   { width: 55mm; height: 30mm; padding: 1.5mm; display: flex; gap: 1.5mm; overflow: hidden; background: #fff; color: #000; }
    .left { flex: 1; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; }
    .z1   { display: flex; justify-content: space-between; align-items: baseline; gap: 1mm; }
    .typ  { font-size: 7pt; font-weight: bold; letter-spacing: .5px; }
    .grd  { font-size: 6pt; color: #444; white-space: nowrap; flex-shrink: 0; }
    .bez  { font-size: ${sm}; font-weight: bold; line-height: 1.2; word-break: break-word; overflow: hidden;
            display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .z3   { font-size: 7pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bnr  { font-size: 6pt; color: #666; }
    .right { width: 16mm; display: flex; flex-direction: column; align-items: center; justify-content: space-between; flex-shrink: 0; }
    .emts { font-size: 6pt; font-weight: bold; letter-spacing: 2px; }
    .qr   { width: 14mm; height: 14mm; }
  </style></head><body>
    <div class="wrap"><div class="al">
      <div class="left">
        <div class="z1"><span class="typ">AUSLAGERUNG</span><span class="grd">${grading}</span></div>
        <div class="bez">${bez}</div>
        <div class="z3">${tech} · ${log}</div>
        <div class="bnr">${data.belegNr}</div>
      </div>
      <div class="right"><div class="emts">EMTS</div><img class="qr" src="${qr}" alt="" /></div>
    </div></div>
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
  // window.open MUSS synchron (vor await) aufgerufen werden
  const w = window.open("", "_blank", "width=400,height=250");
  if (!w) { console.warn("Popup blockiert — Popup-Blocker deaktivieren"); return; }

  const entries = await Promise.all(
    liste.map(async (d) => ({ d, qr: await genQrSvg(`AL:${d.belegNr}`) })),
  );

  const css = `
    @page { size: 55mm 30mm; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background: #fff; }
    .lw   { width: 55mm; height: 30mm; overflow: hidden; page-break-after: always; }
    .lw:last-child { page-break-after: avoid; }
    .al   { width: 55mm; height: 30mm; padding: 1.5mm; display: flex; gap: 1.5mm; overflow: hidden; }
    .left { flex: 1; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; }
    .z1   { display: flex; justify-content: space-between; align-items: baseline; gap: 1mm; }
    .typ  { font-size: 7pt; font-weight: bold; letter-spacing: .5px; }
    .grd  { font-size: 6pt; color: #444; white-space: nowrap; flex-shrink: 0; }
    .bez  { font-size: 9pt; font-weight: bold; line-height: 1.2; word-break: break-word; overflow: hidden;
            display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .bez.sm { font-size: 7.5pt; }
    .z3   { font-size: 7pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bnr  { font-size: 6pt; color: #666; }
    .right { width: 16mm; display: flex; flex-direction: column; align-items: center; justify-content: space-between; flex-shrink: 0; }
    .emts { font-size: 6pt; font-weight: bold; letter-spacing: 2px; }
    .qr   { width: 14mm; height: 14mm; }
  `;

  const body = entries.map(({ d, qr }) => {
    const bez  = d.artikelBezeichnung.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const tech = d.techniker.replace(/&/g, "&amp;");
    const log  = d.logId.replace(/&/g, "&amp;");
    const sm   = d.artikelBezeichnung.length > 22 ? " sm" : "";
    const gr   = (d.grading ?? "A+").replace(/&/g, "&amp;");
    return `
      <div class="lw"><div class="al">
        <div class="left">
          <div class="z1"><span class="typ">AUSLAGERUNG</span><span class="grd">${gr}</span></div>
          <div class="bez${sm}">${bez}</div>
          <div class="z3">${tech} · ${log}</div>
          <div class="bnr">${d.belegNr}</div>
        </div>
        <div class="right"><div class="emts">EMTS</div><img class="qr" src="${qr}" alt="" /></div>
      </div></div>`;
  }).join("\n");

  w.document.open();
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${css}</style></head><body>${body}${PRINT_SCRIPT}</body></html>`);
  w.document.close();
}

// ── Vorschau (Bildschirm, skaliert) ──────────────────────────────────────────

export function AuslagerBelegPreview({ data, scale = 1 }: { data: AuslagerBelegData; scale?: number }) {
  const [qr, setQr] = useState("");
  useEffect(() => { genQrSvg(`AL:${data.belegNr}`).then(setQr); }, [data.belegNr]);

  const inner = <AuslagerBelegInner data={data} qr={qr} />;
  if (scale === 1) return inner;
  return (
    <div style={{ position: "relative", width: `${208 * scale}px`, height: `${113 * scale}px`, overflow: "hidden" }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", display: "inline-block" }}>
        {inner}
      </div>
    </div>
  );
}

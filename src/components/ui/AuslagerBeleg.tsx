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
  // DIREKT-Buchung: kein Lagerbezug, Lagerplatz wird durch "⚙️ Direkt" ersetzt
  istDirekt?:         boolean;
};

// ── Hilfsfunktionen ────────────────────────────────────────────────────────────

function gradingFarbe(g?: string | null): string {
  switch (g) {
    case "A+": return "#04B475";
    case "A":  return "#04B475";
    case "B":  return "#008BD2";
    case "C":  return "#F59E0B";
    default:   return "#94A3B8";
  }
}

// "ETL-7-2-5" → "R7 · E2 · F5"
function etlKlartext(code: string): string | null {
  const m = code.match(/^ETL-(\d+)-(\d+)-(\d+)$/i);
  if (!m) return null;
  return `R${m[1]} · E${m[2]} · F${m[3]}`;
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
// Layout: AUSLAGERUNG+Grading | Bezeichnung | Lagerplatz | Techniker·LogID | BelegNr

function AuslagerBelegInner({ data, qr }: { data: AuslagerBelegData; qr: string }) {
  const grading  = data.grading;
  const lp       = data.istDirekt ? null : data.lagerplatz;
  const klartext = lp ? etlKlartext(lp) : null;

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
        {/* Z1: Typ + Grading-Badge */}
        <div style={{ display: "flex", alignItems: "center", gap: "1mm" }}>
          <span style={{ fontSize: "7pt", fontWeight: "bold", letterSpacing: "0.5px" }}>
            {data.istDirekt ? "DIREKT" : "AUSLAGERUNG"}
          </span>
          {grading && (
            <span style={{
              background: gradingFarbe(grading), color: "#fff", fontWeight: "bold",
              fontSize: "6pt", padding: "0.3mm 1mm", borderRadius: "0.5mm", flexShrink: 0,
            }}>
              {grading}
            </span>
          )}
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

        {/* Z3: Lagerplatz + ETL-Klartext (oder DIREKT-Hinweis) */}
        <div style={{ overflow: "hidden" }}>
          {data.istDirekt ? (
            <div style={{ fontSize: "6.5pt", fontWeight: "bold", color: "#b45309", whiteSpace: "nowrap" }}>
              ⚙️ Direkt · ohne Lagerbezug
            </div>
          ) : (
            <>
              <div style={{
                fontSize: "7pt", fontWeight: "bold",
                fontFamily: "monospace, Arial, sans-serif",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>
                {lp ?? "—"}
              </div>
              {klartext && (
                <div style={{ fontSize: "6pt", color: "#555", whiteSpace: "nowrap" }}>{klartext}</div>
              )}
            </>
          )}
        </div>

        {/* Z4: Techniker · LogID */}
        <div style={{ fontSize: "6pt", color: "#555", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {data.techniker} · {data.logId}
        </div>

        {/* Z5: BelegNr */}
        <div style={{ fontSize: "5.5pt", color: "#888" }}>{data.belegNr}</div>
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

// ── Print-CSS ─────────────────────────────────────────────────────────────────

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

function gradingBadgeHtml(g?: string | null): string {
  if (!g) return "";
  return `<span class="gr" style="background:${gradingFarbe(g)}">${g}</span>`;
}

function lagerplatzHtml(lp?: string | null): string {
  if (!lp) return "<span class=\"lp\">—</span>";
  const kt = etlKlartext(lp);
  const esc = lp.replace(/&/g, "&amp;");
  if (kt) {
    return `<span class="lp">${esc}</span><br><span class="lkt">${kt}</span>`;
  }
  return `<span class="lp">${esc}</span>`;
}

export async function buildAuslagerBelegHtml(data: AuslagerBelegData): Promise<string> {
  const qr      = await genQrSvg(`AL:${data.belegNr}`);
  const bez     = data.artikelBezeichnung.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const tech    = data.techniker.replace(/&/g, "&amp;");
  const log     = data.logId.replace(/&/g, "&amp;");
  const sm      = data.artikelBezeichnung.length > 22 ? "7.5pt" : "9pt";
  const typLabel = data.istDirekt ? "DIREKT" : "AUSLAGERUNG";
  const lpHtml   = data.istDirekt
    ? `<span style="font-size:6.5pt;font-weight:bold;color:#b45309">&#9881;&#65039; Direkt &middot; ohne Lagerbezug</span>`
    : lagerplatzHtml(data.lagerplatz);

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
    .z1   { display: flex; align-items: center; gap: 1mm; }
    .typ  { font-size: 7pt; font-weight: bold; letter-spacing: .5px; }
    .gr   { color: #fff; font-weight: bold; font-size: 6pt; padding: 0.3mm 1mm; border-radius: 0.5mm; flex-shrink: 0; }
    .bez  { font-size: ${sm}; font-weight: bold; line-height: 1.2; word-break: break-word; overflow: hidden;
            display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .lp   { font-size: 7pt; font-weight: bold; font-family: monospace, Arial; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
    .lkt  { font-size: 6pt; color: #555; white-space: nowrap; }
    .z4   { font-size: 6pt; color: #555; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bnr  { font-size: 5.5pt; color: #888; }
    .right { width: 16mm; display: flex; flex-direction: column; align-items: center; justify-content: space-between; flex-shrink: 0; }
    .emts { font-size: 6pt; font-weight: bold; letter-spacing: 2px; }
    .qr   { width: 14mm; height: 14mm; }
  </style></head><body>
    <div class="wrap"><div class="al">
      <div class="left">
        <div class="z1"><span class="typ">${typLabel}</span>${gradingBadgeHtml(data.grading)}</div>
        <div class="bez">${bez}</div>
        <div>${lpHtml}</div>
        <div class="z4">${tech} · ${log}</div>
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
    .z1   { display: flex; align-items: center; gap: 1mm; }
    .typ  { font-size: 7pt; font-weight: bold; letter-spacing: .5px; }
    .gr   { color: #fff; font-weight: bold; font-size: 6pt; padding: 0.3mm 1mm; border-radius: 0.5mm; flex-shrink: 0; }
    .bez  { font-weight: bold; line-height: 1.2; word-break: break-word; overflow: hidden;
            display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .lp   { font-size: 7pt; font-weight: bold; font-family: monospace, Arial; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
    .lkt  { font-size: 6pt; color: #555; white-space: nowrap; }
    .z4   { font-size: 6pt; color: #555; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bnr  { font-size: 5.5pt; color: #888; }
    .right { width: 16mm; display: flex; flex-direction: column; align-items: center; justify-content: space-between; flex-shrink: 0; }
    .emts { font-size: 6pt; font-weight: bold; letter-spacing: 2px; }
    .qr   { width: 14mm; height: 14mm; }
  `;

  const body = entries.map(({ d, qr }) => {
    const bez      = d.artikelBezeichnung.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const tech     = d.techniker.replace(/&/g, "&amp;");
    const log      = d.logId.replace(/&/g, "&amp;");
    const sm       = d.artikelBezeichnung.length > 22 ? "7.5pt" : "9pt";
    const typLabel = d.istDirekt ? "DIREKT" : "AUSLAGERUNG";
    const lpHtml   = d.istDirekt
      ? `<span style="font-size:6.5pt;font-weight:bold;color:#b45309">&#9881;&#65039; Direkt &middot; ohne Lagerbezug</span>`
      : lagerplatzHtml(d.lagerplatz);
    return `
      <div class="lw"><div class="al">
        <div class="left">
          <div class="z1"><span class="typ">${typLabel}</span>${gradingBadgeHtml(d.grading)}</div>
          <div class="bez" style="font-size:${sm}">${bez}</div>
          <div>${lpHtml}</div>
          <div class="z4">${tech} · ${log}</div>
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

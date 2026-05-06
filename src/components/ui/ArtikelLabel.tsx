"use client";
import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";

export type LabelArtikel = {
  id:          number;
  bezeichnung: string;
  lagerplatz?: string | null;
  kategorie:   string;
  hersteller?: string | null;
};

// ──────────────────────────────────────────────────────────────────────────────
// QR-Code als SVG Data-URL — scharf bei Thermodruck
// Inhalt: nur Artikel-ID als String ("14", "42" etc.)
// ──────────────────────────────────────────────────────────────────────────────
async function genQrSvg(id: number): Promise<string> {
  const svg = await QRCode.toString(String(id), {
    type:                 "svg",
    margin:               1,
    errorCorrectionLevel: "M",
    color:                { dark: "#000000", light: "#ffffff" },
  });
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Label-Styles (inline, in mm — Thermodruck-optimiert)
// ──────────────────────────────────────────────────────────────────────────────
function LabelInner({ artikel, qr }: { artikel: LabelArtikel; qr: string }) {
  return (
    <div style={{
      width: "55mm", height: "30mm",
      border: "none",
      padding: "1.5mm", display: "flex", flexDirection: "row", gap: "1.5mm",
      fontFamily: "Arial, Helvetica, sans-serif",
      backgroundColor: "#fff", color: "#000",
      boxSizing: "border-box", overflow: "hidden",
    }}>

      {/* LINKE SEITE — Texte */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        justifyContent: "space-between", overflow: "hidden",
      }}>
        {/* Bezeichnung */}
        <div style={{
          fontSize: artikel.bezeichnung.length > 25 ? "8.5pt" : "10pt",
          fontWeight: "bold", lineHeight: 1.2,
          wordBreak: "break-word", overflow: "hidden",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
        }}>
          {artikel.bezeichnung}
        </div>

        {/* Lagerplatz */}
        <div style={{ fontSize: "9pt", fontWeight: "normal", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {artikel.lagerplatz ?? "—"}
        </div>

        {/* Kategorie */}
        <div style={{ fontSize: "7pt", color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {artikel.kategorie}
        </div>
      </div>

      {/* RECHTE SEITE — QR-Code + EMTS darunter */}
      <div style={{ width: "16mm", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0, gap: "1mm" }}>
        {qr
          ? <img src={qr} alt="QR" style={{ width: "16mm", height: "16mm", imageRendering: "pixelated" }} />
          : <div style={{ width: "16mm", height: "16mm", background: "#f0f0f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "6px", color: "#999" }}>QR…</div>
        }
        <div style={{ fontSize: "7pt", fontWeight: "bold", letterSpacing: "2px", color: "#000", textAlign: "center" }}>
          EMTS
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Print-CSS — injiziert in <head>, visibility-Methode (funktioniert mit Portal)
// ──────────────────────────────────────────────────────────────────────────────
const PRINT_CSS_ID = "__lagernaut_label_print";

function injectPrintCss(ids: string[]) {
  const existing = document.getElementById(PRINT_CSS_ID);
  if (existing) existing.remove();

  const visibleRules = ids.map((id) => `
    #${id} { visibility: visible !important; display: block !important; position: fixed !important;
              left: 0 !important; top: 0 !important; width: 55mm !important; height: 30mm !important;
              margin: auto !important; padding: 0 !important; box-sizing: border-box !important; }
    #${id} * { visibility: visible !important; }
  `).join("\n");

  const style = document.createElement("style");
  style.id    = PRINT_CSS_ID;
  style.innerHTML = `
    @media print {
      @page { size: 55mm 30mm; margin: 0mm; }
      html, body { width: 55mm !important; height: 30mm !important; margin: 0 !important; padding: 0 !important; display: flex !important; align-items: center !important; justify-content: center !important; }
      body * { visibility: hidden !important; }
      ${visibleRules}
    }
  `;
  document.head.appendChild(style);
}

function removePrintCss() {
  document.getElementById(PRINT_CSS_ID)?.remove();
}

// ──────────────────────────────────────────────────────────────────────────────
// Haupt-Komponente: rendert Label via Portal + verwaltet Druck
// ──────────────────────────────────────────────────────────────────────────────
type LabelManagerProps = {
  artikel:  LabelArtikel;
  onReady?: (printFn: () => void) => void;
};

export function ArtikelLabelManager({ artikel, onReady }: LabelManagerProps) {
  const [qr,      setQr]      = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { genQrSvg(artikel.id).then(setQr); }, [artikel.id]);

  const printLabel = useCallback(() => {
    injectPrintCss([`label_${artikel.id}`]);
    setTimeout(() => {
      window.print();
      setTimeout(removePrintCss, 1000);
    }, 150);
  }, [artikel.id]);

  useEffect(() => { if (qr && onReady) onReady(printLabel); }, [qr, onReady, printLabel]);

  if (!mounted) return null;

  return createPortal(
    <div
      id={`label_${artikel.id}`}
      style={{ position: "fixed", left: "-9999px", top: 0, visibility: "hidden" }}
    >
      <LabelInner artikel={artikel} qr={qr} />
    </div>,
    document.body,
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Mehrere Labels: eigenes Druckfenster (einfacher bei Bulk-Print)
// ──────────────────────────────────────────────────────────────────────────────
export async function printMehrereLabels(liste: LabelArtikel[]): Promise<void> {
  const entries = await Promise.all(
    liste.map(async (a) => ({ a, qr: await genQrSvg(a.id) })),
  );

  const css = `
    @page { size: 55mm 30mm; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background: #fff;
           display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .lw { width: 55mm; height: 30mm; overflow: hidden; page-break-after: always; margin: auto; }
    .lw:last-child { page-break-after: avoid; }
    .label {
      width: 55mm; height: 30mm;
      border: none;
      padding: 1.5mm; display: flex; flex-direction: row; gap: 1.5mm;
      font-family: Arial, Helvetica, sans-serif;
      background: #fff; color: #000; box-sizing: border-box; overflow: hidden;
    }
    .left { flex: 1; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; }
    .bez { font-size: 10pt; font-weight: bold; line-height: 1.2; word-break: break-word; overflow: hidden;
           display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .bez.sm { font-size: 8.5pt; }
    .lp { font-size: 9pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .kat { font-size: 7pt; color: #555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .qr { width: 16mm; display: flex; flex-direction: column; align-items: center; justify-content: center; flex-shrink: 0; gap: 1mm; }
    .qr img { width: 16mm; height: 16mm; }
    .emts { font-size: 7pt; font-weight: bold; letter-spacing: 2px; text-align: center; }
  `;

  const body = entries.map(({ a, qr }) => {
    const sm = a.bezeichnung.length > 25 ? " sm" : "";
    return `
      <div class="lw"><div class="label">
        <div class="left">
          <div class="bez${sm}">${a.bezeichnung.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</div>
          <div class="lp">${(a.lagerplatz ?? "—").replace(/&/g,"&amp;")}</div>
          <div class="kat">${a.kategorie.replace(/&/g,"&amp;")}</div>
        </div>
        <div class="qr"><img src="${qr}" alt="" /><div class="emts">EMTS</div></div>
      </div></div>`;
  }).join("\n");

  const w = window.open("", "_blank", "width=400,height=250");
  if (!w) return;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${css}</style></head><body>${body}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
}

// ──────────────────────────────────────────────────────────────────────────────
// Vorschau-Komponente (Bildschirm, 2× skaliert)
// ──────────────────────────────────────────────────────────────────────────────
export function ArtikelLabelPreview({ artikel, scale = 1 }: { artikel: LabelArtikel; scale?: number }) {
  const [qr, setQr] = useState("");
  useEffect(() => { genQrSvg(artikel.id).then(setQr); }, [artikel.id]);

  const inner = <LabelInner artikel={artikel} qr={qr} />;

  if (scale === 1) return inner;

  return (
    <div style={{ position: "relative", width: `${208 * scale}px`, height: `${113 * scale}px`, overflow: "hidden" }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", display: "inline-block" }}>
        {inner}
      </div>
    </div>
  );
}

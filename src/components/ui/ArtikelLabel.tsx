"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

export type LabelArtikel = {
  id:          number;
  bezeichnung: string;
  lagerplatz?: string | null;
  kategorie:   string;
  hersteller?: string | null;
};

// ──────────────────────────────────────────────────────────────────────────────
// Print-CSS — 57×32mm Querformat, nur S/W
// ──────────────────────────────────────────────────────────────────────────────
const PRINT_CSS = `
  @page {
    size: 57mm 32mm landscape;
    margin: 0;
  }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background: #fff; }
  .label-wrapper { width: 57mm; height: 32mm; overflow: hidden; }
  .label {
    width: 57mm; height: 32mm;
    border: 0.5pt solid #000;
    border-radius: 0.8mm;
    padding: 2mm;
    display: flex;
    gap: 1.5mm;
    background: #fff;
    color: #000;
    page-break-after: always;
  }
  .label:last-child { page-break-after: avoid; }
  .left {
    flex: 1; min-width: 0;
    display: flex; flex-direction: column; justify-content: space-between;
    overflow: hidden;
  }
  .bezeichnung {
    font-size: 10pt; font-weight: bold; line-height: 1.15;
    overflow: hidden; display: -webkit-box;
    -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    word-break: break-word;
  }
  .bezeichnung.lang { font-size: 8.5pt; }
  .hersteller { font-size: 7pt; color: #555; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lagerplatz { font-size: 9pt; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .kategorie  { font-size: 7pt; color: #555; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .right {
    width: 20mm; flex-shrink: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: space-between;
  }
  .emts { font-size: 6pt; font-weight: bold; letter-spacing: 1pt; align-self: flex-end; color: #000; }
  .qr-wrap { width: 18mm; height: 18mm; display: flex; align-items: center; justify-content: center; }
  .qr-wrap img { width: 18mm; height: 18mm; display: block; image-rendering: pixelated; }
`;

// ──────────────────────────────────────────────────────────────────────────────
// QR-Code als SVG-Data-URL — schärfer als PNG beim Thermodruck
// Inhalt: nur die Artikel-ID als Zahl
// ──────────────────────────────────────────────────────────────────────────────
async function genQrSvg(id: number): Promise<string> {
  const svg = await QRCode.toString(String(id), {
    type:                 "svg",
    margin:               1,
    errorCorrectionLevel: "M",
    color:                { dark: "#000000", light: "#ffffff" },
  });
  // SVG → Data-URL (base64)
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Label HTML-Markup für Druck-Fenster
// ──────────────────────────────────────────────────────────────────────────────
function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildLabelHTML(a: LabelArtikel, qr: string): string {
  const lang = a.bezeichnung.length > 28;
  return `
  <div class="label-wrapper">
    <div class="label">
      <div class="left">
        <div class="bezeichnung${lang ? " lang" : ""}">${esc(a.bezeichnung)}</div>
        ${a.hersteller ? `<div class="hersteller">${esc(a.hersteller)}</div>` : ""}
        <div class="lagerplatz">▶ ${esc(a.lagerplatz ?? "–")}</div>
        <div class="kategorie">${esc(a.kategorie)}</div>
      </div>
      <div class="right">
        <div class="emts">EMTS</div>
        <div class="qr-wrap"><img src="${qr}" alt="" /></div>
      </div>
    </div>
  </div>`;
}

function openPrintWindow(entries: { a: LabelArtikel; qr: string }[]): void {
  const body = entries.map(({ a, qr }) => buildLabelHTML(a, qr)).join("\n");
  const w    = window.open("", "_blank", "width=400,height=250");
  if (!w) return;
  w.document.write(
    `<!DOCTYPE html><html><head><meta charset="UTF-8">` +
    `<style>${PRINT_CSS}</style></head><body>${body}</body></html>`,
  );
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

export async function printArtikelLabel(a: LabelArtikel): Promise<void> {
  const qr = await genQrSvg(a.id);
  openPrintWindow([{ a, qr }]);
}

export async function printMehrereLabels(liste: LabelArtikel[]): Promise<void> {
  const entries = await Promise.all(
    liste.map(async (a) => ({ a, qr: await genQrSvg(a.id) })),
  );
  openPrintWindow(entries);
}

// ──────────────────────────────────────────────────────────────────────────────
// Vorschau-Komponente
// Zeigt das Label in nativer Größe (215×121px @96dpi ≈ 57×32mm)
// ──────────────────────────────────────────────────────────────────────────────
type PreviewProps = {
  artikel: LabelArtikel;
  scale?:  number;   // 1 = native (215×121px), 2 = doppelt (430×242px)
};

export function ArtikelLabelPreview({ artikel, scale = 1 }: PreviewProps) {
  const [qrUrl, setQrUrl] = useState("");

  useEffect(() => {
    genQrSvg(artikel.id).then(setQrUrl);
  }, [artikel.id]);

  const lang  = artikel.bezeichnung.length > 28;

  const base = {
    width:       "215px",
    height:      "121px",
    border:      "1px solid #000",
    borderRadius: "3px",
    padding:     "7.5px",
    display:     "flex",
    gap:         "5px",
    fontFamily:  "Arial, Helvetica, sans-serif",
    background:  "#fff",
    color:       "#000",
    overflow:    "hidden",
    flexShrink:  0,
  } as const;

  const wrapper = scale !== 1 ? {
    transform:       `scale(${scale})`,
    transformOrigin: "top left",
    display:         "inline-block",
  } : {};

  const label = (
    <div style={base}>
      {/* Linke Seite */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "space-between", overflow: "hidden" }}>
        <div style={{
          fontSize: lang ? "9px" : "10.5px", fontWeight: "bold", lineHeight: 1.15,
          overflow: "hidden", display: "-webkit-box",
          WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
          wordBreak: "break-word",
        }}>
          {artikel.bezeichnung}
        </div>

        {artikel.hersteller && (
          <div style={{ fontSize: "7px", color: "#555", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {artikel.hersteller}
          </div>
        )}

        <div style={{ fontSize: "9px", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          ▶ {artikel.lagerplatz ?? "–"}
        </div>

        <div style={{ fontSize: "7px", color: "#555", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {artikel.kategorie}
        </div>
      </div>

      {/* Rechte Seite */}
      <div style={{ width: "75px", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: "6px", fontWeight: "bold", letterSpacing: "1px", alignSelf: "flex-end", color: "#000" }}>
          EMTS
        </div>
        <div style={{ width: "68px", height: "68px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {qrUrl
            ? <img src={qrUrl} alt="QR" style={{ width: "68px", height: "68px", imageRendering: "pixelated" }} />
            : <div style={{ width: "68px", height: "68px", background: "#f0f0f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "7px", color: "#999" }}>QR…</div>
          }
        </div>
      </div>
    </div>
  );

  if (scale === 1) return label;

  return (
    <div style={{ position: "relative", width: `${215 * scale}px`, height: `${121 * scale}px` }}>
      <div style={wrapper}>{label}</div>
    </div>
  );
}

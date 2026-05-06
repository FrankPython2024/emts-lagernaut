"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

export type LabelArtikel = {
  id:          number;
  bezeichnung: string;
  lagerplatz?: string | null;
  kategorie:   string;
};

// ──────────────────────────────────────────────────────────────────────────────
// CSS für 57×32mm Thermodruck — schwarz/weiß, @page exakt
// ──────────────────────────────────────────────────────────────────────────────
const PRINT_CSS = `
  @page { size: 57mm 32mm; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background: #fff; }
  .label {
    width: 57mm; height: 32mm;
    border: 0.5pt solid #000; border-radius: 1mm;
    padding: 2mm; display: flex; gap: 1.5mm;
    overflow: hidden; background: #fff; color: #000;
    page-break-after: always;
  }
  .label:last-child { page-break-after: avoid; }
  .left {
    flex: 1; display: flex; flex-direction: column;
    justify-content: space-between; overflow: hidden; min-width: 0;
  }
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 1mm; }
  .bezeichnung {
    font-size: 9.5pt; font-weight: bold; line-height: 1.2;
    overflow: hidden; display: -webkit-box;
    -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    flex: 1; min-width: 0; word-break: break-word;
  }
  .bezeichnung.lang { font-size: 8pt; }
  .emts {
    font-size: 5.5pt; font-weight: bold; letter-spacing: 1.5pt;
    color: #333; flex-shrink: 0; margin-top: 0.5mm; text-align: right;
  }
  .lagerplatz {
    font-size: 8pt; font-weight: 500;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .kategorie {
    font-size: 6pt; color: #555;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .qr-wrap {
    width: 22mm; height: 22mm; flex-shrink: 0;
    align-self: center; display: flex; align-items: center; justify-content: center;
  }
  .qr-wrap img { width: 22mm; height: 22mm; display: block; image-rendering: pixelated; }
`;

// ──────────────────────────────────────────────────────────────────────────────
// Hilfsfunktionen
// ──────────────────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function genQr(artikel: LabelArtikel): Promise<string> {
  return QRCode.toDataURL(
    `LAGERNAUT:ARTIKEL:${artikel.id}:${artikel.bezeichnung}`,
    { width: 264, margin: 1, color: { dark: "#000000", light: "#ffffff" } },
  );
}

function labelHTML(artikel: LabelArtikel, qr: string): string {
  const lang = artikel.bezeichnung.length > 28;
  return `
    <div class="label">
      <div class="left">
        <div class="top">
          <div class="bezeichnung${lang ? " lang" : ""}">${esc(artikel.bezeichnung)}</div>
          <div class="emts">EMTS</div>
        </div>
        <div class="lagerplatz">${esc(artikel.lagerplatz ?? "–")}</div>
        <div class="kategorie">${esc(artikel.kategorie)}</div>
      </div>
      <div class="qr-wrap"><img src="${qr}" alt="QR" /></div>
    </div>`;
}

function openPrintWindow(entries: { artikel: LabelArtikel; qr: string }[]): void {
  const body = entries.map(({ artikel, qr }) => labelHTML(artikel, qr)).join("\n");
  const w    = window.open("", "_blank", "width=450,height=320");
  if (!w) return;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${PRINT_CSS}</style></head><body>${body}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

/** Ein Label drucken */
export async function printArtikelLabel(artikel: LabelArtikel): Promise<void> {
  const qr = await genQr(artikel);
  openPrintWindow([{ artikel, qr }]);
}

/** Mehrere Labels drucken (je 57×32mm pro Seite) */
export async function printMehrereLabels(artikelListe: LabelArtikel[]): Promise<void> {
  const entries = await Promise.all(
    artikelListe.map(async (artikel) => ({ artikel, qr: await genQr(artikel) })),
  );
  openPrintWindow(entries);
}

// ──────────────────────────────────────────────────────────────────────────────
// Vorschau-Komponente (für Modal, Bildschirm-Skalierung)
// Physische Größe 57×32mm → Vorschau bei 96dpi: 215×121px
// ──────────────────────────────────────────────────────────────────────────────
export function ArtikelLabelPreview({ artikel }: { artikel: LabelArtikel }) {
  const [qrUrl, setQrUrl] = useState("");

  useEffect(() => {
    genQr(artikel).then(setQrUrl);
  }, [artikel.id, artikel.bezeichnung]);

  const lang = artikel.bezeichnung.length > 28;

  return (
    <div style={{
      width: "215px", height: "121px",
      border: "1px solid #000", borderRadius: "2px",
      padding: "7px", display: "flex", gap: "4px",
      fontFamily: "Arial, Helvetica, sans-serif",
      backgroundColor: "#fff", color: "#000",
      overflow: "hidden", flexShrink: 0,
    }}>
      {/* Linke Spalte */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", overflow: "hidden", minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "3px" }}>
          <div style={{
            fontSize: lang ? "9px" : "11px",
            fontWeight: "bold", lineHeight: 1.2,
            overflow: "hidden", display: "-webkit-box",
            WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
            flex: 1, minWidth: 0, wordBreak: "break-word",
          }}>
            {artikel.bezeichnung}
          </div>
          <div style={{ fontSize: "6px", fontWeight: "bold", letterSpacing: "1.5px", color: "#333", flexShrink: 0, marginTop: "1px" }}>
            EMTS
          </div>
        </div>
        <div style={{ fontSize: "9px", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {artikel.lagerplatz ?? "–"}
        </div>
        <div style={{ fontSize: "7px", color: "#555", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {artikel.kategorie}
        </div>
      </div>
      {/* QR-Code */}
      <div style={{ width: "83px", height: "83px", flexShrink: 0, alignSelf: "center", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {qrUrl
          ? <img src={qrUrl} alt="QR" style={{ width: "83px", height: "83px", imageRendering: "pixelated" }} />
          : <div style={{ width: "83px", height: "83px", background: "#f0f0f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "8px", color: "#999" }}>…</div>
        }
      </div>
    </div>
  );
}

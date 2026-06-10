// Druck der Colli-Etiketten — verwendet EXAKT dieselbe Druck-Mechanik und
// Seitengröße wie die bestehenden Etiketten (printAuslagerBeleg /
// printMehrereAuslagerBelege in components/ui/AuslagerBeleg.tsx):
//   • neues Fenster (window.open) + Auto-Print-Script
//   • @page { size: 55mm 30mm; margin: 0 }   ← gleiche physische Seitengröße
//   • print-color-adjust: exact (QR druckt sicher mit)
//   • ein Etikett pro Seite via page-break-after
// Inhalte: Colli (QR + Nummer, optional Zusatztext-Markierung) sowie Blanko-
// Text-Etiketten (nur Text, zentriert, Auto-Fit) — beide über dieselbe Pipeline.

import QRCode from "qrcode";

// QR als SVG-Data-URI — identische Erzeugung wie genQrSvg im Auslagerbeleg,
// aber mit dem ROHEN Inhalt (kein Präfix, keine URL). SVG = gestochen scharf.
async function genQrSvg(content: string): Promise<string> {
  const svg = await QRCode.toString(content, {
    type:                 "svg",
    margin:               1,              // Ruhezone (Quiet Zone)
    errorCorrectionLevel: "M",
    color:                { dark: "#000000", light: "#ffffff" },
  });
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

// Auto-Print im neuen Fenster — wortgleich zu printAuslagerBeleg.
const PRINT_SCRIPT = `<script>(function(){function p(){window.focus();window.print();}document.readyState==='complete'?p():window.addEventListener('load',p);})();</script>`;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Schriftgröße der Nummer nach Länge — lange Nummern bleiben lesbar und umbrechen.
function nummerFontSize(len: number): string {
  if (len <= 10) return "13pt";
  if (len <= 16) return "11pt";
  if (len <= 24) return "8.5pt";
  return "6.5pt";
}

// Auto-Fit für das Blanko-Text-Etikett: je länger der Text, desto kleiner —
// damit er aufs 55×30mm-Etikett passt (statt abgeschnitten zu werden).
export function textEtikettFontPt(len: number): number {
  if (len <= 6)  return 30;
  if (len <= 12) return 22;
  if (len <= 20) return 16;
  if (len <= 35) return 12;
  if (len <= 60) return 9;
  return 7;
}

/**
 * Druckt alle übergebenen Colli-Nummern als Stapel — jedes Etikett eine eigene
 * 55×30mm-Seite, eines pro Nummer. Optionaler Zusatztext erscheint auf ALLEN
 * Etiketten oben rechts als dunkle Markierung. Fenster wird VOR dem await
 * geöffnet (Popup-Blocker), QR danach erzeugt, dann geschrieben.
 */
export async function printColliEtiketten(nummern: string[], zusatztext = ""): Promise<void> {
  const liste = nummern.map((s) => s.trim()).filter((s) => s.length > 0);
  if (liste.length === 0) return;
  const zusatz = zusatztext.trim();

  const w = window.open("", "_blank", "width=400,height=250");
  if (!w) { console.warn("Popup blockiert — Popup-Blocker deaktivieren"); return; }

  const entries = await Promise.all(liste.map(async (nr) => ({ nr, qr: await genQrSvg(nr) })));

  const css = `
    @page { size: 55mm 30mm; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: Arial, Helvetica, sans-serif; }
    body { margin: 0; padding: 0; background: #fff; }
    .lw    { width: 55mm; height: 30mm; overflow: hidden; page-break-after: always; }
    .lw:last-child { page-break-after: avoid; }
    .al    { width: 55mm; height: 30mm; padding: 1.5mm; display: flex; align-items: center; gap: 2mm; overflow: hidden; }
    .qr    { width: 26mm; height: 26mm; flex-shrink: 0; display: block; }
    .right { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 0.8mm; }
    .badge { align-self: flex-end; background: #000; color: #fff; font-weight: bold; font-size: 7pt; line-height: 1; padding: 0.6mm 1.4mm; border-radius: 0.8mm; letter-spacing: .3px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 0.4mm; }
    .lbl   { font-size: 6pt; font-weight: bold; letter-spacing: .5px; text-transform: uppercase; color: #000; }
    .nr    { font-family: "Courier New", monospace; font-weight: bold; color: #000; line-height: 1.1; word-break: break-all; }
  `;

  const badgeHtml = zusatz ? `<div class="badge">${escapeHtml(zusatz)}</div>` : "";
  const body = entries.map(({ nr, qr }) => `
    <div class="lw"><div class="al">
      <img class="qr" src="${qr}" alt="" />
      <div class="right">
        ${badgeHtml}
        <div class="lbl">Colli-Nummer</div>
        <div class="nr" style="font-size:${nummerFontSize(nr.length)}">${escapeHtml(nr)}</div>
      </div>
    </div></div>`).join("\n");

  w.document.open();
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${css}</style></head><body>${body}${PRINT_SCRIPT}</body></html>`);
  w.document.close();
}

export type SchrankOrientierung = "quer" | "hoch";

/**
 * Schreibt eine Schrank-Beschriftung (150 × 120 mm) in ein BEREITS geöffnetes
 * Fenster und löst den Druck aus. Das Fenster muss vom Aufrufer SYNCHRON via
 * window.open() geöffnet werden (Popup-Blocker), danach wird das HTML server-
 * seitig sanitized und erst dann hier eingesetzt — daher kein window.open hier.
 *
 *  • @page exakt 150mm × 120mm (quer) bzw. 120mm × 150mm (hoch), margin 0
 *  • leichter Rahmen als Schnittkante: 0.4pt #999, ein paar mm vom Rand
 *  • Inhalt innerhalb des Rahmens mit Padding
 *  • innerHtml MUSS bereits serverseitig sanitized sein (sanitizeSchrank)
 */
export function writeSchrankBeschriftung(
  w: Window,
  innerHtml: string,
  orientierung: SchrankOrientierung = "quer",
): void {
  const [pw, ph] = orientierung === "hoch" ? ["120mm", "150mm"] : ["150mm", "120mm"];

  const css = `
    @page { size: ${pw} ${ph}; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; }
    .page    { position: relative; width: ${pw}; height: ${ph}; overflow: hidden; page-break-after: avoid; }
    .frame   { position: absolute; inset: 4mm; border: 0.4pt solid #999; }
    .content { position: absolute; inset: 4mm; padding: 5mm; overflow: hidden; }
    .content > :first-child { margin-top: 0; }
    .content h1 { font-size: 22pt; margin: 0 0 2.5mm; line-height: 1.15; }
    .content h2 { font-size: 17pt; margin: 0 0 2mm;   line-height: 1.15; }
    .content h3 { font-size: 13pt; margin: 0 0 1.5mm; line-height: 1.15; }
    .content p  { font-size: 11pt; margin: 0 0 1.5mm; line-height: 1.3; }
    .content ul, .content ol { font-size: 11pt; line-height: 1.3; margin: 0 0 1.5mm; padding-left: 6mm; }
    .content li { margin: 0 0 0.6mm; }
    .content strong { font-weight: bold; }
    .content em { font-style: italic; }
  `;

  const body = `<div class="page"><div class="content">${innerHtml}</div><div class="frame"></div></div>`;

  w.document.open();
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${css}</style></head><body>${body}${PRINT_SCRIPT}</body></html>`);
  w.document.close();
}

/**
 * Druckt Blanko-Text-Etiketten — gleiche 55×30mm-Mechanik/Seitengröße, aber KEIN
 * QR und KEINE Nummer: nur der Text, groß zentriert, mit Auto-Fit + Umbruch.
 */
export async function printTextEtiketten(texte: string[]): Promise<void> {
  const liste = texte.map((s) => s.trim()).filter((s) => s.length > 0);
  if (liste.length === 0) return;

  const w = window.open("", "_blank", "width=400,height=250");
  if (!w) { console.warn("Popup blockiert — Popup-Blocker deaktivieren"); return; }

  const css = `
    @page { size: 55mm 30mm; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: Arial, Helvetica, sans-serif; }
    body { margin: 0; padding: 0; background: #fff; }
    .lw { width: 55mm; height: 30mm; overflow: hidden; page-break-after: always; }
    .lw:last-child { page-break-after: avoid; }
    .tw { width: 55mm; height: 30mm; padding: 2mm; display: flex; align-items: center; justify-content: center; text-align: center; overflow: hidden; }
    .tx { font-weight: bold; color: #000; line-height: 1.15; word-break: break-word; overflow-wrap: anywhere; max-height: 100%; overflow: hidden; }
  `;

  const body = liste.map((t) => `
    <div class="lw"><div class="tw">
      <div class="tx" style="font-size:${textEtikettFontPt(t.length)}pt">${escapeHtml(t)}</div>
    </div></div>`).join("\n");

  w.document.open();
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${css}</style></head><body>${body}${PRINT_SCRIPT}</body></html>`);
  w.document.close();
}

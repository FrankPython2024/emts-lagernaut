// Druck der Colli-Etiketten — verwendet EXAKT dieselbe Druck-Mechanik und
// Seitengröße wie die bestehenden Etiketten (printAuslagerBeleg /
// printMehrereAuslagerBelege in components/ui/AuslagerBeleg.tsx):
//   • neues Fenster (window.open) + Auto-Print-Script
//   • @page { size: 55mm 30mm; margin: 0 }   ← gleiche physische Seitengröße
//   • print-color-adjust: exact (QR druckt sicher mit)
//   • ein Etikett pro Seite via page-break-after
// Nur der Inhalt ist anders (QR = rohe Colli-Nummer, rechts die Nummer).

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

/**
 * Druckt alle übergebenen Colli-Nummern als Stapel — jedes Etikett eine eigene
 * 55×30mm-Seite, eines pro Nummer. Fenster wird VOR dem await geöffnet
 * (Popup-Blocker), QR danach erzeugt, dann geschrieben.
 */
export async function printColliEtiketten(nummern: string[]): Promise<void> {
  const liste = nummern.map((s) => s.trim()).filter((s) => s.length > 0);
  if (liste.length === 0) return;

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
    .lbl   { font-size: 6pt; font-weight: bold; letter-spacing: .5px; text-transform: uppercase; color: #000; }
    .nr    { font-family: "Courier New", monospace; font-weight: bold; color: #000; line-height: 1.1; word-break: break-all; }
  `;

  const body = entries.map(({ nr, qr }) => `
    <div class="lw"><div class="al">
      <img class="qr" src="${qr}" alt="" />
      <div class="right">
        <div class="lbl">Colli-Nummer</div>
        <div class="nr" style="font-size:${nummerFontSize(nr.length)}">${escapeHtml(nr)}</div>
      </div>
    </div></div>`).join("\n");

  w.document.open();
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${css}</style></head><body>${body}${PRINT_SCRIPT}</body></html>`);
  w.document.close();
}

// Druck der Verbrauchsmaterial-QR-Etiketten — gleiche bewährte Mechanik wie die
// Colli-Etiketten (src/lib/print/colliEtikett.ts):
//   • neues Fenster (window.open, SYNCHRON → Popup-Blocker-sicher) + Auto-Print
//   • @page { size: 57mm 32mm; margin: 0 }  ← exakte physische Etikettgröße
//   • print-color-adjust: exact (QR druckt sicher mit)
//   • ein Etikett pro Seite via page-break-after → sauberer Stapeldruck
// Inhalt je Etikett: QR (kodiert den Artikel-Code als REINER Text, z.B. "VM-0001")
// links, rechts die Bezeichnung (groß) + der Code als kleine Fallback-Textzeile.
// Einzel- und Mehrfachdruck nutzen dieselbe Pipeline (einzeln = Liste mit 1).

import QRCode from "qrcode";

export type EtikettArtikel = {
  code: string; // QR-Inhalt + Fallback-Text, z.B. "VM-0001"
  name: string; // Bezeichnung
};

// QR als SVG-Data-URI — gestochen scharf im Druck. Roher Code als Inhalt
// (ASCII → Auto-Erkennung reicht; kein Präfix/keine URL für Handheld-Scanner).
async function genQrSvg(content: string): Promise<string> {
  const svg = await QRCode.toString(content, {
    type:                 "svg",
    margin:               1,          // Ruhezone (Quiet Zone)
    errorCorrectionLevel: "M",
    color:                { dark: "#000000", light: "#ffffff" },
  });
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Schriftgröße der Bezeichnung nach Länge — lange Namen bleiben lesbar, brechen
// um und werden per line-clamp begrenzt, damit nichts überläuft.
function nameFontSize(len: number): string {
  if (len <= 18) return "12pt";
  if (len <= 30) return "10pt";
  if (len <= 45) return "8.5pt";
  return "7pt";
}

// Auto-Print im neuen Fenster — wortgleich zu colliEtikett.ts.
const PRINT_SCRIPT = `<script>(function(){function p(){window.focus();window.print();}document.readyState==='complete'?p():window.addEventListener('load',p);})();</script>`;

/**
 * Druckt für jeden Artikel ein 57×32mm-QR-Etikett — eines pro Seite. Fenster wird
 * VOR dem await geöffnet (Popup-Blocker), QR danach erzeugt, dann geschrieben.
 */
export async function printVerbrauchsmaterialEtiketten(artikel: EtikettArtikel[]): Promise<void> {
  const liste = artikel.filter((a) => a.code.trim().length > 0);
  if (liste.length === 0) return;

  const w = window.open("", "_blank", "width=420,height=260");
  if (!w) { console.warn("Popup blockiert — Popup-Blocker deaktivieren"); return; }

  const entries = await Promise.all(liste.map(async (a) => ({ a, qr: await genQrSvg(a.code.trim()) })));

  const css = `
    @page { size: 57mm 32mm; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: Arial, Helvetica, sans-serif; }
    body { margin: 0; padding: 0; background: #fff; }
    .lw   { width: 57mm; height: 32mm; overflow: hidden; page-break-after: always; }
    .lw:last-child { page-break-after: avoid; }
    .et   { width: 57mm; height: 32mm; padding: 2mm; display: flex; align-items: center; gap: 2mm; overflow: hidden; }
    .qr   { width: 27mm; height: 27mm; flex-shrink: 0; display: block; }
    .right{ flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 1mm; }
    .name { font-weight: bold; color: #000; line-height: 1.15; word-break: break-word; overflow-wrap: anywhere;
            display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .code { font-family: "Courier New", monospace; font-size: 8pt; font-weight: bold; color: #000;
            letter-spacing: .5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  `;

  const body = entries.map(({ a, qr }) => `
    <div class="lw"><div class="et">
      <img class="qr" src="${qr}" alt="" />
      <div class="right">
        <div class="name" style="font-size:${nameFontSize(a.name.length)}">${escapeHtml(a.name)}</div>
        <div class="code">${escapeHtml(a.code)}</div>
      </div>
    </div></div>`).join("\n");

  w.document.open();
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${css}</style></head><body>${body}${PRINT_SCRIPT}</body></html>`);
  w.document.close();
}

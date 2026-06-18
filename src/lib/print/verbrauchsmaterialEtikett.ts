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

// Auto-Fit + Auto-Print im neuen Fenster. Pro Etikett wird die Bezeichnung von
// einer Maximalgröße (13pt) schrittweise verkleinert, bis sie KOMPLETT in ihren
// Textbereich (.namebox, rechts neben dem 27mm-QR) passt — kein Abschneiden,
// kein Überlauf. Mindestgröße 5pt; darunter greift zusätzlich der Umbruch
// (overflow-wrap/word-break/hyphens). Gemessen wird scrollHeight/scrollWidth
// gegen die Box, nachdem das Layout (inkl. QR-Bilder) steht.
const FIT_PRINT_SCRIPT = `<script>(function(){
  function fit(){
    var names=document.querySelectorAll('.name');
    for(var i=0;i<names.length;i++){
      var el=names[i], box=el.parentElement, size=13;
      el.style.fontSize=size+'pt';
      while(size>5 && (el.scrollHeight>box.clientHeight+1 || el.scrollWidth>box.clientWidth+1)){
        size-=0.5; el.style.fontSize=size+'pt';
      }
    }
  }
  function p(){fit();window.focus();window.print();}
  document.readyState==='complete'?p():window.addEventListener('load',p);
})();</script>`;

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
    .right{ flex: 1; min-width: 0; height: 28mm; display: flex; flex-direction: column; justify-content: center; gap: 1mm; overflow: hidden; }
    /* Namebox: wächst, der Auto-Fit misst die Bezeichnung gegen genau diese Box. */
    .namebox { flex: 1 1 auto; min-height: 0; display: flex; align-items: center; overflow: hidden; }
    .name { width: 100%; max-height: 100%; font-weight: bold; color: #000; line-height: 1.1; overflow: hidden;
            word-break: break-word; overflow-wrap: anywhere; -webkit-hyphens: auto; hyphens: auto; }
    .code { flex: 0 0 auto; font-family: "Courier New", monospace; font-size: 8pt; font-weight: bold; color: #000;
            letter-spacing: .5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  `;

  const body = entries.map(({ a, qr }) => `
    <div class="lw"><div class="et">
      <img class="qr" src="${qr}" alt="" />
      <div class="right">
        <div class="namebox"><div class="name" lang="de">${escapeHtml(a.name)}</div></div>
        <div class="code">${escapeHtml(a.code)}</div>
      </div>
    </div></div>`).join("\n");

  w.document.open();
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${css}</style></head><body>${body}${FIT_PRINT_SCRIPT}</body></html>`);
  w.document.close();
}

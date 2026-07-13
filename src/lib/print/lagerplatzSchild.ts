// Druck des A5-Lagerplatz-Schilds für Verbrauchsmaterial — zum Aushängen am
// Lagerplatz. Gleiche bewährte Mechanik wie die Etiketten (window.open SYNCHRON
// → Popup-Blocker-sicher, @page + Auto-Print, print-color-adjust: exact).
//
// Bewusst INKLUSIV gestaltet (Projekt-Prinzip WCAG/leichte Sprache): große,
// kontraststarke Schrift (schwarz auf weiß), klare Beschriftungen, großes Foto
// und großer Scan-QR. Inhalt je Schild:
//   • Foto (falls hinterlegt) groß oben
//   • Name (Beschreibung) sehr groß + Merkmale
//   • AAN prominent
//   • Standort / Kategorie als Zusatz
//   • unten: großer QR (kodiert den Artikel-Code als REINER Text, z.B. "VM-0001")
//     + Code-Klartext, beschriftet „Zum Erfassen scannen"
//
// Ein Schild pro A5-Seite (page-break-after) → sauberer Stapeldruck. Das Foto
// kommt über /api/verbrauchsmaterial/bild/[id] (gleiche Origin → Session-Cookie);
// der Auto-Print wartet auf das window.load-Event, damit das Foto mitgedruckt wird.

import QRCode from "qrcode";

export type SchildArtikel = {
  code:       string;         // QR-Inhalt + Klartext, z.B. "VM-0001"
  name:       string;         // Bezeichnung
  merkmale?:  string | null;
  aan?:       string | null;
  standort?:  string | null;
  kategorie?: string | null;
  bildUrl?:   string | null;  // /api/verbrauchsmaterial/bild/[id]?v=… (null = kein Foto)
};

// QR als SVG-Data-URI — gestochen scharf im Druck. Roher Code als Inhalt (kein
// Präfix/keine URL, damit der Handheld-Scanner exakt "VM-0001" liefert).
async function genQrSvg(content: string): Promise<string> {
  const svg = await QRCode.toString(content, {
    type:                 "svg",
    margin:               1,
    errorCorrectionLevel: "M",
    color:                { dark: "#000000", light: "#ffffff" },
  });
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Auto-Print, sobald alles (inkl. Foto) geladen ist. Fallback-Timeout, falls das
// Foto nie lädt; ein Flag verhindert doppeltes window.print().
const PRINT_SCRIPT = `<script>(function(){
  var done=false;
  function p(){ if(done)return; done=true; window.focus(); window.print(); }
  if(document.readyState==='complete'){ p(); } else { window.addEventListener('load',p); }
  setTimeout(p, 4000);
})();</script>`;

/**
 * Druckt für jeden Artikel ein A5-Lagerplatz-Schild — eines pro Seite. Fenster
 * wird VOR dem await geöffnet (Popup-Blocker), QR danach erzeugt, dann geschrieben.
 */
export async function printLagerplatzSchild(artikel: SchildArtikel[]): Promise<void> {
  const liste = artikel.filter((a) => a.code.trim().length > 0);
  if (liste.length === 0) return;

  const w = window.open("", "_blank", "width=560,height=800");
  if (!w) { console.warn("Popup blockiert — Popup-Blocker deaktivieren"); return; }

  const entries = await Promise.all(liste.map(async (a) => ({ a, qr: await genQrSvg(a.code.trim()) })));

  const css = `
    @page { size: A5; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: Arial, Helvetica, sans-serif; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    /* A5 = 148×210mm; 9mm Innenrand (Drucker-Unrandbereich) → nichts wird beschnitten. */
    .sheet { width: 148mm; height: 210mm; padding: 9mm; display: flex; flex-direction: column; overflow: hidden; page-break-after: always; }
    .sheet:last-child { page-break-after: avoid; }
    .foto { flex: 0 0 auto; height: 78mm; margin-bottom: 5mm; border: 0.5pt solid #bbb; border-radius: 2mm;
            display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .foto img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .name { font-size: 30pt; font-weight: 800; line-height: 1.1; margin: 0 0 2mm; color: #000;
            word-break: break-word; overflow-wrap: anywhere; -webkit-hyphens: auto; hyphens: auto; }
    .merkmale { font-size: 16pt; line-height: 1.25; margin: 0 0 4mm; color: #222; }
    .aan { font-size: 24pt; font-weight: 800; line-height: 1.1; margin: 0 0 2.5mm; color: #000; }
    .aan .lbl { font-size: 13pt; font-weight: 700; color: #555; letter-spacing: 1px; }
    .meta { font-size: 15pt; line-height: 1.3; margin: 0 0 1.5mm; color: #222; }
    .meta .lbl { font-weight: 700; color: #555; }
    .spacer { flex: 1 1 auto; min-height: 3mm; }
    /* Scan-Bereich unten: großer QR links, Hinweis + Code rechts. */
    .scan { flex: 0 0 auto; display: flex; align-items: center; gap: 6mm; border-top: 1pt solid #000; padding-top: 4mm; }
    .qr { width: 44mm; height: 44mm; flex: 0 0 auto; display: block; }
    .scantext { min-width: 0; }
    .scanhint { font-size: 15pt; font-weight: 700; color: #000; margin: 0 0 2mm; line-height: 1.2; }
    .code { font-family: "Courier New", monospace; font-size: 26pt; font-weight: 800; letter-spacing: 1px; color: #000; }
  `;

  const body = entries.map(({ a, qr }) => {
    const fotoHtml = a.bildUrl
      ? `<div class="foto"><img src="${escapeHtml(a.bildUrl)}" alt="" /></div>`
      : "";
    const merkmaleHtml = a.merkmale && a.merkmale.trim()
      ? `<div class="merkmale">${escapeHtml(a.merkmale.trim())}</div>`
      : "";
    const aanHtml = a.aan && a.aan.trim()
      ? `<div class="aan"><span class="lbl">AAN</span><br>${escapeHtml(a.aan.trim())}</div>`
      : "";
    const metaTeile: string[] = [];
    if (a.standort && a.standort.trim())  metaTeile.push(`<span class="lbl">Standort:</span> ${escapeHtml(a.standort.trim())}`);
    if (a.kategorie && a.kategorie.trim()) metaTeile.push(`<span class="lbl">Kategorie:</span> ${escapeHtml(a.kategorie.trim())}`);
    const metaHtml = metaTeile.map((t) => `<div class="meta">${t}</div>`).join("");

    return `<div class="sheet">
      ${fotoHtml}
      <div class="name" lang="de">${escapeHtml(a.name)}</div>
      ${merkmaleHtml}
      ${aanHtml}
      ${metaHtml}
      <div class="spacer"></div>
      <div class="scan">
        <img class="qr" src="${qr}" alt="" />
        <div class="scantext">
          <div class="scanhint">Zum Erfassen scannen</div>
          <div class="code">${escapeHtml(a.code)}</div>
        </div>
      </div>
    </div>`;
  }).join("\n");

  w.document.open();
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${css}</style></head><body>${body}${PRINT_SCRIPT}</body></html>`);
  w.document.close();
}

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
import { masseText } from "@/lib/verbrauchsmaterial/masse";

export type SchildArtikel = {
  code:       string;         // QR-Inhalt + Klartext, z.B. "VM-0001"
  name:       string;         // Bezeichnung
  merkmale?:  string | null;
  aan?:       string | null;
  standort?:  string | null;
  kategorie?: string | null;
  bildUrl?:   string | null;  // /api/verbrauchsmaterial/bild/[id]?v=… (null = kein Foto)
  // Maße in Millimetern. Erscheinen nur, wenn mindestens eine Kante gepflegt
  // ist — ein „? × ? × ? mm" auf dem Schild wäre nur Lärm.
  laengeMm?:  number | null;
  breiteMm?:  number | null;
  hoeheMm?:   number | null;
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
    /* ⚠️ Der Rand gehört ins @page, NICHT als padding in den Kasten: Mit
       margin:0 druckt jeder Drucker in seinen Unrandbereich hinein, und die
       Seite lief um wenige Millimeter über — die letzte Zeile rutschte weg. */
    @page { size: A5; margin: 7mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: Arial, Helvetica, sans-serif; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    /* A5 abzüglich @page-Rand = 134 × 196mm. 192mm lässt Luft für Rundungs-
       unterschiede der Drucker — sonst erzwingt ein halber Millimeter einen
       Seitenumbruch und die halbe Seite fehlt. */
    .sheet { width: 134mm; height: 192mm; display: flex; flex-direction: column;
             overflow: hidden; page-break-after: always; break-after: page; }
    .sheet:last-child { page-break-after: avoid; break-after: avoid; }
    /* Rangfolge bei Platzmangel: Scan-Bereich bleibt IMMER ganz (flex-shrink 0),
       danach gibt das Foto nach, der Text erst zuletzt. Der hohe Schrumpffaktor
       (1000 gegen 1) sorgt dafür, dass praktisch nur das Foto kleiner wird.
       Vorher war es umgekehrt — das Foto blieb bei 74mm und die letzte Textzeile
       wurde mittendrin abgeschnitten. */
    .foto { flex: 0 1000 auto; height: 74mm; min-height: 30mm; margin-bottom: 4mm;
            border: 0.5pt solid #bbb; border-radius: 2mm;
            display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .foto img { max-width: 100%; max-height: 100%; object-fit: contain; }
    /* Textblock darf sich verkleinern und notfalls abschneiden — der QR nicht. */
    .text { flex: 0 1 auto; min-height: 0; overflow: hidden; }
    .name { font-size: 30pt; font-weight: 800; line-height: 1.1; margin: 0 0 2mm; color: #000;
            word-break: break-word; overflow-wrap: anywhere; -webkit-hyphens: auto; hyphens: auto; }
    .name.mittel { font-size: 24pt; }
    .name.lang   { font-size: 18pt; }
    .merkmale { font-size: 16pt; line-height: 1.25; margin: 0 0 4mm; color: #222; }
    .aan { font-size: 24pt; font-weight: 800; line-height: 1.1; margin: 0 0 2.5mm; color: #000; }
    .aan .lbl { font-size: 13pt; font-weight: 700; color: #555; letter-spacing: 1px; }
    .meta { font-size: 15pt; line-height: 1.3; margin: 0 0 1.5mm; color: #222; }
    .meta .lbl { font-weight: 700; color: #555; }
    /* Wächst mit, damit der Scan-Bereich unten steht — bei einem Artikel ohne
       Foto sonst mitten auf der Seite, mit 11cm Leerraum darunter. */
    .spacer { flex: 1 1 auto; min-height: 2mm; }
    /* Scan-Bereich: flex-shrink 0 — er wird NIE gequetscht oder abgeschnitten. */
    .scan { flex: 0 0 auto; display: flex; align-items: center; gap: 6mm;
            border-top: 1pt solid #000; padding-top: 4mm; }
    .qr { width: 38mm; height: 38mm; flex: 0 0 auto; display: block; }
    .scantext { min-width: 0; }
    .scanhint { font-size: 15pt; font-weight: 700; color: #000; margin: 0 0 2mm; line-height: 1.2; }
    .code { font-family: "Courier New", monospace; font-size: 24pt; font-weight: 800; letter-spacing: 1px; color: #000; }
  `;

  const body = entries.map(({ a, qr }) => {
    const fotoHtml = a.bildUrl
      ? `<div class="foto"><img src="${escapeHtml(a.bildUrl)}" alt="" /></div>`
      : "";
    const name = a.name.trim();
    // Lange Namen kleiner setzen, statt sie den Scan-Bereich wegdrücken zu lassen.
    const nameKlasse = name.length > 32 ? " lang" : name.length > 18 ? " mittel" : "";
    // Merkmale, die wörtlich der Name sind, zweimal zu drucken hilft niemandem
    // (real bei den Kartonagen: Name und Merkmale beide „385 x 235 x 180").
    const merkmale = (a.merkmale ?? "").trim();
    const merkmaleHtml = merkmale && merkmale.toLowerCase() !== name.toLowerCase()
      ? `<div class="merkmale">${escapeHtml(merkmale)}</div>`
      : "";
    // „?" oder „-" als AAN ist keine Nummer, sondern ein Platzhalter — dann
    // lieber gar keine AAN-Zeile, das schafft Platz für das Wesentliche.
    const aan = (a.aan ?? "").trim();
    const aanHtml = aan && /[0-9a-zA-Z]/.test(aan)
      ? `<div class="aan"><span class="lbl">AAN</span><br>${escapeHtml(aan)}</div>`
      : "";
    const metaTeile: string[] = [];
    if (a.standort && a.standort.trim())  metaTeile.push(`<span class="lbl">Standort:</span> ${escapeHtml(a.standort.trim())}`);
    if (a.kategorie && a.kategorie.trim()) metaTeile.push(`<span class="lbl">Kategorie:</span> ${escapeHtml(a.kategorie.trim())}`);
    // Maße nur, wenn etwas gepflegt ist. Beschriftet „L × B × H", damit am Regal
    // klar ist, welche Zahl welche Kante meint.
    const masse = masseText({
      laengeMm: a.laengeMm ?? null,
      breiteMm: a.breiteMm ?? null,
      hoeheMm:  a.hoeheMm  ?? null,
    });
    if (masse) metaTeile.push(`<span class="lbl">Maße (L × B × H):</span> ${escapeHtml(masse)}`);
    const metaHtml = metaTeile.map((t) => `<div class="meta">${t}</div>`).join("");

    return `<div class="sheet">
      ${fotoHtml}
      <div class="text">
        <div class="name${nameKlasse}" lang="de">${escapeHtml(name)}</div>
        ${merkmaleHtml}
        ${aanHtml}
        ${metaHtml}
      </div>
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

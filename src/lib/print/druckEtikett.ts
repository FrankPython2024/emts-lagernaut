// ── Karton-Etikett für 3D-gedruckte Teile (30.09.2026) ────────────────────────
//
// Wunsch Frank: „eine Kennzeichnung, wenn wir Füße gedruckt haben — quasi ein
// Einlagerbeleg, damit wir am Karton kennzeichnen können, was es ist."
// Gedruckt nach dem Einbuchen (Druck fertig → einbuchen) und aus dem Druckprotokoll.
//
// 55 × 30 mm wie Auslager- und Einlager-Etikett (Thermodrucker). ⚠️ Gleiche Regel
// wie beim Auslager-Etikett: NUR reines Schwarz, alles fett, nichts unter 6,5 pt —
// Grau und Farbe rastert der Thermodrucker zu blassen Punkten.
// QR-Code = Artikel-Id wie auf dem Artikel-Label (ArtikelLabel.tsx).
// Nicht-ASCII als HTML-Entities: Das Druckfenster (window.open + document.write)
// rät den Zeichensatz, sonst steht „FÃ¼ÃŸe" auf dem Karton.

import QRCode from "qrcode";

export type DruckEtikett = {
  artikelId:   number;
  /** Artikelbezeichnung, z. B. „EliteBook x360 830 G6 Füße hinten". */
  artikel:     string;
  stueck:      number;
  lagerplatz?: string | null;
  /** Kürzel der Person, die eingebucht hat. */
  von?:        string | null;
  datum:       Date | string;
};

const deDatum = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function nurAscii(html: string): string {
  let out = "";
  for (const c of html) {
    const code = c.codePointAt(0)!;
    out += code > 127 ? `&#${code};` : c;
  }
  return out;
}

async function qrSvg(inhalt: string): Promise<string> {
  const svg = await QRCode.toString(inhalt, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

const DRUCK_ETIKETT_CSS = `
  .de    { width: 55mm; height: 30mm; padding: 1.5mm 1.8mm; display: flex; gap: 1.5mm; overflow: hidden;
           background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; box-sizing: border-box; }
  .links { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; }
  .kopf  { display: flex; justify-content: space-between; gap: 1mm; font-size: 7pt; font-weight: 900; letter-spacing: .4px; line-height: 1.1; }
  .kopf .typ { border: 0.35mm solid #000; padding: 0 0.8mm; }
  .bez   { font-weight: 900; line-height: 1.12; word-break: break-word; overflow: hidden;
           display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .menge { font-size: 13pt; font-weight: 900; line-height: 1; }
  .fuss  { font-size: 6.5pt; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.15; }
  .rechts{ width: 14.5mm; display: flex; flex-direction: column; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .emts  { font-size: 6.5pt; font-weight: 900; letter-spacing: 1.5px; }
  .qr    { width: 14mm; height: 14mm; image-rendering: pixelated; }
  .art   { font-size: 6.5pt; font-weight: 700; }
`;

/** Ein Etikett als HTML (für Vorschau und Druck). */
function druckEtikettHtml(e: DruckEtikett, qr: string): string {
  // Lange Namen: kleiner und bis zu 3 Zeilen statt abgeschnitten (am 30.09.2026 im Browser
  // gemessen: 59 Zeichen brauchen bei 7,5 pt drei Zeilen, Platz ist dafür da).
  const lang = e.artikel.length > 38;
  const bezPt = lang ? "7pt" : e.artikel.length > 24 ? "8.5pt" : "10pt";
  const fuss = [e.lagerplatz, e.von].filter(Boolean).join(" · ");
  return `<div class="de">
      <div class="links">
        <div class="kopf"><span class="typ">3D-DRUCK</span><span>${esc(deDatum.format(new Date(e.datum)))}</span></div>
        <div class="bez" style="font-size:${bezPt};-webkit-line-clamp:${lang ? 3 : 2}">${esc(e.artikel)}</div>
        <div class="menge">${e.stueck} St&uuml;ck</div>
        <div class="fuss">${esc(fuss || "eingelagert")}</div>
      </div>
      <div class="rechts"><div class="emts">EMTS</div><img class="qr" src="${qr}" alt="" /><div class="art">Art. ${e.artikelId}</div></div>
    </div>`;
}

const DRUCK_SKRIPT = `<script>(function(){function p(){window.focus();window.print();}document.readyState==='complete'?p():window.addEventListener('load',p);})();</script>`;

/**
 * Etiketten drucken — `anzahl` gleiche je Eintrag (mehrere Kartons/Beutel).
 * window.open SYNCHRON vor jedem await, sonst blockt der Popup-Blocker.
 */
export async function printDruckEtiketten(liste: DruckEtikett[], anzahl = 1): Promise<void> {
  const w = window.open("", "_blank", "width=420,height=320");
  if (!w) { console.warn("Popup blockiert — Popup-Blocker deaktivieren"); return; }
  const mitQr = await Promise.all(liste.map(async (e) => ({ e, qr: await qrSvg(String(e.artikelId)) })));
  const seiten = mitQr.flatMap(({ e, qr }) => Array.from({ length: Math.max(1, Math.min(50, anzahl)) }, () => `<div class="lw">${druckEtikettHtml(e, qr)}</div>`));
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>3D-Druck Etikett</title><style>
    @page { size: 55mm 30mm; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; padding: 0; background: #fff; }
    .lw { width: 55mm; height: 30mm; overflow: hidden; page-break-after: always; }
    .lw:last-child { page-break-after: avoid; }
    ${DRUCK_ETIKETT_CSS}
  </style></head><body>${seiten.join("\n")}${DRUCK_SKRIPT}</body></html>`;
  w.document.open();
  w.document.write(nurAscii(html));
  w.document.close();
}

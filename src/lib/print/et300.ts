// ── Druck: Platz-Schilder auf ORGATEX ET300 (38 × 100 mm, 2 × 7 je A4) ────────
//
// Raster und Regeln: src/lib/lager/platzSchilder.ts. Je Schild: QR-Code links
// (genau der Platzname), rechts der Name groß, darunter die Beschreibung.
// Nur Schwarz, kräftig — auch auf billigen Laserdruckern gut lesbar.
//
// Gleiche Mechanik wie die übrigen Etiketten: window.open SYNCHRON im Klick
// (Popup-Blocker), Nicht-ASCII als Entities (`document.write` rät den Zeichensatz).
// ⚠️ Druckdialog: „Tatsächliche Größe / 100 %", nicht „An Seite anpassen" — sonst
// verschiebt der Browser das Raster.

import QRCode from "qrcode";
import { ET300, codeSchriftPt, feldLage, type PlatzEingabe } from "@/lib/lager/platzSchilder";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
  const svg = await QRCode.toString(inhalt, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

export type Et300Optionen = {
  /** Erstes Feld auf dem ersten Bogen (1–14) — für angebrochene Bögen. */
  start?: number;
  /** Feinjustierung in mm (positiv = nach rechts / unten). */
  versatzXMm?: number;
  versatzYMm?: number;
  /** Probedruck: Feldrahmen mitdrucken (auf Normalpapier, zum Anhalten an den Bogen). */
  rahmen?: boolean;
};

/** false = der Browser hat das Druckfenster blockiert. */
export async function printEt300(plaetze: PlatzEingabe[], opt: Et300Optionen = {}): Promise<boolean> {
  const w = window.open("", "_blank", "width=800,height=1000");
  if (!w) return false;
  const start = Math.min(Math.max(1, Math.floor(opt.start ?? 1)), 14);
  const dx = opt.versatzXMm ?? 0, dy = opt.versatzYMm ?? 0;
  const mitQr = await Promise.all(plaetze.map(async (p) => ({ p, qr: await qrSvg(p.code) })));

  const boegen: string[][] = [];
  mitQr.forEach(({ p, qr }, i) => {
    const lage = feldLage(i + start - 1);
    (boegen[lage.bogen] ??= []).push(`<div class="feld" style="left:${lage.linksMm + dx}mm;top:${lage.obenMm + dy}mm">
      <img class="qr" src="${qr}" alt="" />
      <div class="text">
        <div class="code" style="font-size:${codeSchriftPt(p.code)}pt">${esc(p.code)}</div>
        ${p.beschreibung ? `<div class="beschr">${esc(p.beschreibung)}</div>` : ""}
      </div>
    </div>`);
  });
  // Probedruck: alle 14 Rahmen je Bogen, auch die leeren — zum Anhalten an den echten Bogen.
  const rahmen = (b: number) => !opt.rahmen ? "" : Array.from({ length: 14 }, (_, f) => {
    const l = feldLage(b * 14 + f);
    return `<div class="rahmen" style="left:${l.linksMm + dx}mm;top:${l.obenMm + dy}mm"></div>`;
  }).join("");

  const seiten = boegen.map((felder, b) => `<div class="bogen">${rahmen(b)}${(felder ?? []).join("")}</div>`).join("\n");
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Platz-Schilder ET300</title><style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; background: #fff; font-family: Arial, Helvetica, sans-serif; color: #000; }
    .bogen { position: relative; width: 210mm; height: 297mm; overflow: hidden; page-break-after: always; }
    .bogen:last-child { page-break-after: auto; }
    .feld, .rahmen { position: absolute; width: ${ET300.breiteMm}mm; height: ${ET300.hoeheMm}mm; }
    .rahmen { border: 0.2mm dashed #000; }
    .feld { display: flex; align-items: center; gap: 3mm; padding: 3mm 4mm; }
    .qr { width: 30mm; height: 30mm; flex-shrink: 0; image-rendering: pixelated; }
    .text { min-width: 0; flex: 1; }
    .code { font-weight: 900; line-height: 1.05; word-break: break-all; }
    .beschr { margin-top: 1.5mm; font-size: 10.5pt; font-weight: 700; line-height: 1.15; overflow: hidden;
              display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  </style></head><body>${seiten}<script>(function(){function p(){window.focus();window.print();}document.readyState==='complete'?p():window.addEventListener('load',p);})();</script></body></html>`;
  w.document.open();
  w.document.write(nurAscii(html));
  w.document.close();
  return true;
}

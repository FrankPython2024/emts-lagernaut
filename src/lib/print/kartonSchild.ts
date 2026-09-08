// Druck der Karton-Beschriftungen fürs Ersatzteil-Regal.
//
// Format 150 × 37 mm mit Schnittrahmen, mehrere pro A4-Bogen. Aufbau wie die
// bestehenden Schilder am Regal:
//
//     ┌──────────────────────────────────────────────┐
//     │ [Fach]                                       │
//     │  [Dell]          Precision        [AfB-Logo] │
//     │                    5570                      │
//     └──────────────────────────────────────────────┘
//
// Gleiche bewährte Mechanik wie die übrigen Etiketten: window.open SYNCHRON
// (Popup-Blocker-sicher), @page + Auto-Print, print-color-adjust: exact.

import { zerlegeGeraetename } from "@/lib/geraete/schildName";

export type KartonSchild = {
  /** Herstellername, z. B. "Dell". Bestimmt das Logo links. */
  hersteller: string | null;
  /** Kleine Zeile über dem Modell, z. B. "Precision". */
  serie:      string;
  /** Große Zeile — das Erkennungsmerkmal am Regal, z. B. "5570". */
  modell:     string;
  /** Dritte Zeile, z. B. "Detachable". Leer = wird weggelassen. */
  zusatz?:    string;
  /** Fach-/Boxnummer, klein oben links. Leer = wird weggelassen. */
  fach?:      string;
};

/** Baut ein Schild aus einem Gerätenamen, wie er im System steht. */
export function schildAusName(name: string, hersteller?: string | null, fach?: string): KartonSchild {
  const z = zerlegeGeraetename(name, hersteller);
  return { hersteller: z.hersteller, serie: z.serie, modell: z.modell, zusatz: z.zusatz, fach };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Wandelt alle Nicht-ASCII-Zeichen in HTML-Entities (ö → &#246;).
 *
 * Gleicher Grund wie im Auslagerbeleg: Das Druckfenster entsteht über
 * `window.open("")` und wird per `document.write` befüllt — der Zeichensatz
 * wird je nach Browser geraten. Als Entities ist der Text davon unabhängig.
 * Läuft ZULETZT über das fertige Dokument.
 */
function nurAscii(html: string): string {
  let out = "";
  for (const c of html) {
    const code = c.codePointAt(0)!;
    out += code > 127 ? `&#${code};` : c;
  }
  return out;
}

/**
 * Absoluter Pfad zu einer Logo-Datei.
 *
 * ⚠️ Muss absolut sein. Das Druckfenster ist ein `about:blank`-Dokument ohne
 * eigene Basis-URL — ein relativer Pfad wie "/logos/afb.svg" würde dort ins
 * Leere zeigen und das Logo bliebe weg.
 */
function logoUrl(datei: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/logos/${datei}`;
}

/** Dateibasis für ein Herstellerlogo: "Dell" → "dell". */
function herstellerBasis(hersteller: string): string {
  return hersteller.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/**
 * Herstellerlogo — dreistufig, ohne dass am Code etwas geändert werden muss.
 *
 *   1. /logos/<hersteller>.svg   (bevorzugt: skaliert verlustfrei)
 *   2. /logos/<hersteller>.png   (Rückfall, weil Logos oft nur als PNG vorliegen)
 *   3. der Herstellername als Schriftzug
 *
 * ⚠️ Der Rückfall läuft über `onerror`. Fehlt eine Datei, wird still die
 * nächste Stufe versucht — es steht nie ein kaputtes Bildsymbol auf dem Schild.
 * Ein Logo lässt sich damit einfach nach public/logos/ legen und erscheint beim
 * nächsten Druck.
 */
function herstellerBlock(hersteller: string | null): string {
  if (!hersteller || hersteller.trim() === "") return `<div class="logo links"></div>`;
  const name  = escapeHtml(hersteller.trim());
  const basis = herstellerBasis(hersteller);
  const svg   = escapeHtml(logoUrl(`${basis}.svg`));
  const png   = escapeHtml(logoUrl(`${basis}.png`));
  const fallback =
    "if(this.dataset.alt){this.src=this.dataset.alt;this.dataset.alt='';}" +
    "else{this.style.display='none';this.nextElementSibling.style.display='block';}";
  return `<div class="logo links">
    <img src="${svg}" data-alt="${png}" alt="${name}" onerror="${fallback}">
    <span class="logo-text" style="display:none">${name}</span>
  </div>`;
}

const PRINT_SCRIPT = `<script>(function(){
  var done=false;
  function p(){ if(done)return; done=true; window.focus(); window.print(); }
  if(document.readyState==='complete'){ p(); } else { window.addEventListener('load',p); }
  setTimeout(p, 4000);
})();</script>`;

/** Wie viele Schilder auf einen A4-Bogen passen (297mm − Ränder) ÷ 37mm. */
const PRO_SEITE = 7;

function schildHtml(s: KartonSchild): string {
  const serie  = (s.serie  ?? "").trim();
  const modell = (s.modell ?? "").trim();
  const zusatz = (s.zusatz ?? "").trim();
  const fach   = (s.fach   ?? "").trim();

  // Lange Modellnamen kleiner setzen, damit sie in einer Zeile bleiben. Die
  // Grenzen sind an den echten Namen kalibriert: "T15 Gen 2i" (10) passt groß,
  // "840 G7 Detachable" nicht mehr.
  const groesse = modell.length <= 12 ? "28pt" : modell.length <= 20 ? "21pt" : "15pt";

  return `<div class="schild">
    ${fach ? `<div class="fach">${escapeHtml(fach)}</div>` : ""}
    ${herstellerBlock(s.hersteller)}
    <div class="mitte">
      ${serie ? `<div class="serie">${escapeHtml(serie)}</div>` : ""}
      <div class="modell" style="font-size:${groesse}">${escapeHtml(modell)}</div>
      ${zusatz ? `<div class="zusatz">${escapeHtml(zusatz)}</div>` : ""}
    </div>
    <div class="logo rechts">
      <img src="${escapeHtml(logoUrl("afb.svg"))}" alt="AfB social &amp; green IT">
    </div>
  </div>`;
}

/**
 * Druckt Karton-Beschriftungen, 150 × 37 mm, mit Schnittrahmen.
 *
 * Mehrere pro A4-Bogen untereinander. Der Auto-Print wartet auf das
 * window.load-Event, damit die Logos mitgedruckt werden.
 */
export function printKartonSchilder(schilder: KartonSchild[]): void {
  const liste = schilder.filter((s) => (s.modell ?? "").trim() !== "" || (s.serie ?? "").trim() !== "");
  if (liste.length === 0) return;

  // Fenster VOR jeder weiteren Arbeit öffnen — sonst greift der Popup-Blocker.
  const w = window.open("", "_blank", "width=820,height=1000");
  if (!w) { console.warn("Popup blockiert — Popup-Blocker deaktivieren"); return; }

  const css = `
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact;
        font-family: Arial, Helvetica, sans-serif; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }

    .bogen { page-break-after: always; }
    .bogen:last-child { page-break-after: avoid; }

    /* 150 x 37 mm. Der Rahmen ist die Schnittkante — dünn, aber sichtbar. */
    .schild {
      position: relative;
      width: 150mm; height: 37mm;
      border: 0.3mm solid #000;
      display: flex; align-items: center;
      padding: 2mm 4mm;
      overflow: hidden;
      background: #fff;
    }
    /* Randlos aneinander: der untere Rahmen des einen ist der obere des
       naechsten. Spart Schnitte und Papier. */
    .schild + .schild { margin-top: -0.3mm; }

    .logo { flex: 0 0 34mm; height: 100%; display: flex; align-items: center; }
    .logo.rechts { justify-content: flex-end; }
    .logo img { max-width: 34mm; max-height: 15mm; object-fit: contain; }
    .logo-text { font-size: 17pt; font-weight: 700; letter-spacing: 0.4pt; color: #000; }

    .mitte { flex: 1 1 auto; text-align: center; padding: 0 3mm; min-width: 0; }
    .serie  { font-size: 12pt; font-weight: 600; letter-spacing: 0.3pt; line-height: 1.1; }
    .modell { font-weight: 700; line-height: 1.15; white-space: nowrap;
              overflow: hidden; text-overflow: ellipsis; }
    .zusatz { font-size: 10pt; font-weight: 600; line-height: 1.2; }

    /* Fachnummer klein in der Ecke — findbar, aber nicht im Weg. */
    .fach { position: absolute; top: 1.5mm; left: 2.5mm;
            font-size: 7pt; font-weight: 700; letter-spacing: 0.3pt; color: #444;
            font-family: "Courier New", monospace; }

    @media screen {
      body { padding: 8mm; background: #eee; }
      .bogen { background: #fff; padding: 10mm; margin: 0 auto 8mm; width: 210mm; box-shadow: 0 1px 6px rgba(0,0,0,.2); }
    }
  `;

  // In Bögen zu je PRO_SEITE aufteilen.
  const boegen: string[] = [];
  for (let i = 0; i < liste.length; i += PRO_SEITE) {
    boegen.push(`<div class="bogen">${liste.slice(i, i + PRO_SEITE).map(schildHtml).join("")}</div>`);
  }

  // nurAscii ZULETZT über das fertige Dokument (siehe Kommentar oben).
  const html = nurAscii(
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Karton-Beschriftungen</title>` +
    `<style>${css}</style></head><body>${boegen.join("")}${PRINT_SCRIPT}</body></html>`,
  );

  w.document.write(html);
  w.document.close();
}

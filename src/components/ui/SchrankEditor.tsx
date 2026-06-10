"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { stellplatzQrDataUri, type SchrankOrientierung } from "@/lib/print/colliEtikett";

// WYSIWYG-Editor auf Basis von CKEditor 5 (Classic), client-side lazy geladen
// (dynamic import, ssr:false — CKEditor braucht window/document). Schnittstelle
// wie bisher: html/onHtmlChange (HTML-String) + toolbar + previewKind. Die
// Vorschau bleibt im echten Format (150×120 mm bzw. 55×30 mm).
//
// Das HTML wird VOR dem Druck serverseitig sanitized (sanitizeSchrank).

const CKEditorClient = dynamic(() => import("./CKEditorClient"), {
  ssr: false,
  loading: () => (
    <div className="min-h-[220px] flex items-center justify-center rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-sm text-[#90939a]">
      Editor lädt…
    </div>
  ),
});

// Vorschau-Regeln = Druck-Regeln (writeSchrankBeschriftung / writeTextLabel),
// damit die 1:1-Vorschau exakt dem Druck entspricht. Zusätzlich eine sinnvolle
// Mindesthöhe für die CKEditor-Eingabefläche.
const PREVIEW_CSS = `
.ck-editor__editable_inline { min-height: 220px; }
.schrank-doc > :first-child { margin-top: 0; }
.schrank-doc h1 { font-size: 22pt; margin: 0 0 2.5mm; line-height: 1.15; }
.schrank-doc h2 { font-size: 17pt; margin: 0 0 2mm;   line-height: 1.15; }
.schrank-doc h3 { font-size: 13pt; margin: 0 0 1.5mm; line-height: 1.15; }
.schrank-doc p  { font-size: 11pt; margin: 0 0 1.5mm; line-height: 1.3; }
.schrank-doc ul, .schrank-doc ol { font-size: 11pt; line-height: 1.3; margin: 0 0 1.5mm; padding-left: 6mm; }
.schrank-doc li { margin: 0 0 0.6mm; }
.schrank-doc strong { font-weight: bold; }
.schrank-doc em { font-style: italic; }
`;

type Props = {
  html:           string;
  onHtmlChange:   (html: string) => void;
  toolbar?:       "voll" | "reduziert";
  previewKind:    "schrank" | "text";
  orientierung?:  SchrankOrientierung;            // nur previewKind="schrank"
  onOrientierung?: (o: SchrankOrientierung) => void;
  qrAktiv?:       boolean;                         // nur previewKind="schrank"
  stellplatz?:    string;
};

export function SchrankEditor({
  html, onHtmlChange, toolbar = "voll", previewKind, orientierung = "quer", onOrientierung,
  qrAktiv = false, stellplatz = "",
}: Props) {
  const platz = stellplatz.trim();
  const zeigeQr = previewKind === "schrank" && qrAktiv && platz.length > 0;

  // Stellplatz-QR über DENSELBEN Pfad wie der Druck (stellplatzQrDataUri,
  // ISO-8859-1) — so ist die Vorschau byte-identisch zum gedruckten QR.
  const [qrUri, setQrUri] = useState<string | null>(null);
  useEffect(() => {
    if (!zeigeQr) { setQrUri(null); return; }
    let aktiv = true;
    stellplatzQrDataUri(platz).then((uri) => { if (aktiv) setQrUri(uri); }).catch(() => {});
    return () => { aktiv = false; };
  }, [zeigeQr, platz]);

  // [pw, ph] in mm — Bildschirm rendert mm via 96dpi, identisch zum @page-Druck,
  // daher 1:1-WYSIWYG inkl. pt-Schriftgrößen.
  const [pw, ph] =
    previewKind === "text"  ? ["55mm", "30mm"] :
    orientierung === "hoch" ? ["120mm", "150mm"] :
                              ["150mm", "120mm"];

  return (
    <div className="space-y-4">
      <style>{PREVIEW_CSS}</style>

      {/* Orientierung — nur Schrank */}
      {previewKind === "schrank" && onOrientierung && (
        <div role="group" aria-label="Orientierung" className="inline-flex rounded-lg overflow-hidden border border-[#ced4da] dark:border-[#3e4042]">
          <button
            type="button"
            aria-pressed={orientierung === "quer"}
            onClick={() => onOrientierung("quer")}
            className={`px-4 h-9 text-sm font-bold transition-colors ${orientierung === "quer" ? "bg-[#0064d2] text-white" : "bg-white dark:bg-[#242526] text-[#65676b] dark:text-[#b0b3b8]"}`}
          >
            Quer (15 × 12)
          </button>
          <button
            type="button"
            aria-pressed={orientierung === "hoch"}
            onClick={() => onOrientierung("hoch")}
            className={`px-4 h-9 text-sm font-bold border-l border-[#ced4da] dark:border-[#3e4042] transition-colors ${orientierung === "hoch" ? "bg-[#0064d2] text-white" : "bg-white dark:bg-[#242526] text-[#65676b] dark:text-[#b0b3b8]"}`}
          >
            Hoch (12 × 15)
          </button>
        </div>
      )}

      <div className="grid gap-5" style={{ gridTemplateColumns: "minmax(320px, 1fr) auto" }}>
        {/* ── Editor (CKEditor 5, lazy) ── */}
        <div className="space-y-2 min-w-0">
          <CKEditorClient
            value={html}
            onChange={onHtmlChange}
            toolbar={toolbar}
          />
          <p className="text-xs text-[#90939a] dark:text-[#6b6e73]">
            {previewKind === "text"
              ? "Fett, kursiv und Schriftgröße möglich. Die Vorschau rechts zeigt das echte Druckformat."
              : "Fett, kursiv, Listen, Überschriften und Schriftgröße möglich. Die Vorschau rechts zeigt das echte Druckformat."}
          </p>
        </div>

        {/* ── Live-Vorschau im echten Format ── */}
        <div className="space-y-2">
          <span className="block text-xs font-black uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8]">
            Vorschau — 1:1 Druck
          </span>
          {previewKind === "text" ? (
            <div
              role="img"
              aria-label="Vorschau des Labels im echten Format"
              className="bg-white border border-[#ced4da] shadow-sm flex items-center justify-center text-center"
              style={{ width: pw, height: ph, color: "#000", fontFamily: "Arial, Helvetica, sans-serif", overflow: "hidden", padding: "2mm" }}
            >
              <div className="schrank-doc" style={{ maxHeight: "100%", overflow: "hidden" }} dangerouslySetInnerHTML={{ __html: html }} />
            </div>
          ) : (
            <div
              role="img"
              aria-label="Vorschau der Schrank-Beschriftung im echten Format"
              className="relative bg-white shadow-sm"
              style={{ width: pw, height: ph, color: "#000", fontFamily: "Arial, Helvetica, sans-serif", overflow: "hidden" }}
            >
              <div
                className="schrank-doc absolute"
                style={{ inset: "4mm", padding: "5mm", overflow: "hidden" }}
              >
                {/* Stellplatz-QR oben rechts (float, damit Text nicht darunter läuft).
                    Gleiche SVG-Quelle wie der Druck (ISO-8859-1) → byte-identisch. */}
                {zeigeQr && qrUri && (
                  <div style={{ float: "right", width: "30mm", margin: "0 0 2mm 3mm", textAlign: "center" }}>
                    <img
                      src={qrUri}
                      alt={`Stellplatz-QR ${platz}`}
                      style={{ display: "block", width: "28mm", height: "28mm", margin: "0 auto" }}
                    />
                    <div style={{ marginTop: "1mm", fontSize: "8pt", lineHeight: 1.1, wordBreak: "break-all" }}>{platz}</div>
                  </div>
                )}
                <div dangerouslySetInnerHTML={{ __html: html }} />
              </div>
              {/* Schnittkante: dünne, helle Linie ein paar mm vom Rand */}
              <div className="absolute pointer-events-none" style={{ inset: "4mm", border: "0.4pt solid #999" }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

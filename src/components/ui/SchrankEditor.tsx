"use client";

import { useEffect, useRef } from "react";
import { Bold, Italic, List, ListOrdered } from "lucide-react";
import type { SchrankOrientierung } from "@/lib/print/colliEtikett";

// Schlanker contentEditable-WYSIWYG-Editor (KEINE externe Editor-Abhängigkeit,
// React-19-sicher). Formatierung via document.execCommand: fett, kursiv,
// Aufzählung/Nummerierung, Überschrift/Schriftgröße. Das erzeugte HTML wird
// VOR dem Druck serverseitig sanitized (nur erlaubte Tags überleben).
//
// Bewusst un-controlled: initiales HTML wird EINMAL beim Mount gesetzt, danach
// nur via onInput nach oben gemeldet — sonst springt der Cursor. Zum Leeren
// von außen den `key` der Komponente wechseln (erzwingt Remount).

// Dieselben Regeln wie das Druck-Template (writeSchrankBeschriftung) — damit die
// Vorschau im echten Format exakt dem Druck entspricht (echtes WYSIWYG).
const PREVIEW_CSS = `
.schrank-doc > :first-child { margin-top: 0; }
.schrank-doc h1 { font-size: 22pt; margin: 0 0 2.5mm; line-height: 1.15; }
.schrank-doc h2 { font-size: 17pt; margin: 0 0 2mm;   line-height: 1.15; }
.schrank-doc h3 { font-size: 13pt; margin: 0 0 1.5mm; line-height: 1.15; }
.schrank-doc p  { font-size: 11pt; margin: 0 0 1.5mm; line-height: 1.3; }
.schrank-doc ul, .schrank-doc ol { font-size: 11pt; line-height: 1.3; margin: 0 0 1.5mm; padding-left: 6mm; }
.schrank-doc li { margin: 0 0 0.6mm; }
.schrank-doc strong { font-weight: bold; }
.schrank-doc em { font-style: italic; }
.schrank-edit:empty::before { content: attr(data-placeholder); color: #90939a; }
`;

type Props = {
  html:          string;
  onHtmlChange:  (html: string) => void;
  orientierung:  SchrankOrientierung;
  onOrientierung: (o: SchrankOrientierung) => void;
};

const btn =
  "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-sm font-semibold text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors";

export function SchrankEditor({ html, onHtmlChange, orientierung, onOrientierung }: Props) {
  const editRef = useRef<HTMLDivElement>(null);

  // initiales HTML einmalig setzen (Remount via key liefert leeres html)
  useEffect(() => {
    if (editRef.current && html) editRef.current.innerHTML = html;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function sync() {
    if (editRef.current) onHtmlChange(editRef.current.innerHTML);
  }

  function exec(cmd: string, value?: string) {
    editRef.current?.focus();
    // execCommand ist deprecated, aber browserweit verfügbar und ausreichend
    // für diese schlichte Formatierung — vermeidet eine schwere Editor-Lib.
    document.execCommand(cmd, false, value);
    sync();
  }

  // [pw, ph] in mm — Bildschirm rendert mm via 96dpi, identisch zum @page-Druck,
  // daher 1:1-WYSIWYG inkl. pt-Schriftgrößen.
  const [pw, ph] = orientierung === "hoch" ? ["120mm", "150mm"] : ["150mm", "120mm"];

  return (
    <div className="space-y-4">
      <style>{PREVIEW_CSS}</style>

      {/* Orientierung */}
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

      <div className="grid gap-5" style={{ gridTemplateColumns: "minmax(320px, 1fr) auto" }}>
        {/* ── Editor ── */}
        <div className="space-y-2 min-w-0">
          {/* Toolbar — onMouseDown preventDefault, damit die Auswahl erhalten bleibt */}
          <div className="flex flex-wrap items-center gap-2" onMouseDown={(e) => e.preventDefault()}>
            <button type="button" className={btn} onClick={() => exec("bold")} aria-label="Fett" title="Fett">
              <Bold size={16} aria-hidden />
            </button>
            <button type="button" className={btn} onClick={() => exec("italic")} aria-label="Kursiv" title="Kursiv">
              <Italic size={16} aria-hidden />
            </button>
            <button type="button" className={btn} onClick={() => exec("insertUnorderedList")} aria-label="Aufzählung" title="Aufzählung">
              <List size={16} aria-hidden />
            </button>
            <button type="button" className={btn} onClick={() => exec("insertOrderedList")} aria-label="Nummerierte Liste" title="Nummerierte Liste">
              <ListOrdered size={16} aria-hidden />
            </button>
            <select
              aria-label="Format / Schriftgröße"
              defaultValue=""
              onChange={(e) => { const v = e.target.value; if (v) exec("formatBlock", v); e.target.value = ""; }}
              className="h-9 px-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-sm font-semibold text-[#65676b] dark:text-[#b0b3b8]"
            >
              <option value="" disabled>Format / Größe…</option>
              <option value="H1">Überschrift groß</option>
              <option value="H2">Überschrift mittel</option>
              <option value="H3">Überschrift klein</option>
              <option value="P">Normaler Text</option>
            </select>
          </div>

          <div
            ref={editRef}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Schrank-Beschriftung bearbeiten"
            data-placeholder="Inhalt eingeben — z. B. Schrank-Name und Liste der Ersatzteile…"
            onInput={sync}
            className="schrank-doc schrank-edit w-full min-h-[260px] px-4 py-3 rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] focus:ring-2 focus:ring-[#0064d2]/30 transition-colors overflow-auto"
          />
          <p className="text-xs text-[#90939a] dark:text-[#6b6e73]">
            Fett, kursiv, Aufzählung und Überschriften möglich. Die Vorschau rechts zeigt das echte Druckformat.
          </p>
        </div>

        {/* ── Live-Vorschau im echten Format (mit Schnittkanten-Rahmen) ── */}
        <div className="space-y-2">
          <span className="block text-xs font-black uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8]">
            Vorschau — 1:1 Druck
          </span>
          <div
            role="img"
            aria-label="Vorschau der Schrank-Beschriftung im echten Format"
            className="relative bg-white shadow-sm"
            style={{ width: pw, height: ph, color: "#000", fontFamily: "Arial, Helvetica, sans-serif", overflow: "hidden" }}
          >
            <div
              className="schrank-doc absolute"
              style={{ inset: "4mm", padding: "5mm", overflow: "hidden" }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
            {/* Schnittkante: dünne, helle Linie ein paar mm vom Rand */}
            <div className="absolute pointer-events-none" style={{ inset: "4mm", border: "0.4pt solid #999" }} />
          </div>
        </div>
      </div>
    </div>
  );
}

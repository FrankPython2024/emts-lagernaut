"use client";

import { useId, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Printer } from "lucide-react";
import { printColliEtiketten } from "@/lib/print/colliEtikett";

// Colli-Nummern aus dem Textfeld lesen: eine pro Zeile, zusätzlich Komma/Semikolon
// als Trenner. Leere Einträge raus, Reihenfolge bleibt erhalten.
function parseColli(input: string): string[] {
  return input
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ── Einzel-Etikett — Vorschau im Seitenverhältnis 55:30, schlicht schwarz/weiß ──
// (Druck erfolgt über printColliEtiketten im exakt gleichen 55×30mm-Format.)
function ColliEtikett({ nummer, onPrint }: { nummer: string; onPrint: () => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="img"
        aria-label={`Colli-Etikett ${nummer}`}
        className="bg-white border border-[#ced4da] rounded-md overflow-hidden"
        style={{ aspectRatio: "55 / 30" }}
      >
        <div className="flex h-full w-full items-center gap-2 p-2">
          {/* QR links — füllt die Höhe, mit etwas Ruhezone (marginSize) */}
          <div className="h-full aspect-square flex-shrink-0">
            <QRCodeSVG
              value={nummer}
              level="M"
              marginSize={2}
              bgColor="#ffffff"
              fgColor="#000000"
              title={`QR-Code ${nummer}`}
              style={{ width: "100%", height: "100%", display: "block" }}
            />
          </div>
          {/* Nummer rechts */}
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#444]">
              Colli-Nummer
            </div>
            <div className="font-mono font-bold text-black leading-tight break-all text-base">
              {nummer}
            </div>
          </div>
        </div>
      </div>
      {/* „nur dieses drucken" */}
      <button
        type="button"
        onClick={onPrint}
        aria-label={`Etikett ${nummer} drucken`}
        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#0064d2] dark:text-[#45bdff] text-xs font-bold hover:bg-[#0064d2]/10 transition-colors min-h-[40px]"
      >
        <Printer size={14} aria-hidden /> Drucken
      </button>
    </div>
  );
}

export default function ColliEtikettenPage() {
  const [text, setText] = useState("");
  const nummern = useMemo(() => parseColli(text), [text]);
  const taId = useId();

  return (
    <div className="space-y-5">
      {/* Titel */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">🏷️ Colli-Etiketten</h1>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
            QR-Etiketten fürs Label-Format — QR-Code links, Colli-Nummer rechts.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            aria-live="polite"
            className="px-3 py-2 rounded-xl bg-[#0064d2]/10 text-[#0064d2] dark:text-[#45bdff] text-sm font-bold"
          >
            {nummern.length} {nummern.length === 1 ? "Etikett" : "Etiketten"}
          </span>
          <button
            type="button"
            onClick={() => printColliEtiketten(nummern)}
            disabled={nummern.length === 0}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0064d2] text-white text-sm font-bold hover:bg-[#0056b3] disabled:opacity-40 transition-colors shadow-sm min-h-[44px]"
          >
            <Printer size={16} aria-hidden /> Drucken{nummern.length > 0 ? ` (${nummern.length})` : ""}
          </button>
        </div>
      </div>

      {/* Eingabe */}
      <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-5 space-y-3">
        <label htmlFor={taId} className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
          Colli-Nummern eingeben
        </label>
        <p className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
          Eine Nummer pro Zeile. Komma oder Semikolon werden ebenfalls als Trenner erkannt.
        </p>
        <textarea
          id={taId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          spellCheck={false}
          autoComplete="off"
          placeholder={"COL-0001\nCOL-0002\nCOL-0003"}
          className="w-full px-4 py-3 rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] font-mono text-sm outline-none focus:border-[#0064d2] focus:ring-2 focus:ring-[#0064d2]/30 transition-colors resize-y min-h-[140px]"
        />
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => setText("")}
            disabled={text.length === 0}
            className="px-4 py-2.5 rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] text-sm font-semibold hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] disabled:opacity-40 transition-colors min-h-[44px]"
          >
            Leeren
          </button>
          <span className="text-xs text-[#90939a] dark:text-[#6b6e73]">
            Druck im 55 × 30 mm-Label-Format (gleicher Drucker wie die Auslagerbelege).
          </span>
        </div>
      </div>

      {/* Live-Vorschau */}
      <div className="space-y-3">
        <h2 className="text-sm font-black uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8]">
          Vorschau
        </h2>
        {nummern.length === 0 ? (
          <div className="text-center py-16 text-[#65676b] dark:text-[#b0b3b8] border border-dashed border-[#ced4da] dark:border-[#3e4042] rounded-2xl">
            Noch keine Colli-Nummern — oben eingeben, um Etiketten zu sehen.
          </div>
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}
          >
            {nummern.map((nr, i) => (
              <ColliEtikett key={`${i}-${nr}`} nummer={nr} onPrint={() => printColliEtiketten([nr])} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

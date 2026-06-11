"use client";

import Link from "next/link";
import type { ScannerDevice } from "@/lib/pickup/useScannerMode";

// Sticky, gut sichtbarer Modus-Indikator fürs Pickup-Scannen: zeigt jederzeit
// unmissverständlich, in welchem Scan-Zweck man ist (LogID-Suche vs. Colli-
// Suche), farblich klar unterschieden, und bietet den Umschalter zum anderen
// Modus. Klebt direkt unter dem Pickup-Header (h-16).

export function ModusBanner({
  modus, switchHref, switchLabel,
}: {
  modus:        "logid" | "colli";
  switchHref?:  string;  // optional: ohne Switch reiner Indikator
  switchLabel?: string;
}) {
  const istLog = modus === "logid";
  const bg     = istLog ? "#008BD2" : "#7c3aed"; // Blau vs. Violett — klar verschieden
  return (
    <div className="sticky top-16 z-10 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-3 pb-1 bg-[#f0f2f5] dark:bg-[#18191a]">
      <div
        className="rounded-xl px-4 py-3 flex items-center justify-between gap-3 shadow-md text-white"
        style={{ background: bg }}
        role="status"
        aria-label={`Modus: ${istLog ? "LogID-Suche" : "Colli-Suche"}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-2xl" aria-hidden>{istLog ? "🏷️" : "🧭"}</span>
          <div className="min-w-0">
            <div className="text-[11px] font-black uppercase tracking-widest opacity-80">Modus</div>
            <div className="text-xl font-black leading-tight truncate">
              {istLog ? "LogID-Suche" : "Colli-Suche"}
            </div>
          </div>
        </div>
        {switchHref && (
          <Link
            href={switchHref}
            className="inline-flex items-center gap-1.5 px-4 rounded-lg bg-white/15 hover:bg-white/25 text-sm font-bold transition-colors min-h-[44px] flex-shrink-0"
          >
            ⇄ {switchLabel}
          </Link>
        )}
      </div>
    </div>
  );
}

// Kleiner Typ-Badge für Auftragslisten (LogID blau / Colli violett) — gleiche
// Farblogik wie der ModusBanner.
export function TypBadge({ typ }: { typ: "LOGID" | "COLLI" }) {
  const colli = typ === "COLLI";
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-black flex-shrink-0"
      style={{ background: colli ? "rgba(124,58,237,0.12)" : "rgba(0,139,210,0.12)", color: colli ? "#7c3aed" : "#008BD2" }}
    >
      {colli ? "🧭 Colli" : "🏷️ LogID"}
    </span>
  );
}

// Kompakter Geräte-Indikator + manueller Umschalter (Mobil / Handscanner).
export function GeraeteUmschalter({
  device, onChange, className = "",
}: {
  device:   ScannerDevice;
  onChange: (d: ScannerDevice) => void;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="text-xs text-[#65676b] dark:text-[#b0b3b8]">Eingabe:</span>
      <div role="group" aria-label="Eingabegerät" className="inline-flex rounded-lg overflow-hidden border border-[#ced4da] dark:border-[#3e4042]">
        <button
          type="button"
          onClick={() => onChange("handscanner")}
          aria-pressed={device === "handscanner"}
          className={`px-3 h-9 text-xs font-bold transition-colors ${device === "handscanner" ? "bg-[#008BD2] text-white" : "bg-white dark:bg-[#242526] text-[#65676b] dark:text-[#b0b3b8]"}`}
        >
          📟 Handscanner
        </button>
        <button
          type="button"
          onClick={() => onChange("mobil")}
          aria-pressed={device === "mobil"}
          className={`px-3 h-9 text-xs font-bold border-l border-[#ced4da] dark:border-[#3e4042] transition-colors ${device === "mobil" ? "bg-[#008BD2] text-white" : "bg-white dark:bg-[#242526] text-[#65676b] dark:text-[#b0b3b8]"}`}
        >
          📱 Mobil
        </button>
      </div>
    </div>
  );
}

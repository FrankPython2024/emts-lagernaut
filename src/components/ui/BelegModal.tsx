"use client";
import type { ReactNode } from "react";

type BelegModalProps = {
  titel:        string;
  beleg:        ReactNode;
  onDrucken:    () => void;
  onSchliessen: () => void;
};

export function BelegModal({ titel, beleg, onDrucken, onSchliessen }: BelegModalProps) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-[#242526] rounded-2xl shadow-2xl w-full max-w-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#ced4da] dark:border-[#3e4042]">
          <h2 className="font-black text-lg text-[#1a1a1a] dark:text-[#e4e6eb]">{titel}</h2>
          <button
            onClick={onSchliessen}
            className="text-[#65676b] hover:text-[#fa3e3e] text-xl font-bold transition-colors"
          >
            ×
          </button>
        </div>

        {/* Vorschau — Label 2.5× skaliert (55mm×30mm → ~520px×283px)
            Wichtig: beleg wird mit scale=1 übergeben, Skalierung nur HIER */}
        <div
          className="flex justify-center items-center bg-[#f0f2f5] dark:bg-[#18191a] mx-6 my-6 rounded-xl"
          style={{ height: "300px", overflow: "hidden" }}
        >
          <div style={{
            transform:       "scale(2.5)",
            transformOrigin: "center center",
            display:         "inline-block",
            lineHeight:      0,   /* verhindert extra Zeilenabstand um das div */
          }}>
            {beleg}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#ced4da] dark:border-[#3e4042]">
          <p className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
            Thermodrucker · 57×32mm
          </p>
          <div className="flex gap-3">
            <button
              onClick={onSchliessen}
              className="px-5 py-2.5 text-sm text-[#65676b] dark:text-[#b0b3b8] hover:text-[#1a1a1a] dark:hover:text-[#e4e6eb] font-semibold rounded-lg hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors"
            >
              Überspringen
            </button>
            <button
              onClick={() => { onDrucken(); onSchliessen(); }}
              className="flex items-center gap-2 px-5 py-2.5 bg-[#0064d2] text-white text-sm font-bold rounded-lg hover:bg-[#0056b3] transition-colors shadow-sm"
            >
              🖨️ Drucken
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Mehrere Belege (Gruppe erledigen) ─────────────────────────────────────────

type MehrBelegModalProps = {
  anzahl:       number;
  onDrucken:    () => void;
  onSchliessen: () => void;
};

export function MehrBelegModal({ anzahl, onDrucken, onSchliessen }: MehrBelegModalProps) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-[#242526] rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="px-6 py-8 text-center">
          <div className="text-5xl mb-4">🖨️</div>
          <h2 className="font-black text-xl text-[#1a1a1a] dark:text-[#e4e6eb] mb-2">
            {anzahl} Auslagerbeleg{anzahl !== 1 ? "e" : ""} drucken?
          </h2>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
            Alle {anzahl} Belege werden in einem Druckfenster geöffnet.
          </p>
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <button
            onClick={onSchliessen}
            className="flex-1 py-2.5 text-sm text-[#65676b] dark:text-[#b0b3b8] font-semibold rounded-lg border border-[#ced4da] dark:border-[#3e4042] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors"
          >
            Überspringen
          </button>
          <button
            onClick={() => { onDrucken(); onSchliessen(); }}
            className="flex-1 py-2.5 bg-[#0064d2] text-white text-sm font-bold rounded-lg hover:bg-[#0056b3] transition-colors"
          >
            Alle drucken
          </button>
        </div>
      </div>
    </div>
  );
}

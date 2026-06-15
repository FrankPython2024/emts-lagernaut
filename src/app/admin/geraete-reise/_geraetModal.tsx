"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/trpc/react";
import { GeraetDetailInhalt } from "./_geraetDetail";

// Geräte-Reise — Detail-Popup. Statt zu einer eigenen Seite zu navigieren (und
// damit die aktuelle Liste/Auswahl zu verlieren), öffnet sich die Geräte-Reise
// eines Geräts als Overlay über der aktuellen Ansicht. Modulweit per Hook
// nutzbar (Provider liegt im geraete-reise-Layout). Reine Auswertung.

type Ctx = { oeffneGeraet: (q: string) => void };
const GeraetModalContext = createContext<Ctx | null>(null);

export function useGeraetModal(): Ctx {
  const c = useContext(GeraetModalContext);
  if (!c) throw new Error("useGeraetModal muss innerhalb des GeraetModalProvider verwendet werden.");
  return c;
}

export function GeraetModalProvider({ children }: { children: React.ReactNode }) {
  const [q, setQ] = useState<string | null>(null);
  const oeffneGeraet = useCallback((wert: string) => {
    const t = wert.trim();
    if (t) setQ(t);
  }, []);

  return (
    <GeraetModalContext.Provider value={{ oeffneGeraet }}>
      {children}
      {q !== null && <GeraetModal key={q} initialQ={q} onClose={() => setQ(null)} />}
    </GeraetModalContext.Provider>
  );
}

function GeraetModal({ initialQ, onClose }: { initialQ: string; onClose: () => void }) {
  // Eigener Such-State, damit eine Seriennummer-Auswahl IM Popup bleibt.
  const [q, setQ] = useState(initialQ);
  const query = api.geraeteReise.geraet.useQuery({ query: q }, { enabled: q.trim().length > 0 });
  const data = query.data;

  // Schließen per Escape + Body-Scroll sperren, solange offen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Lagerfuchs"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex flex-col w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl shadow-2xl bg-[#f0f2f5] dark:bg-[#18191a]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Kopf mit Schließen — bleibt oben fest, scrollt nicht mit */}
        <div className="flex-shrink-0 flex items-center justify-between gap-3 px-5 py-3 bg-[#202F61] text-white">
          <h2 className="font-black flex items-center gap-2"><span aria-hidden>🦊</span> Lagerfuchs</h2>
          <button
            onClick={onClose}
            aria-label="Schließen"
            className="inline-flex items-center justify-center rounded-lg bg-white/15 hover:bg-white/25 font-bold text-lg min-h-[56px] min-w-[56px]"
          >
            ✕
          </button>
        </div>

        {/* Inhalt — nur hier wird gescrollt */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5" aria-live="polite">
          {query.isFetching && (
            <div className="flex items-center gap-3 p-5 bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042]">
              <div className="w-5 h-5 border-2 border-[#0064d2]/20 border-t-[#0064d2] rounded-full animate-spin flex-shrink-0" />
              <span className="text-[#65676b] dark:text-[#b0b3b8]">Lädt…</span>
            </div>
          )}

          {!query.isFetching && data?.kind === "none" && (
            <div className="p-5 bg-white dark:bg-[#242526] rounded-xl border-2 border-[#f7b928]/40 flex items-center gap-3">
              <span className="text-2xl" aria-hidden>⚠️</span>
              <div>
                <p className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Nicht gefunden</p>
                <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
                  Kein Gerät mit LogID oder Seriennummer <span className="font-mono">{q}</span>.
                </p>
              </div>
            </div>
          )}

          {!query.isFetching && data?.kind === "treffer" && (
            <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] overflow-hidden">
              <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042]">
                <p className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{data.treffer.length} Treffer — bitte Gerät wählen</p>
              </div>
              <div className="divide-y divide-[#ced4da] dark:divide-[#3e4042]">
                {data.treffer.map((t) => (
                  <button
                    key={t.logId}
                    onClick={() => setQ(t.logId)}
                    className="w-full text-left px-5 py-3 hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] transition-colors flex items-center justify-between gap-3 min-h-[56px]"
                  >
                    <span className="font-mono font-bold text-[#0064d2] dark:text-[#45bdff]">{t.logId}</span>
                    <span className="text-sm text-[#65676b] dark:text-[#b0b3b8] truncate">{t.bezeichnung ?? "—"}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!query.isFetching && data?.kind === "found" && (
            <GeraetDetailInhalt stand={data.stand} bewegungen={data.bewegungen} />
          )}
        </div>
      </div>
    </div>
  );
}

"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/trpc/react";
import { useGeraetModal, nextModalZ } from "./_geraetModal";
import { formatEuro } from "./_format";

// Geräte-Reise — Colli-Detail-Popup. Zeigt alle Geräte, die im selben Colli
// liegen. Öffnet sich als Overlay (genau wie das LogID-Popup) und liegt modulweit
// per Hook bereit. Ein Klick auf ein Gerät öffnet zusätzlich das LogID-Detail-
// Popup (useGeraetModal) darüber. Reine Auswertung, kein Bestandseffekt.

// Der Provider liefert NUR Kontext/State. Das Overlay wird separat
// (ColliModalOverlay) am innersten Punkt gerendert — innerhalb beider Provider,
// damit es auf useGeraetModal zugreifen kann (klickbares Gerät im Colli-Popup).
type Ctx = {
  oeffneColli: (colli: string) => void;
  aktuell:     string | null;
  schliessen:  () => void;
};
const ColliModalContext = createContext<Ctx | null>(null);

export function useColliModal(): Ctx {
  const c = useContext(ColliModalContext);
  if (!c) throw new Error("useColliModal muss innerhalb des ColliModalProvider verwendet werden.");
  return c;
}

export function ColliModalProvider({ children }: { children: React.ReactNode }) {
  const [colli, setColli] = useState<string | null>(null);
  const oeffneColli = useCallback((wert: string) => {
    const t = wert.trim();
    if (t) setColli(t);
  }, []);
  const schliessen = useCallback(() => setColli(null), []);

  return (
    <ColliModalContext.Provider value={{ oeffneColli, aktuell: colli, schliessen }}>
      {children}
    </ColliModalContext.Provider>
  );
}

// Overlay separat rendern (innerhalb beider Provider) — liest seinen State aus
// dem Kontext.
export function ColliModalOverlay() {
  const { aktuell, schliessen } = useColliModal();
  if (aktuell === null) return null;
  return <ColliModal key={aktuell} colli={aktuell} onClose={schliessen} />;
}

function ColliModal({ colli, onClose }: { colli: string; onClose: () => void }) {
  const { oeffneGeraet } = useGeraetModal();
  const [z] = useState(nextModalZ); // beim Öffnen: liegt über vorher Geöffnetem
  const { data, isFetching } = api.geraeteReise.colliInhalt.useQuery(
    { colli },
    { staleTime: 30_000 },
  );

  // Schließen per Escape + Body-Scroll sperren, solange offen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const anzahl = data?.anzahl ?? 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Colli ${colli}`}
      style={{ zIndex: z }}
      className="fixed inset-0 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex flex-col w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl shadow-2xl bg-[#f0f2f5] dark:bg-[#18191a]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Kopf mit Schließen — bleibt oben fest, scrollt nicht mit */}
        <div className="flex-shrink-0 flex items-center justify-between gap-3 px-5 py-3 bg-[#202F61] text-white">
          <div className="min-w-0">
            <h2 className="font-black flex items-center gap-2">
              <span aria-hidden>📦</span> Colli {colli}
            </h2>
            <p className="text-sm text-white/80 mt-0.5">
              {isFetching
                ? "Lädt…"
                : `${anzahl} ${anzahl === 1 ? "Gerät" : "Geräte"} · Wert gesamt: ${formatEuro(data?.wertGesamt)}`}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Schließen"
            className="flex-shrink-0 inline-flex items-center justify-center rounded-lg bg-white/15 hover:bg-white/25 font-bold text-lg min-h-[56px] min-w-[56px]"
          >
            ✕
          </button>
        </div>

        {/* Inhalt — nur hier wird gescrollt */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5" aria-live="polite">
          {isFetching && (
            <div className="flex items-center gap-3 p-5 bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042]">
              <div className="w-5 h-5 border-2 border-[#0064d2]/20 border-t-[#0064d2] rounded-full animate-spin flex-shrink-0" />
              <span className="text-[#65676b] dark:text-[#b0b3b8]">Lädt…</span>
            </div>
          )}

          {!isFetching && anzahl === 0 && (
            <div className="p-5 bg-white dark:bg-[#242526] rounded-xl border-2 border-[#f7b928]/40 flex items-center gap-3">
              <span className="text-2xl" aria-hidden>⚠️</span>
              <div>
                <p className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Keine Geräte gefunden</p>
                <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
                  Im Colli <span className="font-mono">{colli}</span> liegt aktuell kein Gerät.
                </p>
              </div>
            </div>
          )}

          {!isFetching && anzahl > 0 && (
            <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] overflow-hidden">
              <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042] flex items-center gap-2">
                <span aria-hidden>🧾</span>
                <p className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
                  Diese Geräte liegen zusammen. Tippe ein Gerät an, um seine Reise zu sehen.
                </p>
              </div>
              <ul className="divide-y divide-[#ced4da] dark:divide-[#3e4042]">
                {data!.geraete.map((g) => (
                  <li key={g.logId}>
                    <button
                      onClick={() => oeffneGeraet(g.logId)}
                      className="w-full text-left px-5 py-3 min-h-[56px] hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] transition-colors flex flex-col gap-1"
                    >
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <span className="font-mono font-bold text-[#0064d2] dark:text-[#45bdff]">{g.logId}</span>
                        {g.verbleib && (
                          <span className="text-xs font-black px-2.5 py-1 rounded-full bg-[#e7f0fd] text-[#0064d2] dark:bg-[#11243d] dark:text-[#45bdff]">
                            📍 {g.verbleib}
                          </span>
                        )}
                      </div>
                      <span className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb] break-words">
                        {[g.hersteller, g.bezeichnung].filter(Boolean).join(" ") || "—"}
                      </span>
                      <div className="flex items-center gap-x-4 gap-y-0.5 flex-wrap text-xs text-[#65676b] dark:text-[#b0b3b8]">
                        <span>🗄️ Stellplatz: {g.stellplatz || "—"}</span>
                        <span>💶 Einkaufswert: {formatEuro(g.ek)}</span>
                        {g.grading && <span>⭐ Grading: {g.grading}</span>}
                        {g.aktuellerZustand && <span>🔧 {g.aktuellerZustand}</span>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/trpc/react";
import { GeraetDetailInhalt, FehlteilKarte } from "./_geraetDetail";

// Geräte-Reise — Detail-Popup. Statt zu einer eigenen Seite zu navigieren (und
// damit die aktuelle Liste/Auswahl zu verlieren), öffnet sich die Geräte-Reise
// eines Geräts als Overlay über der aktuellen Ansicht. Modulweit per Hook
// nutzbar (Provider liegt im geraete-reise-Layout). Reine Auswertung.

// Der Provider liefert NUR Kontext/State (öffnen/schließen). Das Overlay wird
// separat (GeraetModalOverlay) gerendert — und zwar am innersten Punkt, innerhalb
// BEIDER Provider, damit es auch auf useColliModal zugreifen kann (klickbarer
// Colli im Detail) ohne zirkuläre Provider-Schachtelung.
type Ctx = {
  oeffneGeraet: (q: string) => void;
  aktuell:      string | null;
  schliessen:   () => void;
};
const GeraetModalContext = createContext<Ctx | null>(null);

export function useGeraetModal(): Ctx {
  const c = useContext(GeraetModalContext);
  if (!c) throw new Error("useGeraetModal muss innerhalb des GeraetModalProvider verwendet werden.");
  return c;
}

// Gemeinsamer z-Index-Zähler für die stapelbaren Overlays (LogID + Colli). Jedes
// Overlay holt sich beim Öffnen den nächsten Wert → das zuletzt geöffnete liegt
// immer oben, egal in welcher Reihenfolge sie sich gegenseitig öffnen.
let modalZCounter = 60;
export function nextModalZ(): number { return ++modalZCounter; }

export function GeraetModalProvider({ children }: { children: React.ReactNode }) {
  const [q, setQ] = useState<string | null>(null);
  const oeffneGeraet = useCallback((wert: string) => {
    const t = wert.trim();
    if (t) setQ(t);
  }, []);
  const schliessen = useCallback(() => setQ(null), []);

  return (
    <GeraetModalContext.Provider value={{ oeffneGeraet, aktuell: q, schliessen }}>
      {children}
    </GeraetModalContext.Provider>
  );
}

// Overlay separat rendern (innerhalb beider Provider) — liest seinen State aus
// dem Kontext.
export function GeraetModalOverlay() {
  const { aktuell, schliessen } = useGeraetModal();
  if (aktuell === null) return null;
  return <GeraetModal key={aktuell} initialQ={aktuell} onClose={schliessen} />;
}

function GeraetModal({ initialQ, onClose }: { initialQ: string; onClose: () => void }) {
  // Eigener Such-State, damit eine Seriennummer-Auswahl IM Popup bleibt.
  const [q, setQ] = useState(initialQ);
  const [z] = useState(nextModalZ); // beim Öffnen: liegt über vorher Geöffnetem
  const aktiv = q.trim().length > 0;
  const query = api.geraeteReise.geraet.useQuery({ query: q }, { enabled: aktiv });
  // Fehlteil-Daten parallel laden (logId-exakt). Fehlteile liegen oft NICHT in
  // LogIdStand → robust: einfach nur die Fehlteil-Karte zeigen, wenn vorhanden.
  const fehlteilQ = api.fehlteile.detail.useQuery({ logId: q }, { enabled: aktiv });
  const data = query.data;
  const fehlteil = fehlteilQ.data;
  const laedt = query.isFetching || fehlteilQ.isFetching;

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
          {laedt && (
            <div className="flex items-center gap-3 p-5 bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042]">
              <div className="w-5 h-5 border-2 border-[#0064d2]/20 border-t-[#0064d2] rounded-full animate-spin flex-shrink-0" />
              <span className="text-[#65676b] dark:text-[#b0b3b8]">Lädt…</span>
            </div>
          )}

          {/* Mehrere Seriennummer-Treffer → erst Gerät wählen */}
          {!laedt && data?.kind === "treffer" && (
            <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] overflow-hidden">
              <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042]">
                <p className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{data.treffer.length} Treffer, bitte Gerät wählen</p>
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

          {/* Fehlteil-Karte (falls als Fehlteil verbucht) + Geräte-Reise (falls in
              LogIdStand). Beides möglich; mind. eines davon wird gezeigt. */}
          {!laedt && data?.kind !== "treffer" && (
            <div className="space-y-6">
              {fehlteil && <FehlteilKarte fehlteil={fehlteil} />}
              {data?.kind === "found" && <GeraetDetailInhalt stand={data.stand} bewegungen={data.bewegungen} />}

              {!fehlteil && data?.kind === "none" && (
                <div className="p-5 bg-white dark:bg-[#242526] rounded-xl border-2 border-[#f7b928]/40 flex items-center gap-3">
                  <span className="text-2xl" aria-hidden>⚠️</span>
                  <div>
                    <p className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Nicht gefunden</p>
                    <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
                      Kein Gerät und kein Fehlteil mit LogID oder Seriennummer <span className="font-mono">{q}</span>.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

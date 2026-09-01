"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/trpc/react";
import { GeraeteReiseTabs } from "../_tabs";
import { GeraetDetailInhalt } from "../_geraetDetail";

// Geräte-Reise — S2: ein Gerät verfolgen (Suche + aktueller Stand + Timeline).
// Die Detail-Darstellung liegt in _geraetDetail (wird auch vom Detail-Popup genutzt).

export default function GeraetVerfolgenPage() {
  // useSearchParams braucht eine Suspense-Grenze.
  return (
    <Suspense fallback={null}>
      <GeraetVerfolgen />
    </Suspense>
  );
}

function GeraetVerfolgen() {
  const inputRef = useRef<HTMLInputElement>(null);
  const params = useSearchParams();
  const [input, setInput]         = useState("");
  const [submitted, setSubmitted] = useState("");

  const query = api.geraeteReise.geraet.useQuery(
    { query: submitted },
    { enabled: submitted.trim().length > 0 },
  );

  // Deep-Link aus dem Dashboard (S3): /admin/geraete-reise/geraet?q={logId}
  useEffect(() => {
    const q = params?.get("q");
    if (q) {
      setInput(q);
      setSubmitted(q);
    } else {
      inputRef.current?.focus();
    }
  }, [params]);

  function suchen() {
    const v = input.trim();
    if (v) setSubmitted(v);
  }

  const data    = query.data;
  const loading = query.isFetching;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">🦊 Lagerfuchs</h1>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
          Ein Gerät über LogID oder Seriennummer verfolgen
        </p>
      </div>

      <GeraeteReiseTabs />

      {/* Suchfeld */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm">
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") suchen(); }}
            placeholder="LogID oder Seriennummer eingeben → Enter"
            className="w-full px-4 py-4 text-lg font-bold font-mono rounded-xl border-2 border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] dark:focus:border-[#45bdff] transition-colors"
          />
          {input && (
            <button
              onClick={() => { setInput(""); inputRef.current?.focus(); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[#65676b] hover:text-[#fa3e3e] text-2xl font-bold transition-colors"
              aria-label="Eingabe löschen"
            >
              ✕
            </button>
          )}
        </div>
        <button
          onClick={suchen}
          disabled={!input.trim()}
          className="mt-3 w-full sm:w-auto px-6 py-2.5 rounded-xl bg-[#0064d2] dark:bg-[#45bdff] text-white font-bold disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          🔍 Gerät laden
        </button>
      </div>

      {/* Ergebnis */}
      {submitted && (
        <div className="space-y-6">
          {loading && (
            <div className="flex items-center gap-3 p-5 bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm">
              <div className="w-5 h-5 border-2 border-[#0064d2]/20 border-t-[#0064d2] rounded-full animate-spin flex-shrink-0" />
              <span className="text-[#65676b] dark:text-[#b0b3b8]">Suche läuft…</span>
            </div>
          )}

          {/* Nicht gefunden */}
          {!loading && data?.kind === "none" && (
            <div className="p-5 bg-white dark:bg-[#242526] rounded-xl border-2 border-[#f7b928]/40 shadow-sm flex items-center gap-3">
              <span className="text-2xl">⚠️</span>
              <div>
                <p className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Nicht gefunden</p>
                <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
                  Kein Gerät mit LogID oder Seriennummer <span className="font-mono">{submitted}</span>.
                </p>
              </div>
            </div>
          )}

          {/* Mehrere Seriennummer-Treffer → Auswahl */}
          {!loading && data?.kind === "treffer" && (
            <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042]">
                <p className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
                  {data.treffer.length} Treffer, bitte Gerät wählen
                </p>
              </div>
              <div className="divide-y divide-[#ced4da] dark:divide-[#3e4042]">
                {data.treffer.map((t) => (
                  <button
                    key={t.logId}
                    onClick={() => { setInput(t.logId); setSubmitted(t.logId); }}
                    className="w-full text-left px-5 py-3 hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] transition-colors flex items-center justify-between gap-3"
                  >
                    <span className="font-mono font-bold text-[#0064d2] dark:text-[#45bdff]">{t.logId}</span>
                    <span className="text-sm text-[#65676b] dark:text-[#b0b3b8] truncate">{t.bezeichnung ?? "—"}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Gefunden */}
          {!loading && data?.kind === "found" && (
            <GeraetDetailInhalt stand={data.stand} bewegungen={data.bewegungen} />
          )}
        </div>
      )}
    </div>
  );
}

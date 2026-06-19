"use client";
import { useRef, useState } from "react";
import { api } from "@/trpc/react";
import { GeraeteReiseTabs } from "../_tabs";
import { useGeraetModal } from "../_geraetModal";

// Geräte-Reise — Colli verfolgen: Colli-Nummer eintippen → ALLE Geräte, die auf
// dieser Colli waren: die noch drauf liegen UND die rausgewandert sind, je mit
// aktuellem Stellplatz + Status. Reine Auswertung über colliVerlauf (kein Backend-/
// Schema-Eingriff). Klick auf eine LogID öffnet das Geräte-Detail-Popup (useGeraetModal).

function fmtDatum(d: Date | string): string {
  return new Date(d).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// Status als Text + Farbe (NICHT nur Farbe) — barrierearm.
function StatusBadge({ status, ausgeschieden }: { status: "im_colli" | "rausgewandert"; ausgeschieden: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {status === "im_colli" ? (
        <span className="inline-flex items-center gap-1 text-xs font-black px-2.5 py-1 rounded-full bg-[#04B475]/15 text-[#04713f] dark:text-[#3fe0a6] whitespace-nowrap">
          📦 im Colli
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs font-black px-2.5 py-1 rounded-full bg-[#f7b928]/20 text-[#9c6213] dark:text-[#f7b928] whitespace-nowrap">
          ➡️ rausgewandert
        </span>
      )}
      {ausgeschieden && (
        <span className="inline-flex items-center gap-1 text-xs font-black px-2.5 py-1 rounded-full bg-[#fa3e3e]/12 text-[#b3261e] dark:text-[#ff8a8a] whitespace-nowrap">
          ⛔ ausgeschieden
        </span>
      )}
    </div>
  );
}

export default function ColliVerfolgenPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput]         = useState("");
  const [submitted, setSubmitted] = useState("");
  const { oeffneGeraet } = useGeraetModal();

  const query = api.geraeteReise.colliVerlauf.useQuery(
    { colli: submitted },
    { enabled: submitted.trim().length > 0 },
  );

  // „Stand: letzter Import" — leichtgewichtige Liste, neuester fertiger Import.
  const importeQ     = api.geraeteReise.listImports.useQuery();
  const letzterStand = importeQ.data?.find((i) => i.status === "fertig")?.importiertAm ?? null;

  function suchen() {
    const v = input.trim();
    if (v) setSubmitted(v);
  }

  const data    = query.data;
  const loading = query.isFetching;
  const anzahl  = data?.anzahl ?? 0;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">📦 Colli verfolgen</h1>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
          Colli-Nummer eingeben — du siehst alle Geräte, die auf dieser Colli waren:
          die noch drauf liegen und die schon weitergewandert sind.
        </p>
        <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1">
          ℹ️ Zeigt den letzten bekannten Stand. „Vorheriges Colli" ist nur der letzte Umzug.
        </p>
      </div>

      <GeraeteReiseTabs />

      {/* Suchfeld — großes Eingabefeld, Enter oder Button */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm">
        <label htmlFor="colli-input" className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-2">
          Colli-Nr
        </label>
        <div className="relative">
          <input
            id="colli-input"
            ref={inputRef}
            type="text"
            inputMode="numeric"
            value={input}
            autoFocus
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") suchen(); }}
            placeholder="Colli-Nummer eingeben → Enter"
            className="w-full px-4 min-h-[56px] text-lg font-bold font-mono rounded-xl border-2 border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] dark:focus:border-[#45bdff] transition-colors"
          />
          {input && (
            <button
              onClick={() => { setInput(""); inputRef.current?.focus(); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center min-h-[44px] min-w-[44px] text-[#65676b] hover:text-[#fa3e3e] text-2xl font-bold transition-colors"
              aria-label="Eingabe löschen"
            >
              ✕
            </button>
          )}
        </div>
        <button
          onClick={suchen}
          disabled={!input.trim()}
          className="mt-3 w-full sm:w-auto px-6 min-h-[56px] rounded-xl bg-[#0064d2] dark:bg-[#45bdff] text-white font-bold disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          🔍 Colli laden
        </button>
        {letzterStand && (
          <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-3">
            Stand: letzter Import · {fmtDatum(letzterStand)}
          </p>
        )}
      </div>

      {/* Ergebnis */}
      {submitted && (
        <div className="space-y-4">
          {loading && (
            <div className="flex items-center gap-3 p-5 bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm">
              <div className="w-5 h-5 border-2 border-[#0064d2]/20 border-t-[#0064d2] rounded-full animate-spin flex-shrink-0" />
              <span className="text-[#65676b] dark:text-[#b0b3b8]">Lädt…</span>
            </div>
          )}

          {/* Leerfall */}
          {!loading && anzahl === 0 && (
            <div className="p-5 bg-white dark:bg-[#242526] rounded-xl border-2 border-[#f7b928]/40 shadow-sm flex items-start gap-3">
              <span className="text-2xl" aria-hidden>⚠️</span>
              <div>
                <p className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Keine Geräte für diese Colli gefunden.</p>
                <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
                  Gesucht: Colli <span className="font-mono">{submitted}</span>. Bitte die Schreibweise prüfen (z. B. mit Punkten).
                  {letzterStand && <> · Stand: letzter Import, {fmtDatum(letzterStand)}.</>}
                </p>
              </div>
            </div>
          )}

          {/* Treffer-Tabelle */}
          {!loading && anzahl > 0 && (
            <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042] flex items-center justify-between gap-2 flex-wrap">
                <p className="font-black text-[#1a1a1a] dark:text-[#e4e6eb]">
                  {anzahl} {anzahl === 1 ? "Gerät" : "Geräte"} – Colli <span className="font-mono">{submitted}</span>
                </p>
                <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Tippe eine LogID an, um die Geräte-Reise zu sehen.</p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="text-xs font-bold uppercase tracking-wide text-[#65676b] dark:text-[#b0b3b8] border-b border-[#ced4da] dark:border-[#3e4042]">
                      <th scope="col" className="px-5 py-2.5">LogID</th>
                      <th scope="col" className="px-5 py-2.5">Status</th>
                      <th scope="col" className="px-5 py-2.5">Stellplatz</th>
                      <th scope="col" className="px-5 py-2.5">Aktuelles Colli</th>
                      <th scope="col" className="px-5 py-2.5">Bezeichnung</th>
                      <th scope="col" className="px-5 py-2.5">Verbleib</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#ced4da] dark:divide-[#3e4042]">
                    {data!.geraete.map((g) => (
                      <tr key={g.logId} className="align-middle">
                        <td className="px-5 py-1.5">
                          <button
                            onClick={() => oeffneGeraet(g.logId)}
                            className="inline-flex items-center min-h-[56px] font-mono font-black text-lg text-[#0064d2] dark:text-[#45bdff] hover:underline"
                            aria-label={`Geräte-Reise von LogID ${g.logId} öffnen`}
                          >
                            {g.logId}
                          </button>
                        </td>
                        <td className="px-5 py-1.5">
                          <StatusBadge status={g.status} ausgeschieden={g.ausgeschieden} />
                        </td>
                        <td className="px-5 py-1.5 whitespace-nowrap">
                          {g.stellplatz ? (
                            <span className="inline-flex items-center gap-1 text-sm font-black px-2.5 py-1 rounded-full bg-[#e7f0fd] text-[#0064d2] dark:bg-[#11243d] dark:text-[#45bdff]">
                              🗄️ {g.stellplatz}
                            </span>
                          ) : (
                            <span className="text-sm text-[#65676b] dark:text-[#b0b3b8]">—</span>
                          )}
                        </td>
                        <td className="px-5 py-1.5 font-mono text-sm text-[#1a1a1a] dark:text-[#e4e6eb] whitespace-nowrap">
                          {g.colli || "—"}
                        </td>
                        <td className="px-5 py-1.5 text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
                          {[g.hersteller, g.bezeichnung].filter(Boolean).join(" ") || "—"}
                        </td>
                        <td className="px-5 py-1.5 text-sm text-[#65676b] dark:text-[#b0b3b8] whitespace-nowrap">
                          {g.verbleib || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

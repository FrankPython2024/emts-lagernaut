"use client";
import { useMemo, useState } from "react";
import { api } from "@/trpc/react";

// ── Gleiches Gerät finden ────────────────────────────────────────────────────
//
// Für den Versand: LogID scannen, sehen ob dasselbe Gerät mit demselben Grading
// noch einmal im Haus liegt — und an welchem Stellplatz, in welchem Colli.
//
// ⚠️ Die Liste ist nach Stellplatz sortiert, nicht nach LogID. Wer die Geräte
// holt, läuft die Regale der Reihe nach ab; eine nach LogID sortierte Liste
// würde ihn kreuz und quer durchs Lager schicken.
//
// Die Regal-Übersicht darüber ist kein Schmuck: Bei großen Treffermengen (im
// Bestand gibt es Gruppen mit über 700 Geräten) beantwortet sie die eigentliche
// Frage — wo liegt der Schwerpunkt, wo lohnt der Weg.

/** „KOM-11-19-3" → „KOM-11". Alles andere bleibt, wie es ist. */
function regalVon(stellplatz: string | null): string {
  if (!stellplatz) return "ohne Stellplatz";
  const m = /^([A-Za-z]+)-(\d+)/.exec(stellplatz.trim());
  return m ? `${m[1]}-${m[2]}` : stellplatz.trim();
}

export default function GleicheGeraetePage() {
  const [eingabe, setEingabe] = useState("");
  const [gesucht, setGesucht] = useState<string | null>(null);

  const abfrage = api.geraeteReise.gleicheGeraete.useQuery(
    { logId: gesucht ?? "" },
    { enabled: !!gesucht },
  );

  const daten = abfrage.data;

  // Regal-Verteilung aus den geladenen Treffern.
  const regale = useMemo(() => {
    if (!daten || daten.kind !== "found") return [];
    const z = new Map<string, number>();
    for (const t of daten.treffer) {
      const r = regalVon(t.stellplatz);
      z.set(r, (z.get(r) ?? 0) + 1);
    }
    return [...z.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [daten]);

  const maxImRegal = regale.length > 0 ? regale[0]![1] : 0;

  function suchen(e: React.FormEvent) {
    e.preventDefault();
    const q = eingabe.trim();
    if (q) setGesucht(q);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Gleiches Gerät finden</h1>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
          LogID scannen — zeigt Geräte mit derselben Bezeichnung und demselben Grading,
          mit Stellplatz und Colli.
        </p>
      </div>

      {/* ── Scan-Feld ────────────────────────────────────────────────────── */}
      <form onSubmit={suchen} className="flex gap-2 flex-wrap">
        <input
          autoFocus
          value={eingabe}
          onChange={(e) => setEingabe(e.target.value)}
          placeholder="LogID scannen oder eintippen…"
          inputMode="text"
          className="flex-1 min-w-[220px] px-4 py-3 rounded-lg border-2 border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-[#1a1a1a] dark:text-[#e4e6eb] font-mono text-base min-h-[56px] focus:border-[#0064d2] outline-none"
        />
        <button
          type="submit"
          className="px-6 py-3 rounded-lg bg-[#0064d2] text-white font-bold text-base min-h-[56px]"
        >
          Suchen
        </button>
        {gesucht && (
          <button
            type="button"
            onClick={() => { setGesucht(null); setEingabe(""); }}
            className="px-4 py-3 rounded-lg border-2 border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-bold text-base min-h-[56px]"
          >
            Zurücksetzen
          </button>
        )}
      </form>

      {abfrage.isFetching && (
        <p className="text-sm font-bold text-[#0064d2] dark:text-[#45bdff]">Wird gesucht…</p>
      )}

      {daten?.kind === "none" && (
        <div className="rounded-xl border-2 border-[#f7b928] bg-[#f7b928]/8 p-5">
          <div className="font-bold text-[#8A5A00] dark:text-[#f7b928]">
            Diese LogID ist im Lagerfuchs nicht bekannt.
          </div>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
            Möglich ist beides: Tippfehler beim Scannen, oder das Gerät kam erst nach dem
            letzten Import ins Haus.
          </p>
        </div>
      )}

      {daten?.kind === "unvollstaendig" && (
        <div className="rounded-xl border-2 border-[#f7b928] bg-[#f7b928]/8 p-5">
          <div className="font-bold text-[#8A5A00] dark:text-[#f7b928]">
            Zu diesem Gerät fehlt {daten.stand.bezeichnung ? "das Grading" : "die Bezeichnung"}.
          </div>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
            Ohne beides lässt sich nicht vergleichen. Bitte in ReForm nachtragen.
          </p>
        </div>
      )}

      {daten?.kind === "found" && (
        <>
          {/* ── Das gesuchte Gerät ──────────────────────────────────────── */}
          <div className="rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] p-5">
            <div className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase tracking-wide">
              Gesuchtes Gerät
            </div>
            <div className="font-mono font-black text-lg text-[#1a1a1a] dark:text-[#e4e6eb] mt-0.5">
              {daten.stand.logId}
            </div>
            <div className="text-base font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
              {[daten.stand.hersteller, daten.stand.bezeichnung].filter(Boolean).join(" ")}
            </div>
            <div className="flex gap-2 flex-wrap mt-2 text-sm">
              <span className="px-3 py-1 rounded-full bg-[#202F61] text-white font-black">
                Grading {daten.stand.grading}
              </span>
              <span className="px-3 py-1 rounded-full bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-mono font-bold">
                {daten.stand.stellplatz ?? "ohne Stellplatz"}
              </span>
              <span className="px-3 py-1 rounded-full bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-mono font-bold">
                Colli {daten.stand.colli ?? "—"}
              </span>
            </div>
            {daten.stand.ausgeschieden && (
              <p className="text-sm font-bold text-[#c62828] dark:text-[#ff8a80] mt-2">
                Dieses Gerät gilt als ausgeschieden — es hat das Haus bereits verlassen.
              </p>
            )}
          </div>

          {/* ── Ergebnis in einem Satz ──────────────────────────────────── */}
          {daten.gesamt === 0 ? (
            <div className="rounded-xl border-2 border-[#8A5A00] bg-[#8A5A00]/8 p-5">
              <div className="text-lg font-black text-[#8A5A00] dark:text-[#f7b928]">
                Kein zweites Gerät dieser Art mit Grading {daten.stand.grading}
              </div>
              {daten.andereGradings.length > 0 && (
                <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1.5">
                  Dasselbe Gerät gibt es aber mit anderem Grading:{" "}
                  <b>{daten.andereGradings.map((g) => `${g.anzahl}× ${g.grading}`).join(" · ")}</b>
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-xl border-2 border-[#038F5C] bg-[#04B475]/8 p-5">
              <div className="text-lg font-black text-[#038F5C] dark:text-[#04B475]">
                {daten.gesamt === 1
                  ? "1 gleiches Gerät im Lager"
                  : `${daten.gesamt} gleiche Geräte im Lager`}
              </div>
              <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
                Gleiche Bezeichnung, Grading {daten.stand.grading}.
                {daten.andereGradings.length > 0 && (
                  <> Mit anderem Grading zusätzlich:{" "}
                    {daten.andereGradings.map((g) => `${g.anzahl}× ${g.grading}`).join(" · ")}.</>
                )}
              </p>
              {daten.gekuerzt && (
                <p className="text-sm font-bold text-[#8A5A00] dark:text-[#f7b928] mt-1.5">
                  Angezeigt werden die ersten {daten.treffer.length} nach Stellplatz.
                </p>
              )}
            </div>
          )}

          {/* ── Wo liegen sie? Balken je Regal ──────────────────────────── */}
          {regale.length > 1 && (
            <div className="rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] p-5">
              <div className="text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-3">
                Verteilung auf die Regale
              </div>
              <div className="space-y-1.5">
                {regale.map(([regal, anzahl]) => (
                  <div key={regal} className="flex items-center gap-3">
                    <span className="font-mono text-sm font-bold text-[#65676b] dark:text-[#b0b3b8] w-24 shrink-0">
                      {regal}
                    </span>
                    <div className="flex-1 h-5 bg-[#f0f2f5] dark:bg-[#3e4042] rounded overflow-hidden">
                      <div
                        className="h-full bg-[#008BD2] rounded"
                        style={{ width: `${Math.max(4, (anzahl / maxImRegal) * 100)}%` }}
                      />
                    </div>
                    <span className="text-sm font-black text-[#1a1a1a] dark:text-[#e4e6eb] w-10 text-right shrink-0">
                      {anzahl}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Die Liste ───────────────────────────────────────────────── */}
          {daten.treffer.length > 0 && (
            <div className="rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] overflow-hidden">
              <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042] text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
                Nach Stellplatz sortiert
              </div>
              <div className="divide-y divide-[#ced4da] dark:divide-[#3e4042]">
                {daten.treffer.map((t) => (
                  <div key={t.logId} className="flex items-center gap-4 px-5 py-3 flex-wrap">
                    <span className="font-mono font-black text-base text-[#0064d2] dark:text-[#45bdff] w-36 shrink-0">
                      {t.stellplatz ?? "—"}
                    </span>
                    <span className="font-mono font-bold text-sm text-[#1a1a1a] dark:text-[#e4e6eb] w-28 shrink-0">
                      Colli {t.colli ?? "—"}
                    </span>
                    <span className="font-mono text-sm text-[#65676b] dark:text-[#b0b3b8] w-32 shrink-0">
                      {t.logId}
                    </span>
                    <span className="text-xs text-[#65676b] dark:text-[#b0b3b8] flex-1 min-w-0 truncate">
                      {[t.lager, t.verbleib].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

"use client";
import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { api } from "@/trpc/react";
import { usePermissions } from "@/hooks/usePermissions";

// ── Gleiches Gerät finden ────────────────────────────────────────────────────
//
// Für den Versand: LogID scannen, sehen ob dasselbe Gerät mit demselben Grading
// noch einmal im Kommissionierlager liegt — und an welchem Stellplatz, in
// welchem Colli.
//
// ⚠️ Die Liste ist nach Stellplatz sortiert, nicht nach LogID. Wer die Geräte
// holt, läuft die Regale der Reihe nach ab; nach LogID sortiert liefe er kreuz
// und quer durchs Lager.
//
// Eigener Datenbestand mit eigenem CSV-Import — bewusst getrennt vom
// Lagerfuchs, damit ein Import hier dort nichts auslöst.

const CHUNK = 2000;

/** „KOM-11-19-3" → „KOM-11". Für die Verteilung auf die Regale. */
function regalVon(stellplatz: string | null): string {
  if (!stellplatz) return "ohne Stellplatz";
  const m = /^([A-Za-z]+)-(\d+)/.exec(stellplatz.trim());
  return m ? `${m[1]}-${m[2]}` : stellplatz.trim();
}

type CsvZeile = Record<string, string>;

export default function GleicheGeraetePage() {
  const { has } = usePermissions();
  const darfImportieren = has("GLEICHE_GERAETE_IMPORT");

  const [eingabe, setEingabe] = useState("");
  const [gesucht, setGesucht] = useState<string | null>(null);
  const [importLaeuft, setImportLaeuft] = useState(false);
  const [fortschritt, setFortschritt] = useState<string | null>(null);
  const dateiRef = useRef<HTMLInputElement>(null);

  const status  = api.gleicheGeraete.status.useQuery();
  const abfrage = api.gleicheGeraete.suche.useQuery(
    { logId: gesucht ?? "" },
    { enabled: !!gesucht },
  );
  const importStueck = api.gleicheGeraete.importStueck.useMutation();

  const daten = abfrage.data;

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

  // ── CSV einlesen und in Paketen hochladen ─────────────────────────────────
  async function importiere(datei: File) {
    setImportLaeuft(true);
    setFortschritt("Datei wird gelesen…");
    try {
      const zeilen = await new Promise<CsvZeile[]>((fertig, fehler) => {
        Papa.parse<CsvZeile>(datei, {
          header: true, delimiter: ";", skipEmptyLines: true,
          complete: (r) => fertig(r.data),
          error:    (e) => fehler(e),
        });
      });

      const nutzbar = zeilen
        .map((z) => ({
          logId:       (z["LogId"] ?? z["LogID"] ?? "").trim(),
          hersteller:  (z["Hersteller"] ?? "").trim(),
          bezeichnung: (z["Bezeichnung"] ?? "").trim().slice(0, 255),
          geraeteart:  (z["Geräteart"] ?? "").trim(),
          grading:     (z["Grading"] ?? "").trim(),
          stellplatz:  (z["Stellplatz"] ?? "").trim(),
          colli:       (z["Colli"] ?? "").trim(),
          lager:       (z["Lager"] ?? "").trim(),
          verbleib:    (z["Verbleib"] ?? "").trim(),
        }))
        .filter((z) => z.logId.length > 0);

      if (nutzbar.length === 0) {
        setFortschritt("Keine Zeile mit LogID gefunden. Ist das der richtige Export?");
        return;
      }

      const stand = new Date().toISOString();
      let geschrieben = 0;
      for (let i = 0; i < nutzbar.length; i += CHUNK) {
        const teil = nutzbar.slice(i, i + CHUNK);
        const r = await importStueck.mutateAsync({
          zeilen: teil, ersteLieferung: i === 0, importiertAm: stand,
        });
        geschrieben += r.geschrieben;
        setFortschritt(`${Math.min(i + CHUNK, nutzbar.length)} von ${nutzbar.length} Zeilen…`);
      }

      setFortschritt(`Fertig. ${geschrieben} Geräte übernommen.`);
      await status.refetch();
      if (gesucht) await abfrage.refetch();
    } catch (e) {
      setFortschritt(`Fehlgeschlagen: ${(e as Error).message}`);
    } finally {
      setImportLaeuft(false);
      if (dateiRef.current) dateiRef.current.value = "";
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Gleiches Gerät finden</h1>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
          LogID scannen. Zeigt Geräte mit derselben Bezeichnung und demselben Grading,
          die im Kommissionierlager stehen, mit Stellplatz und Colli.
        </p>
      </div>

      {/* ── Stand der Daten ──────────────────────────────────────────────── */}
      <div className="rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#3e4042]/40 px-4 py-3 text-sm flex items-center justify-between gap-3 flex-wrap">
        <span className="text-[#65676b] dark:text-[#b0b3b8]">
          {status.data
            ? status.data.anzahl === 0
              ? "Noch keine Daten importiert."
              : <>Bestand: <b>{status.data.anzahl.toLocaleString("de-DE")}</b> Geräte
                  {status.data.importiertAm && <> · Stand {new Date(status.data.importiertAm).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</>}</>
            : "…"}
        </span>
      </div>

      {/* ── Scan-Feld ────────────────────────────────────────────────────── */}
      <form onSubmit={suchen} className="flex gap-2 flex-wrap">
        <input
          autoFocus
          value={eingabe}
          onChange={(e) => setEingabe(e.target.value)}
          placeholder="LogID scannen oder eintippen…"
          className="flex-1 min-w-[220px] px-4 py-3 rounded-lg border-2 border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-[#1a1a1a] dark:text-[#e4e6eb] font-mono text-base min-h-[56px] focus:border-[#0064d2] outline-none"
        />
        <button type="submit" className="px-6 py-3 rounded-lg bg-[#0064d2] text-white font-bold text-base min-h-[56px]">
          Suchen
        </button>
        {gesucht && (
          <button type="button" onClick={() => { setGesucht(null); setEingabe(""); }}
            className="px-4 py-3 rounded-lg border-2 border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-bold text-base min-h-[56px]">
            Zurücksetzen
          </button>
        )}
      </form>
      <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] -mt-3">
        Mit oder ohne Punkte: <span className="font-mono">212965142</span> und{" "}
        <span className="font-mono">212.965.142</span> finden dasselbe Gerät.
      </p>

      {abfrage.isFetching && (
        <p className="text-sm font-bold text-[#0064d2] dark:text-[#45bdff]">Wird gesucht…</p>
      )}

      {daten?.kind === "none" && (
        <div className="rounded-xl border-2 border-[#f7b928] bg-[#f7b928]/8 p-5">
          <div className="font-bold text-[#8A5A00] dark:text-[#f7b928]">
            Zu <span className="font-mono">{daten.gesucht}</span> steht nichts im Bestand.
          </div>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
            Entweder ein Tippfehler, oder das Gerät kam erst nach dem letzten Import ins Haus.
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
          </div>

          {daten.gesamt === 0 ? (
            <div className="rounded-xl border-2 border-[#8A5A00] bg-[#8A5A00]/8 p-5">
              <div className="text-lg font-black text-[#8A5A00] dark:text-[#f7b928]">
                Kein zweites Gerät dieser Art mit Grading {daten.stand.grading}
              </div>
              {daten.andereGradings.length > 0 && (
                <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1.5">
                  Dasselbe Gerät gibt es aber mit anderem Grading. Siehe unten.
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-xl border-2 border-[#038F5C] bg-[#04B475]/8 p-5">
              <div className="text-lg font-black text-[#038F5C] dark:text-[#04B475]">
                {daten.gesamt === 1 ? "1 gleiches Gerät im Lager" : `${daten.gesamt} gleiche Geräte im Lager`}
              </div>
              <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
                Gleiche Bezeichnung, gleiches Grading {daten.stand.grading}, im Kommissionierlager.
              </p>
              {daten.gekuerzt && (
                <p className="text-sm font-bold text-[#8A5A00] dark:text-[#f7b928] mt-1.5">
                  Angezeigt werden die ersten {daten.treffer.length} nach Stellplatz.
                </p>
              )}
            </div>
          )}

          {regale.length > 1 && (
            <div className="rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] p-5">
              <div className="text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-3">
                Verteilung auf die Regale
              </div>
              <div className="space-y-1.5">
                {regale.map(([regal, anzahl]) => (
                  <div key={regal} className="flex items-center gap-3">
                    <span className="font-mono text-sm font-bold text-[#65676b] dark:text-[#b0b3b8] w-24 shrink-0">{regal}</span>
                    <div className="flex-1 h-5 bg-[#f0f2f5] dark:bg-[#3e4042] rounded overflow-hidden">
                      <div className="h-full bg-[#008BD2] rounded" style={{ width: `${Math.max(4, (anzahl / maxImRegal) * 100)}%` }} />
                    </div>
                    <span className="text-sm font-black text-[#1a1a1a] dark:text-[#e4e6eb] w-10 text-right shrink-0">{anzahl}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

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
                    <span className="font-mono text-sm text-[#65676b] dark:text-[#b0b3b8] w-32 shrink-0">{t.logId}</span>
                    <span className="text-xs text-[#65676b] dark:text-[#b0b3b8] flex-1 min-w-0 truncate">
                      {[t.lager, t.verbleib].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* ── Andere Gradings ───────────────────────────────
              ⚠️ Bewusst NICHT unter die Treffer gemischt. Ein Gerät mit
              Grading C ist kein Ersatz für eines mit B — wer es trotzdem
              nimmt, soll das sehen und entscheiden, nicht übersehen. */}
          {daten.andereGradings.length > 0 && (
            <div className="rounded-xl border-2 border-[#8A5A00]/40 bg-[#f7b928]/8 overflow-hidden">
              <div className="px-5 py-3 border-b border-[#8A5A00]/25">
                <div className="text-base font-black text-[#8A5A00] dark:text-[#f7b928]">
                  Dasselbe Gerät mit anderem Grading
                </div>
                <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
                  Kein Ersatz für Grading {daten.stand.grading}, nur zur Kenntnis.
                </p>
              </div>
              {daten.andereGradings.map((g) => (
                <div key={g.grading}>
                  <div className="px-5 py-2 bg-[#f7b928]/15 text-sm font-black text-[#8A5A00] dark:text-[#f7b928]">
                    Grading {g.grading} · {g.anzahl} {g.anzahl === 1 ? "Gerät" : "Geräte"}
                    {g.treffer.length < g.anzahl && ` (erste ${g.treffer.length} angezeigt)`}
                  </div>
                  <div className="divide-y divide-[#8A5A00]/15">
                    {g.treffer.map((t) => (
                      <div key={t.logId} className="flex items-center gap-4 px-5 py-2.5 flex-wrap">
                        <span className="font-mono font-black text-base text-[#8A5A00] dark:text-[#f7b928] w-36 shrink-0">
                          {t.stellplatz ?? "—"}
                        </span>
                        <span className="font-mono font-bold text-sm text-[#1a1a1a] dark:text-[#e4e6eb] w-28 shrink-0">
                          Colli {t.colli ?? "—"}
                        </span>
                        <span className="font-mono text-sm text-[#65676b] dark:text-[#b0b3b8] w-32 shrink-0">{t.logId}</span>
                        <span className="text-xs text-[#65676b] dark:text-[#b0b3b8] flex-1 min-w-0 truncate">
                          {[t.lager, t.verbleib].filter(Boolean).join(" · ")}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Import ───────────────────────────────────────────────────────── */}
      {darfImportieren && (
        <div className="rounded-xl border border-[#008BD2]/40 bg-[#008BD2]/5 p-5 space-y-3">
          <div>
            <div className="text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Daten aktualisieren</div>
            <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
              ReForm-Export als CSV. <b>Jeder Import ersetzt den kompletten Bestand</b>:
              Die Datei ist der neue Stand. Der Lagerfuchs bleibt davon unberührt.
            </p>
          </div>
          <label className={`inline-flex items-center px-5 py-3 rounded-lg font-bold text-base min-h-[56px] cursor-pointer ${importLaeuft ? "bg-[#ced4da] text-[#65676b]" : "bg-[#008BD2] text-white"}`}>
            {importLaeuft ? "Import läuft…" : "CSV auswählen"}
            <input
              ref={dateiRef}
              type="file"
              accept=".csv,text/csv"
              disabled={importLaeuft}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void importiere(f); }}
              className="sr-only"
            />
          </label>
          {fortschritt && (
            <p className="text-sm font-semibold text-[#0064d2] dark:text-[#45bdff]">{fortschritt}</p>
          )}
        </div>
      )}
    </div>
  );
}

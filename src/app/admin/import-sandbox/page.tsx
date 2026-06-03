"use client";
import { useState } from "react";
import { useDebounce } from "use-debounce";
import type { inferRouterOutputs } from "@trpc/server";
import { api } from "@/trpc/react";
import type { AppRouter } from "@/server/routers";
import { kernTokens } from "@/lib/geraete/vergleichsKern";

/**
 * Import-Sandbox — read-only Demo, wie der Geräte-Import aus rohen Werten saubere
 * Werte erzeugt. Reine Berechnung über die echten Import-Funktionen (tRPC-Query
 * importSandbox.vorschau). Kein DB-Zugriff, keine Schreibwirkung.
 */

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Vorschau      = RouterOutputs["importSandbox"]["vorschau"];

const REGEL_LABEL: Record<string, string> = {
  leer:      "Leerer Hersteller",
  apple:     "Apple-Indikator in der Bezeichnung erkannt",
  typo:      "Tippfehler-Korrektur",
  blocklist: "Blockliste — nicht im AfB-Portfolio",
  whitelist: "Whitelist-Treffer",
  unbekannt: "Unbekannter Hersteller — nicht in der Whitelist",
};

type Beispiel = { hersteller: string; bezeichnung: string; hinweis: string };
const BEISPIELE: Beispiel[] = [
  { hersteller: "HPö",    bezeichnung: 'Notebook Pc HP EliteBook 840 G5 - 14"-FullHD', hinweis: "Tippfehler-Fix + Reinigung" },
  { hersteller: "Dell",   bezeichnung: "Dell MacBook Pro 14",                            hinweis: "Apple-Indikator → abgelehnt" },
  { hersteller: "fsc",    bezeichnung: "Lifebook E5511",                                 hinweis: "Fujitsu-Tippfehler" },
  { hersteller: "Lenovo", bezeichnung: "ThinkPad T14 Gen 2i 20W1S06V00",                hinweis: "interner Code entfernt" },
  { hersteller: "HPE",    bezeichnung: "ProLiant DL360",                                 hinweis: "Blocklist (Server) → abgelehnt" },
];

const PRESET = BEISPIELE[0];

export default function ImportSandboxPage() {
  const [hersteller, setHersteller]   = useState(PRESET.hersteller);
  const [bezeichnung, setBezeichnung] = useState(PRESET.bezeichnung);

  const [debHersteller]  = useDebounce(hersteller, 300);
  const [debBezeichnung] = useDebounce(bezeichnung, 300);

  const q = api.importSandbox.vorschau.useQuery(
    { hersteller: debHersteller, bezeichnung: debBezeichnung },
    { staleTime: 60_000 },
  );

  function setzeBeispiel(b: Beispiel) {
    setHersteller(b.hersteller);
    setBezeichnung(b.bezeichnung);
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* ── Kopf ── */}
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex items-center justify-center w-11 h-11 rounded-xl text-white text-xl flex-shrink-0"
          style={{ background: "#202F61" }}
        >
          🧪
        </span>
        <div>
          <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Import-Sandbox</h1>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
            Zeigt Schritt für Schritt, wie der Import aus rohen Werten saubere Werte macht. Nur Anschauung — es wird nichts gespeichert.
          </p>
        </div>
      </div>

      {/* ── Eingabe ── */}
      <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-5 sm:p-6 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="sb-hersteller" className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1.5 uppercase tracking-wider">
              Hersteller (roh)
            </label>
            <input
              id="sb-hersteller"
              type="text"
              value={hersteller}
              onChange={(e) => setHersteller(e.target.value)}
              className="w-full min-h-[56px] px-4 rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] text-base font-mono outline-none focus:border-[#008BD2] focus:ring-2 focus:ring-[#008BD2]/40 transition-colors"
              placeholder="z.B. HPö"
            />
          </div>
          <div>
            <label htmlFor="sb-bezeichnung" className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1.5 uppercase tracking-wider">
              Bezeichnung (roh)
            </label>
            <input
              id="sb-bezeichnung"
              type="text"
              value={bezeichnung}
              onChange={(e) => setBezeichnung(e.target.value)}
              className="w-full min-h-[56px] px-4 rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] text-base font-mono outline-none focus:border-[#008BD2] focus:ring-2 focus:ring-[#008BD2]/40 transition-colors"
              placeholder='z.B. Notebook Pc HP EliteBook 840 G5 - 14"-FullHD'
            />
          </div>
        </div>

        {/* Beispiel-Buttons */}
        <div>
          <p className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-2 uppercase tracking-wider">Beispiele</p>
          <div className="flex flex-wrap gap-2">
            {BEISPIELE.map((b, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setzeBeispiel(b)}
                className="inline-flex flex-col items-start gap-0.5 min-h-[56px] px-3 py-2 rounded-lg border border-[#008BD2]/40 bg-[#008BD2]/[0.06] hover:bg-[#008BD2]/15 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-[#008BD2]"
              >
                <span className="font-mono text-sm font-bold text-[#202F61] dark:text-[#008BD2]">{b.hersteller}</span>
                <span className="text-[11px] text-[#65676b] dark:text-[#b0b3b8]">{b.hinweis}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Auswertung ── */}
      {q.isError ? (
        <div role="alert" className="bg-white dark:bg-[#242526] rounded-2xl border border-[#fa3e3e]/30 shadow-sm p-6">
          <p className="text-sm text-[#b91c1c] dark:text-[#fca5a5] font-semibold">
            Auswertung fehlgeschlagen: {q.error.message}
          </p>
        </div>
      ) : q.data ? (
        <Auswertung data={q.data} rohHersteller={debHersteller} />
      ) : (
        <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-10 flex flex-col items-center gap-3 text-[#65676b] dark:text-[#b0b3b8]">
          <span aria-hidden className="text-3xl animate-pulse">⏳</span>
          <p className="text-sm font-semibold">Wird ausgewertet…</p>
        </div>
      )}
    </div>
  );
}

function Auswertung({ data, rohHersteller }: { data: Vorschau; rohHersteller: string }) {
  const { hersteller, bereinigung, endergebnis } = data;
  const erlaubt = hersteller.erlaubt;

  return (
    <div className="space-y-5">
      {/* ── Tor A: Hersteller-Prüfung ── */}
      <section
        className={`rounded-2xl border-2 shadow-sm overflow-hidden ${
          erlaubt ? "border-[#04B475]/50" : "border-[#fa3e3e]/50"
        }`}
      >
        <div className={`px-5 py-3 flex items-center gap-2 ${erlaubt ? "bg-[#04B475]/[0.08]" : "bg-[#fa3e3e]/[0.08]"}`}>
          <span aria-hidden>{erlaubt ? "✅" : "⛔"}</span>
          <h2 className="font-black text-base text-[#1a1a1a] dark:text-[#e4e6eb]">Tor A — Hersteller-Prüfung</h2>
        </div>
        <div className="bg-white dark:bg-[#242526] px-5 py-4 space-y-2">
          {erlaubt ? (
            <>
              <p className="flex items-center gap-2 flex-wrap text-sm">
                <span className="font-mono px-2 py-1 rounded bg-[#f0f2f5] dark:bg-[#18191a] text-[#65676b] dark:text-[#b0b3b8] break-all">
                  {rohHersteller || "∅"}
                </span>
                <span aria-hidden className="text-[#04B475] font-bold">→</span>
                <span className="font-mono px-2 py-1 rounded font-bold text-white" style={{ background: "#04B475" }}>
                  {hersteller.kanonisch}
                </span>
              </p>
              <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
                Regel: <span className="font-semibold text-[#202F61] dark:text-[#008BD2]">{REGEL_LABEL[hersteller.regel] ?? hersteller.regel}</span>
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-bold text-[#b91c1c] dark:text-[#fca5a5]">Hersteller abgelehnt</p>
              {hersteller.grund && (
                <p className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">{hersteller.grund}</p>
              )}
              <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
                Regel: <span className="font-semibold text-[#b91c1c] dark:text-[#fca5a5]">{REGEL_LABEL[hersteller.regel] ?? hersteller.regel}</span>
              </p>
            </>
          )}
        </div>
      </section>

      {/* ── Tor B: Bezeichnung-Bereinigung (nur wenn erlaubt) ── */}
      {erlaubt && bereinigung && (
        <section className="rounded-2xl border-2 border-[#008BD2]/40 shadow-sm overflow-hidden">
          <div className="px-5 py-3 flex items-center gap-2 bg-[#008BD2]/[0.08]">
            <span aria-hidden>🧹</span>
            <h2 className="font-black text-base text-[#1a1a1a] dark:text-[#e4e6eb]">Tor B — Bezeichnung-Bereinigung</h2>
          </div>
          <div className="bg-white dark:bg-[#242526] px-5 py-4">
            <ol className="space-y-2 list-none m-0 p-0">
              {bereinigung.schritte.map((s) => (
                <li
                  key={s.nummer}
                  className={`rounded-xl border px-4 py-3 ${
                    s.veraendert
                      ? "border-[#008BD2]/40 bg-[#008BD2]/[0.06]"
                      : "border-[#ced4da]/60 dark:border-[#3e4042]/60 bg-[#f0f2f5]/40 dark:bg-[#18191a]/40 opacity-80"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden
                      className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-black flex-shrink-0 ${
                        s.veraendert ? "text-white" : "text-[#65676b] dark:text-[#b0b3b8] bg-[#ced4da]/50 dark:bg-[#3e4042]/60"
                      }`}
                      style={s.veraendert ? { background: "#008BD2" } : undefined}
                    >
                      {s.nummer}
                    </span>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">{s.name}</span>
                        {s.veraendert ? (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: "#008BD2" }}>
                            geändert
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-[#65676b] dark:text-[#b0b3b8] bg-[#ced4da]/40 dark:bg-[#3e4042]/60">
                            keine Änderung
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#65676b] dark:text-[#b0b3b8]">{s.beschreibung}</p>
                      {s.veraendert && (
                        <div className="flex items-center gap-2 flex-wrap text-sm font-mono mt-1.5">
                          <span className="px-2 py-0.5 rounded bg-[#f0f2f5] dark:bg-[#18191a] text-[#65676b] dark:text-[#b0b3b8] line-through decoration-[#fa3e3e]/60 break-all">
                            {s.vorher || "∅"}
                          </span>
                          <span aria-hidden className="text-[#008BD2] font-bold">→</span>
                          <span className="px-2 py-0.5 rounded bg-[#008BD2]/10 text-[#008BD2] font-semibold break-all">
                            {s.nachher || "∅"}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>

            {bereinigung.sicherheitsnetzGegriffen && (
              <p className="mt-4 flex items-start gap-2 px-4 py-3 rounded-xl bg-[#f7b928]/10 border border-[#f7b928]/30 text-sm text-[#9a7b0a] dark:text-[#f7b928]">
                <span aria-hidden>🛟</span>
                <span>
                  <span className="font-bold">Sicherheitsnetz:</span> Das Ergebnis wäre zu kurz geworden (leer oder
                  unter 3 Zeichen). Deshalb wird die ursprüngliche Bezeichnung beibehalten, damit nichts verloren geht.
                </span>
              </p>
            )}
          </div>
        </section>
      )}

      {/* ── Endergebnis ── */}
      {erlaubt && endergebnis ? (
        <section className="rounded-2xl border-2 border-[#202F61] bg-[#202F61]/[0.04] dark:bg-[#202F61]/[0.12] shadow-sm p-5 sm:p-6">
          <p className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-2 uppercase tracking-wider">Endergebnis — so würde es gespeichert</p>
          <div className="flex items-center gap-2 flex-wrap">
            <span aria-hidden className="text-2xl">💾</span>
            <span className="inline-flex items-center px-4 py-2 rounded-xl font-mono font-black text-lg text-white break-all" style={{ background: "#04B475" }}>
              {endergebnis}
            </span>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border-2 border-[#fa3e3e]/50 bg-[#fa3e3e]/[0.05] shadow-sm p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span aria-hidden className="text-2xl">🚫</span>
            <div>
              <p className="font-black text-[#b91c1c] dark:text-[#fca5a5]">Dieses Gerät würde NICHT importiert</p>
              {hersteller.grund && (
                <p className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb] mt-1">{hersteller.grund}</p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Tor C: Modell-Abgleich (Katalog) ── */}
      {erlaubt && data.katalog && <TorC katalog={data.katalog} />}

      {/* ── Abschluss-Hinweis ── */}
      <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] leading-relaxed px-1 max-w-[68ch]">
        <span aria-hidden>ℹ️ </span>
        Danach prüft das System, ob es dieses Modell schon gibt (case-insensitive, mit und ohne
        Hersteller-Präfix) — Duplikate werden nie angelegt.
      </p>
    </div>
  );
}

type Katalog = NonNullable<Vorschau["katalog"]>;

function TorC({ katalog }: { katalog: Katalog }) {
  const { inputKern, kandidaten } = katalog;
  const anzahl = kandidaten.length;

  return (
    <section className="rounded-2xl border-2 border-[#008BD2]/40 shadow-sm overflow-hidden">
      <div className="px-5 py-3 flex items-center gap-2 bg-[#008BD2]/[0.08] flex-wrap">
        <span aria-hidden>🔎</span>
        <h2 className="font-black text-base text-[#1a1a1a] dark:text-[#e4e6eb] flex-1">Tor C — Modell-Abgleich (Katalog)</h2>
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#f7b928]/15 text-[#9a7b0a] dark:text-[#f7b928] border border-[#f7b928]/30">
          Vorschau — der echte Import bleibt unberührt
        </span>
      </div>

      <div className="bg-white dark:bg-[#242526] px-5 py-4 space-y-4">
        {/* Vergleichs-Kern */}
        <div>
          <p className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase tracking-wider">
            Vergleichs-Kern (das wird verglichen)
          </p>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mb-1.5">
            Specs, Größen und Codes werden für den Vergleich entfernt — übrig bleibt der Modell-Kern:
          </p>
          <span className="inline-block font-mono text-sm px-3 py-1.5 rounded-lg bg-[#f0f2f5] dark:bg-[#18191a] text-[#202F61] dark:text-[#e4e6eb] break-all">
            {inputKern || "∅"}
          </span>
        </div>

        {/* Zustand + Kandidaten */}
        {anzahl === 0 ? (
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-[#f7b928]/10 border border-[#f7b928]/30">
            <span aria-hidden className="text-xl">🆕</span>
            <p className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
              <span className="font-bold">Kein Katalog-Treffer.</span> Dieses Modell würde als
              NEU vorgeschlagen — der Admin bestätigt das Anlegen.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] flex items-center gap-2">
              {anzahl === 1 ? (
                <>
                  <span aria-hidden>✅</span>
                  <span className="text-[#04B475]">Erkanntes Modell:</span>
                  <span className="font-mono">{kandidaten[0].modell}</span>
                </>
              ) : (
                <>
                  <span aria-hidden>🔢</span>
                  <span>Kandidaten — der Admin würde bestätigen</span>
                </>
              )}
            </p>

            <ul className="space-y-2">
              {kandidaten.map((k) => {
                const treffer = new Set(k.trefferTokens);
                const tokens = kernTokens(k.modell);
                return (
                  <li
                    key={k.id}
                    className={`rounded-xl border px-4 py-3 ${
                      anzahl === 1
                        ? "border-[#04B475]/50 bg-[#04B475]/[0.06]"
                        : "border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5]/40 dark:bg-[#18191a]/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap mb-1.5">
                      <span className="font-mono font-bold text-sm text-[#202F61] dark:text-[#e4e6eb] break-all">{k.modell}</span>
                      <span
                        className="text-xs font-black px-2 py-0.5 rounded-full text-white flex-shrink-0"
                        style={{ background: k.score >= 0.8 ? "#04B475" : "#008BD2" }}
                      >
                        {Math.round(k.score * 100)} %
                      </span>
                    </div>
                    {/* Treffer-Tokens cyan hervorgehoben */}
                    <div className="flex flex-wrap gap-1.5">
                      {tokens.map((t, i) => (
                        <span
                          key={i}
                          className={`font-mono text-[11px] px-1.5 py-0.5 rounded ${
                            treffer.has(t)
                              ? "bg-[#008BD2]/15 text-[#008BD2] font-bold"
                              : "bg-[#ced4da]/30 dark:bg-[#3e4042]/40 text-[#65676b] dark:text-[#b0b3b8]"
                          }`}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

"use client";

import { useRef, useState } from "react";
import { api } from "@/trpc/react";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/components/ui/Toast";
import type { MobilImportBericht } from "@/modules/mobil/import";

const AKZENT = "#008BD2";

export default function MobilPage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfSehen     = has("MOBIL_VIEW");
  const darfVerwalten = has("MOBIL_MANAGE");

  const { show } = useToast();
  const utils = api.useUtils();
  const fileRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText]   = useState<string | null>(null);
  const [trocken, setTrocken]   = useState(true); // Sicherheit: erst Vorschau
  const [bericht, setBericht]   = useState<MobilImportBericht | null>(null);
  const [berichtWarTrocken, setBerichtWarTrocken] = useState(false);

  // Browsing-Auswahl (Hersteller → Modell → Teile).
  const [selHersteller, setSelHersteller] = useState<string | null>(null);
  const [selModellId, setSelModellId]     = useState<number | null>(null);

  const importieren = api.mobil.importieren.useMutation({
    onSuccess: (b, vars) => {
      setBericht(b);
      setBerichtWarTrocken(!!vars.dryRun);
      show(
        vars.dryRun
          ? `🔎 Trockenlauf fertig — ${b.erkannt} erkannt, ${b.review} Review (nichts gespeichert)`
          : `✅ Import fertig — ${b.neu} neu, ${b.aktualisiert} aktualisiert`,
        vars.dryRun ? "info" : "success",
      );
      // Echt-Import → Browsing-Daten frisch ziehen.
      if (!vars.dryRun) {
        void utils.mobil.hersteller.invalidate();
        void utils.mobil.modelle.invalidate();
        void utils.mobil.teileProModell.invalidate();
      }
    },
    onError: (e) => show(e.message, "error"),
  });

  // ── Browsing-Queries (read-only, nur mit MOBIL_VIEW) ──────────────────────────
  const herstellerQ = api.mobil.hersteller.useQuery(undefined, { enabled: darfSehen });
  const modelleQ = api.mobil.modelle.useQuery(
    { hersteller: selHersteller ?? "" },
    { enabled: darfSehen && !!selHersteller },
  );
  const teileQ = api.mobil.teileProModell.useQuery(
    { modellId: selModellId ?? 0 },
    { enabled: darfSehen && selModellId != null },
  );
  const selModellName = modelleQ.data?.find((m) => m.id === selModellId)?.modell ?? "";

  if (permsLoading) {
    return <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Lade Berechtigungen…</div>;
  }
  if (!darfSehen) {
    return (
      <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">
        Kein Zugriff. Bitte das Recht <strong>MOBIL_VIEW</strong> bei der Rolle aktivieren.
      </div>
    );
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) { show("Bitte eine .csv-Datei auswählen.", "error"); return; }
    setFileName(file.name);
    setBericht(null);
    try {
      const text = await file.text();
      if (!text.trim()) { show("Die Datei ist leer.", "warning"); setCsvText(null); return; }
      setCsvText(text);
    } catch {
      show("Datei konnte nicht gelesen werden.", "error");
      setCsvText(null);
    }
  }

  function starten() {
    if (!csvText || importieren.isPending) return;
    setBericht(null);
    importieren.mutate({ csvText, dateiname: fileName ?? undefined, dryRun: trocken });
  }

  const laeuft = importieren.isPending;
  const kannStarten = !!csvText && !laeuft;

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-3xl font-black text-[#202F61] dark:text-[#e4e6eb]">📱 Mobil-Ersatzteile</h1>
        <p className="mt-2 text-base text-[#65676b] dark:text-[#b0b3b8]">
          Smartphone- und Tablet-Teile mit LogID. Eigener Bereich, getrennt vom Laptop-Lager.
        </p>
      </header>

      {/* ── Karte: CSV importieren (nur MOBIL_MANAGE) ─────────────────────────── */}
      {darfVerwalten ? (
        <section
          aria-labelledby="import-titel"
          className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-6 space-y-5"
        >
          <div>
            <h2 id="import-titel" className="text-xl font-bold text-[#202F61] dark:text-[#e4e6eb]">📥 CSV importieren</h2>
            <p className="mt-1.5 text-base text-[#65676b] dark:text-[#b0b3b8]">
              ReForm/AfB-Export hochladen (.csv, Semikolon-getrennt). Aus der Spalte
              „Bezeichnung" werden Hersteller, Modell und Teiltyp automatisch erkannt.
              Sicher erkannte Teile werden gespeichert, alles andere landet zur
              späteren Prüfung („Review").
            </p>
          </div>

          {/* Datei wählen */}
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              className="hidden"
              aria-label="CSV-Datei auswählen"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={laeuft}
              className="w-full flex items-center justify-center gap-2 px-5 rounded-xl border-2 border-dashed text-base font-bold transition-colors min-h-[60px] disabled:opacity-50"
              style={{ borderColor: `${AKZENT}66`, background: `${AKZENT}0d`, color: AKZENT }}
            >
              📄 {fileName ? `Datei: ${fileName} — andere wählen` : "CSV-Datei auswählen"}
            </button>
            <p className="text-sm text-[#90939a] dark:text-[#6b6e73] mt-2">
              Große Dateien (z. B. ~1.600 Zeilen) sind in Ordnung. Der Import kann ein paar Sekunden dauern.
            </p>
          </div>

          {/* Trockenlauf-Häkchen */}
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={trocken}
              onChange={(e) => setTrocken(e.target.checked)}
              disabled={laeuft}
              className="mt-1 w-6 h-6 accent-[#008BD2]"
            />
            <span className="text-base text-[#1a1a1a] dark:text-[#e4e6eb]">
              <strong>Trockenlauf</strong> — nur anzeigen, was passieren würde.
              <span className="block text-sm text-[#65676b] dark:text-[#b0b3b8]">
                Es wird <strong>nichts</strong> gespeichert. Häkchen entfernen, um wirklich zu importieren.
              </span>
            </span>
          </label>

          {/* Start-Button */}
          <div className="flex flex-wrap items-center justify-end gap-3">
            {laeuft && (
              <span role="status" aria-live="polite" className="text-base font-semibold text-[#008BD2] dark:text-[#45bdff]">
                ⏳ Import läuft…
              </span>
            )}
            <button
              type="button"
              onClick={starten}
              disabled={!kannStarten}
              className="inline-flex items-center gap-2 px-7 rounded-xl text-white text-base font-bold disabled:opacity-40 transition-colors shadow-sm min-h-[60px]"
              style={{ background: trocken ? "#6b7280" : AKZENT }}
            >
              {laeuft
                ? "Bitte warten…"
                : trocken
                  ? "🔎 Trockenlauf starten"
                  : "💾 Jetzt importieren"}
            </button>
          </div>
        </section>
      ) : (
        <div className="rounded-2xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] p-6 text-base text-[#65676b] dark:text-[#b0b3b8]">
          Nur Ansicht. Für den Import wird das Recht <strong>MOBIL_MANAGE</strong> benötigt.
        </div>
      )}

      {/* ── Bericht ───────────────────────────────────────────────────────────── */}
      {bericht && (
        <section
          aria-labelledby="bericht-titel"
          className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-6 space-y-4"
        >
          <h2 id="bericht-titel" className="text-xl font-bold text-[#202F61] dark:text-[#e4e6eb]">
            {berichtWarTrocken ? "🔎 Trockenlauf-Bericht (nichts gespeichert)" : "✅ Import-Bericht"}
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Kennzahl label="Zeilen gesamt"   wert={bericht.importiertGesamt} />
            <Kennzahl label="Erkannt"         wert={bericht.erkannt}  ton="gut"
              zusatz={bericht.mehrfachModell > 0 ? `davon ${bericht.mehrfachModell}× Mehrfach-Modell` : undefined} />
            <Kennzahl label="Review (offen)"  wert={bericht.review}   ton={bericht.review > 0 ? "warn" : undefined} />
            <Kennzahl label={berichtWarTrocken ? "Wären neu" : "Neu angelegt"}     wert={bericht.neu} />
            <Kennzahl label={berichtWarTrocken ? "Würden aktualisiert" : "Aktualisiert"} wert={bericht.aktualisiert}
              zusatz={bericht.manuellGeschuetzt > 0 ? `${bericht.manuellGeschuetzt}× manuell geschützt` : undefined} />
            <Kennzahl label="Neue Modelle / Teiltypen" wert={`${bericht.neueModelle} / ${bericht.neueTeiltypen}`} />
          </div>

          {bericht.uebersprungen > 0 && (
            <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
              ⏭️ {bericht.uebersprungen} Zeile(n) ohne LogID übersprungen.
            </p>
          )}

          {berichtWarTrocken && darfVerwalten && (
            <p className="text-base text-[#1a1a1a] dark:text-[#e4e6eb]">
              Sieht gut aus? Häkchen <strong>„Trockenlauf"</strong> entfernen und erneut starten, um zu speichern.
            </p>
          )}
        </section>
      )}

      {/* ── Bestand durchsuchen ────────────────────────────────────────────────── */}
      <section aria-labelledby="browse-titel" className="space-y-6">
        <h2 id="browse-titel" className="text-2xl font-black text-[#202F61] dark:text-[#e4e6eb]">🔎 Bestand durchsuchen</h2>

        {/* Schritt 1: Hersteller */}
        <div className="space-y-2">
          <Schrittkopf nr={1} text="Hersteller wählen" />
          {herstellerQ.isLoading ? (
            <Laden />
          ) : !herstellerQ.data?.length ? (
            <Leer text="Noch keine Teile importiert. Lade oben eine CSV hoch." />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {herstellerQ.data.map((h) => {
                const aktiv = selHersteller === h.hersteller;
                return (
                  <button
                    key={h.hersteller}
                    type="button"
                    aria-pressed={aktiv}
                    onClick={() => { setSelHersteller(h.hersteller); setSelModellId(null); }}
                    className="text-left rounded-2xl border-2 p-4 min-h-[88px] transition-colors"
                    style={{
                      borderColor: aktiv ? AKZENT : "#ced4da66",
                      background:  aktiv ? `${AKZENT}14` : "transparent",
                    }}
                  >
                    <div className="text-xl font-black text-[#202F61] dark:text-[#e4e6eb]">{h.hersteller}</div>
                    <div className="mt-1 text-sm text-[#65676b] dark:text-[#b0b3b8]">
                      {h.modelle} {h.modelle === 1 ? "Modell" : "Modelle"} · <strong>{h.teile}</strong> Teile
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Schritt 2: Modelle */}
        {selHersteller && (
          <div className="space-y-2">
            <Schrittkopf nr={2} text={`Modell wählen — ${selHersteller}`} />
            {modelleQ.isLoading ? (
              <Laden />
            ) : !modelleQ.data?.length ? (
              <Leer text="Keine Modelle mit Teilen." />
            ) : (
              <div className="grid sm:grid-cols-2 gap-2">
                {modelleQ.data.map((m) => {
                  const aktiv = selModellId === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={aktiv}
                      onClick={() => setSelModellId(m.id)}
                      className="flex items-center justify-between gap-3 rounded-xl border-2 px-4 min-h-[56px] transition-colors"
                      style={{
                        borderColor: aktiv ? AKZENT : "#ced4da66",
                        background:  aktiv ? `${AKZENT}14` : "transparent",
                      }}
                    >
                      <span className="text-base font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{m.modell}</span>
                      <span
                        className="flex-shrink-0 rounded-lg px-3 py-1 text-sm font-bold tabular-nums"
                        style={{ background: `${AKZENT}1a`, color: AKZENT }}
                      >
                        {m.stueck} Stück
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Schritt 3: Teile je Teiltyp */}
        {selModellId != null && (
          <div className="space-y-2">
            <Schrittkopf
              nr={3}
              text={`Teile — ${selModellName}${teileQ.data ? ` · ${teileQ.data.gesamt} Stück gesamt` : ""}`}
            />
            {teileQ.isLoading ? (
              <Laden />
            ) : !teileQ.data?.teiltypen.length ? (
              <Leer text="Keine Teile für dieses Modell." />
            ) : (
              <div className="space-y-3">
                {teileQ.data.teiltypen.map((g) => (
                  <div
                    key={g.teiltyp}
                    className="rounded-2xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] p-4 shadow-sm"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-lg font-bold text-[#202F61] dark:text-[#e4e6eb]">{g.teiltyp}</span>
                      <span className="text-lg font-black tabular-nums text-[#202F61] dark:text-[#e4e6eb]">
                        {g.stueck} Stück
                      </span>
                    </div>
                    <ul className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm text-[#65676b] dark:text-[#b0b3b8]">
                      {g.collis.map((c) => (
                        <li key={c.colli} className="flex justify-between gap-2 tabular-nums">
                          <span className="truncate">Colli {c.colli}</span>
                          <span className="flex-shrink-0 font-semibold">{c.anzahl}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

// Schritt-Überschrift mit nummeriertem Marker.
function Schrittkopf({ nr, text }: { nr: number; text: string }) {
  return (
    <h3 className="flex items-center gap-2 text-lg font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
      <span
        className="inline-flex items-center justify-center w-7 h-7 rounded-full text-white text-sm font-black flex-shrink-0"
        style={{ background: AKZENT }}
        aria-hidden
      >
        {nr}
      </span>
      {text}
    </h3>
  );
}

function Laden() {
  return <div role="status" className="text-base text-[#65676b] dark:text-[#b0b3b8] py-3">⏳ Lade…</div>;
}

function Leer({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[#ced4da] dark:border-[#3e4042] p-5 text-base text-[#65676b] dark:text-[#b0b3b8]">
      {text}
    </div>
  );
}

// Eine große, gut lesbare Kennzahl-Kachel (Status über Text + Farbe).
function Kennzahl({
  label, wert, zusatz, ton,
}: {
  label: string;
  wert: number | string;
  zusatz?: string;
  ton?: "gut" | "warn";
}) {
  const farbe =
    ton === "gut"  ? "text-[#2e7d32] dark:text-[#7bc67e]" :
    ton === "warn" ? "text-[#b25e00] dark:text-[#ffb74d]" :
                     "text-[#202F61] dark:text-[#e4e6eb]";
  return (
    <div className="rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f7f8fa] dark:bg-[#18191a] p-4">
      <div className={`text-3xl font-black tabular-nums ${farbe}`}>{wert}</div>
      <div className="mt-1 text-sm font-semibold text-[#65676b] dark:text-[#b0b3b8]">{label}</div>
      {zusatz && <div className="mt-0.5 text-xs text-[#90939a] dark:text-[#6b6e73]">{zusatz}</div>}
    </div>
  );
}

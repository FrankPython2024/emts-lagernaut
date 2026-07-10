"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/trpc/react";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/components/ui/Toast";
import type { MobilImportBericht } from "@/modules/mobil/import";

const AKZENT = "#008BD2";

export default function MobilImportPage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfVerwalten = has("MOBIL_MANAGE");

  const { show } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  // Bereich/Kostenstelle — Default aus dem ?bereich=-Param (vom Reiter mitgegeben).
  // Clientseitig aus window.location gelesen (kein useSearchParams → kein
  // Suspense-Zwang beim Prerender/Build).
  const [bereich, setBereich] = useState<"STANDARD" | "DIGITAL_EDUCATION">("STANDARD");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("bereich") === "DIGITAL_EDUCATION") {
      setBereich("DIGITAL_EDUCATION");
    }
  }, []);

  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText]   = useState<string | null>(null);
  const [trocken, setTrocken]   = useState(true); // Sicherheit: erst Vorschau
  const [vollAbgleich, setVollAbgleich] = useState(false); // Default: nur Hersteller des Imports
  const [bericht, setBericht]   = useState<MobilImportBericht | null>(null);
  const [berichtWarTrocken, setBerichtWarTrocken] = useState(false);

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
    },
    onError: (e) => show(e.message, "error"),
  });

  if (permsLoading) {
    return <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Lade Berechtigungen…</div>;
  }
  if (!darfVerwalten) {
    return (
      <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">
        Kein Zugriff. Für den Import wird das Recht <strong>MOBIL_MANAGE</strong> benötigt.
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
    importieren.mutate({ csvText, dateiname: fileName ?? undefined, dryRun: trocken, vollAbgleich, bereich });
  }

  const laeuft = importieren.isPending;
  const kannStarten = !!csvText && !laeuft;

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <Link href="/admin/mobil" className="text-base text-[#65676b] hover:text-[#008BD2] dark:text-[#b0b3b8]">← Zur Übersicht</Link>
        <h1 className="mt-1 text-3xl font-black text-[#202F61] dark:text-[#e4e6eb]">📥 Mobil-Import</h1>
        <p className="mt-2 text-base text-[#65676b] dark:text-[#b0b3b8]">
          ReForm/AfB-Export hochladen (.csv, Semikolon-getrennt). Aus der Spalte
          „Bezeichnung" werden Hersteller, Modell und Teiltyp automatisch erkannt.
          Sicher erkannte Teile werden gespeichert, alles andere landet zur späteren
          Prüfung („Review").
        </p>
      </header>

      <section
        aria-labelledby="import-titel"
        className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-6 space-y-5"
      >
        <h2 id="import-titel" className="sr-only">CSV importieren</h2>

        {/* Bereich / Kostenstelle — bestimmt den Ziel-Reiter + Abgangs-Scope */}
        <div>
          <div className="text-sm font-semibold text-[#1a1a1a] dark:text-[#e4e6eb] mb-2">Bereich / Kostenstelle</div>
          <div className="flex gap-1 rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-1 w-fit">
            {([["STANDARD", "Standard"], ["DIGITAL_EDUCATION", "digital Education"]] as const).map(([key, label]) => {
              const aktiv = bereich === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={aktiv}
                  disabled={laeuft}
                  onClick={() => setBereich(key)}
                  className={`px-4 min-h-[44px] rounded-lg text-base font-bold transition-colors disabled:opacity-50 ${aktiv ? "text-white" : "text-[#202F61] dark:text-[#e4e6eb] hover:bg-[#f0f2f5] dark:hover:bg-[#3a3b3c]"}`}
                  style={aktiv ? { background: AKZENT } : undefined}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="text-sm text-[#90939a] dark:text-[#6b6e73] mt-2">
            Bestimmt, in welchen Reiter die Teile importiert werden. Die Abgangs-Erkennung wirkt
            <strong> nur innerhalb dieses Bereichs</strong> — ein „digital Education"-Import lässt die
            Standard-Teile unberührt (und umgekehrt).
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

        {/* Voll-Abgleich (Abgangs-Erkennung über alle Hersteller) */}
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={vollAbgleich}
            onChange={(e) => setVollAbgleich(e.target.checked)}
            disabled={laeuft}
            className="mt-1 w-6 h-6 accent-[#b25e00]"
          />
          <span className="text-base text-[#1a1a1a] dark:text-[#e4e6eb]">
            <strong>Kompletter Export</strong> — Abgänge über <strong>alle</strong> Hersteller erkennen.
            <span className="block text-sm text-[#65676b] dark:text-[#b0b3b8]">
              Standardmäßig (Häkchen leer) werden Abgänge <strong>nur für die im Import enthaltenen
              Hersteller</strong> erkannt — ein Apple-Export lässt Samsung/Google/Xiaomi unberührt.
              Nur ankreuzen, wenn die Datei wirklich <strong>alle</strong> Hersteller vollständig
              enthält; sonst werden fehlende Hersteller fälschlich als ausgeschieden markiert.
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
            {laeuft ? "Bitte warten…" : trocken ? "🔎 Trockenlauf starten" : "💾 Jetzt importieren"}
          </button>
        </div>
      </section>

      {/* Bericht */}
      {bericht && (
        <section
          aria-labelledby="bericht-titel"
          className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-6 space-y-4"
        >
          <h2 id="bericht-titel" className="text-xl font-bold text-[#202F61] dark:text-[#e4e6eb]">
            {berichtWarTrocken ? "🔎 Trockenlauf-Bericht (nichts gespeichert)" : "✅ Import-Bericht"}
          </h2>

          {/* Abgangs-Modus + Scope (Hersteller) */}
          <div className="rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f7f8fa] dark:bg-[#18191a] px-4 py-3 text-sm">
            <span className="font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">
              Abgangs-Erkennung: {bericht.modus === "voll"
                ? "Voll-Abgleich (alle Hersteller)"
                : "gescopt (nur Hersteller des Imports)"}
            </span>
            <span className="block mt-0.5 text-[#65676b] dark:text-[#b0b3b8]">
              {bericht.herstellerImport.length > 0
                ? <>Hersteller im Import: <strong>{bericht.herstellerImport.join(", ")}</strong>
                    {bericht.modus === "gescopt" && " — nur deren fehlende Teile werden ausgeschieden."}</>
                : "Kein Hersteller eindeutig erkannt — es werden keine Teile ausgeschieden."}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Kennzahl label="Zeilen gesamt"   wert={bericht.importiertGesamt} />
            <Kennzahl label="Erkannt"         wert={bericht.erkannt}  ton="gut"
              zusatz={bericht.mehrfachModell > 0 ? `davon ${bericht.mehrfachModell}× Mehrfach-Modell` : undefined} />
            <Kennzahl label="Review (offen)"  wert={bericht.review}   ton={bericht.review > 0 ? "warn" : undefined} />
            <Kennzahl label={berichtWarTrocken ? "Wären neu" : "Neu angelegt"}     wert={bericht.neu} />
            <Kennzahl label={berichtWarTrocken ? "Würden aktualisiert" : "Aktualisiert"} wert={bericht.aktualisiert}
              zusatz={bericht.manuellGeschuetzt > 0 ? `${bericht.manuellGeschuetzt}× manuell geschützt` : undefined} />
            <Kennzahl label="Neue Modelle / Teiltypen" wert={`${bericht.neueModelle} / ${bericht.neueTeiltypen}`} />
            <Kennzahl
              label={berichtWarTrocken ? "Würden ausgeschieden" : "Ausgeschieden (Abgang)"}
              wert={bericht.anzahlAusgeschieden}
              ton={bericht.anzahlAusgeschieden > 0 ? "warn" : undefined}
              zusatz={bericht.anzahlWiederEingang > 0 ? `${bericht.anzahlWiederEingang}× Wieder-Eingang` : undefined}
            />
          </div>

          {bericht.warnung && (
            <p className="text-sm font-semibold text-[#b25e00] dark:text-[#ffb74d]">
              ⚠️ {bericht.warnung}
            </p>
          )}

          {bericht.uebersprungen > 0 && (
            <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
              ⏭️ {bericht.uebersprungen} Zeile(n) ohne LogID übersprungen.
            </p>
          )}

          {berichtWarTrocken && (
            <p className="text-base text-[#1a1a1a] dark:text-[#e4e6eb]">
              Sieht gut aus? Häkchen <strong>„Trockenlauf"</strong> entfernen und erneut starten, um zu speichern.
            </p>
          )}

          {/* Nach echtem Import mit offenen Review-Teilen: direkt zum Zuordnen springen. */}
          {!berichtWarTrocken && bericht.review > 0 && (
            <Link
              href={`/admin/mobil/review?bereich=${bereich}`}
              className="inline-flex items-center gap-2 px-5 min-h-[52px] rounded-xl text-base font-bold shadow-sm border border-[#b25e00]/50 bg-[#b25e00]/10 text-[#b25e00] dark:text-[#ffb74d] hover:bg-[#b25e00]/20 transition-colors"
            >
              🔍 {bericht.review} unklare {bericht.review === 1 ? "Teil" : "Teile"} jetzt prüfen und zuordnen →
            </Link>
          )}
        </section>
      )}
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

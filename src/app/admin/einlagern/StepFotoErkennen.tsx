"use client";
import { useState } from "react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { bereiteFotoAuf, type Aufbereitet } from "@/lib/bilder/aufbereiten";

// ── Weg C: Teil fotografieren und bestimmen lassen ───────────────────────────
//
// Für Teile ohne LogID und ohne scannbaren Barcode. Foto rein, Teiltyp und
// aufgedruckte Nummer raus, danach läuft die normale Buchung weiter.
//
// ⚠️ Was hier NICHT passiert: Es wird nichts gebucht und nichts gespeichert.
// Dieser Bildschirm liefert einen Vorschlag, den ein Mensch bestätigt. Erst
// danach geht es in die Erfassung.
//
// Und: Der Weg darf nie eine Sackgasse sein. Erkennt das Programm nichts, ist
// das Netz weg oder antwortet der Dienst nicht, führt ein Knopf direkt in die
// Erfassung von Hand — genauso, als hätte man den Fotoweg nie gewählt.

export type ErkanntesTeil = {
  teiltyp:     string | null;
  hersteller:  string | null;
  teilenummer: string | null;
};

export function StepFotoErkennen({
  onWeiter, onBack,
}: {
  onWeiter: (t: ErkanntesTeil) => void;
  onBack:   () => void;
}) {
  const { show } = useToast();
  const [vorschau,  setVorschau]  = useState<string | null>(null);
  const [aufbereitet, setAufbereitet] = useState<Aufbereitet | null>(null);
  const [laeuft,    setLaeuft]    = useState(false);
  const [gewaehlteNummer, setGewaehlteNummer] = useState<string | null>(null);

  const erkennen = api.teilenummern.erkenneFoto.useMutation({
    onError: (e) => show(e.message, "error"),
  });
  const ergebnis = erkennen.data;

  async function ausDatei(e: React.ChangeEvent<HTMLInputElement>) {
    const datei = e.target.files?.[0];
    if (!datei) return;
    setLaeuft(true);
    erkennen.reset();
    setGewaehlteNummer(null);
    try {
      setVorschau(URL.createObjectURL(datei));
      // Zuschnitt läuft im Browser: Das volle Foto wäre mehrere Megabyte und
      // die Nummer darin trotzdem unlesbar.
      const a = await bereiteFotoAuf(datei);
      setAufbereitet(a);
      erkennen.mutate({ uebersicht: a.uebersicht, ausschnitte: a.ausschnitte });
    } catch (err) {
      show((err as Error).message, "error");
    } finally {
      setLaeuft(false);
    }
  }

  const arbeitet = laeuft || erkennen.isPending;

  const knopf = "px-5 py-3 rounded-xl font-bold min-h-[56px] text-base";

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack}
          className="px-4 py-3 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] min-h-[56px] font-bold">
          ← Zurück
        </button>
        <div>
          <h2 className="text-xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">
            Ersatzteil erkennen lassen
          </h2>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
            Foto vom Teil, den Rest versucht Lagernaut.
          </p>
        </div>
      </div>

      {/* ── Aufnahme ───────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm space-y-4">
        <div className="rounded-lg border border-[#008BD2]/40 bg-[#008BD2]/8 p-4 text-sm text-[#65676b] dark:text-[#b0b3b8]">
          <strong className="text-[#1a1a1a] dark:text-[#e4e6eb]">So wird das Foto gut:</strong>
          <ul className="list-disc ml-5 mt-1.5 space-y-1">
            <li>Teil so hinlegen, dass die <strong>Beschriftung nach oben</strong> zeigt.</li>
            <li>Dunkler, matter Untergrund. Kein Blitz, sonst überstrahlt der Aufkleber.</li>
            <li>Nah ran, das Teil soll das Bild füllen.</li>
          </ul>
        </div>

        <label className={`${knopf} inline-flex items-center bg-[#0064d2] text-white cursor-pointer`}>
          📷 Foto aufnehmen
          <input type="file" accept="image/*" capture="environment"
            onChange={ausDatei} className="sr-only" disabled={arbeitet} />
        </label>

        {arbeitet && (
          <p className="text-sm text-[#0064d2] dark:text-[#45bdff] font-semibold">
            {laeuft ? "Bild wird aufbereitet…" : "Wird erkannt…"}
          </p>
        )}

        {vorschau && (
          <div className="flex gap-3 items-start flex-wrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={vorschau} alt="Aufgenommenes Teil"
              className="w-40 rounded-lg border border-[#ced4da] dark:border-[#3e4042]" />
            {aufbereitet && (
              <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] flex-1 min-w-[180px]">
                {aufbereitet.breite}×{aufbereitet.hoehe} Bildpunkte.
                {aufbereitet.ausschnitte.length > 0
                  ? ` ${aufbereitet.ausschnitte.length} beschriftete Stelle${aufbereitet.ausschnitte.length === 1 ? "" : "n"} gefunden und in voller Auflösung mitgeschickt.`
                  : " Keine auffällig beschriftete Stelle gefunden — es wurde nur das Gesamtbild geschickt."}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Ergebnis ───────────────────────────────────────────────────── */}
      {ergebnis && (
        <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm space-y-4">
          {!ergebnis.ok ? (
            <p className="text-sm text-[#8A5A00] dark:text-[#f7b928]">{ergebnis.grund}</p>
          ) : (
            <>
              {/* Bekannte Nummer schlägt alles: Was ein Mensch schon bestätigt
                  hat, ist verlässlicher als jede frische Erkennung. */}
              {ergebnis.bekannt && (
                <div className="rounded-lg border-2 border-[#04B475] bg-[#04B475]/8 p-4">
                  <div className="font-bold text-[#038F5C] dark:text-[#04B475]">
                    ✓ Diese Nummer kennt Lagernaut schon: {ergebnis.bekannt.nummer}
                  </div>
                  <div className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
                    {[ergebnis.bekannt.hersteller, ergebnis.bekannt.teiltyp].filter(Boolean).join(" · ") || "noch ohne Angaben"}
                    {ergebnis.bekannt.modelle > 0 && ` · passt in ${ergebnis.bekannt.modelle} Modelle`}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Feld titel="Teiltyp" wert={ergebnis.teiltypLabel ?? "nicht erkannt"}
                  stark={!!ergebnis.teiltypLabel} />
                <Feld titel="Hersteller" wert={ergebnis.hersteller ?? "nicht erkannt"}
                  stark={!!ergebnis.hersteller} />
                <Feld titel="Sicherheit" wert={`${ergebnis.sicherheit} %`}
                  stark={ergebnis.sicherheit >= 70} />
              </div>

              {ergebnis.bemerkung && (
                <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] italic">💬 {ergebnis.bemerkung}</p>
              )}

              {ergebnis.sicherheit < 60 && ergebnis.teiltyp && (
                <p className="text-sm text-[#8A5A00] dark:text-[#f7b928]">
                  Die Erkennung ist sich unsicher. Bitte im nächsten Schritt prüfen.
                </p>
              )}

              {/* Nummern zur Auswahl: Auf einem Etikett stehen oft mehrere.
                  Welche die Teilenummer ist, sieht der Mensch besser. */}
              {ergebnis.nummern.length > 0 ? (
                <div>
                  <div className="text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">
                    Gelesene Nummern — welche ist die Teilenummer?
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {ergebnis.nummern.map((n) => (
                      <button key={n}
                        onClick={() => setGewaehlteNummer(gewaehlteNummer === n ? null : n)}
                        className={`px-3 py-2 rounded-lg font-mono text-sm border-2 min-h-[48px] ${
                          gewaehlteNummer === n
                            ? "border-[#0064d2] bg-[#0064d2]/10 text-[#0064d2] dark:text-[#45bdff] font-bold"
                            : "border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8]"
                        }`}>
                        {gewaehlteNummer === n ? "✓ " : ""}{n}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1.5">
                    Meist die kürzere. Keine passt? Einfach keine wählen, im
                    nächsten Schritt lässt sie sich eintippen.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
                  Keine lesbare Nummer gefunden. Das ist kein Problem, es geht auch ohne.
                </p>
              )}
            </>
          )}

          <button
            onClick={() => onWeiter({
              teiltyp:     ergebnis.teiltyp,
              hersteller:  ergebnis.hersteller,
              teilenummer: gewaehlteNummer ?? ergebnis.bekannt?.nummer ?? null,
            })}
            className={`${knopf} w-full bg-[#202F61] text-white`}
          >
            Weiter zur Erfassung →
          </button>
        </div>
      )}

      {/* Nie eine Sackgasse: auch ohne Foto und ohne Erkennung weiterkommen. */}
      <button
        onClick={() => onWeiter({ teiltyp: null, hersteller: null, teilenummer: null })}
        className="text-sm font-semibold text-[#0064d2] dark:text-[#45bdff] underline">
        Überspringen und von Hand erfassen
      </button>
    </div>
  );
}

function Feld({ titel, wert, stark }: { titel: string; wert: string; stark: boolean }) {
  return (
    <div className="rounded-lg border border-[#ced4da] dark:border-[#3e4042] p-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8]">
        {titel}
      </div>
      <div className={`text-lg font-black mt-0.5 ${
        stark ? "text-[#1a1a1a] dark:text-[#e4e6eb]" : "text-[#90939a]"
      }`}>
        {wert}
      </div>
    </div>
  );
}

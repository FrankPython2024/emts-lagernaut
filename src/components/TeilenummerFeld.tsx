"use client";
import { useState, useEffect } from "react";
import { api } from "@/trpc/react";

// ── Eingabefeld für die Teilenummer ──────────────────────────────────────────
//
// Der Handscanner tippt den Code wie eine Tastatur ein und schließt mit Enter
// ab — deshalb reicht ein normales Textfeld, es braucht keine Scanner-Anbindung.
//
// Während des Tippens wird nachgeschlagen und sofort angezeigt, ob die Nummer
// bekannt ist. Das ist der Punkt, an dem die Person an der Werkbank merkt, dass
// sie nichts weiter auswählen muss.
//
// ⚠️ Das Feld ist IMMER optional. Wer nichts scannen kann, lagert wie bisher
// ein. Eine Sackgasse an der Werkbank wäre schlimmer als eine fehlende Nummer.

export type TeilenummerTreffer = {
  nummer:     string;
  hersteller: string | null;
  teiltyp:    string | null;
  modelle:    { modell: string }[];
};

export function TeilenummerFeld({
  wert, onChange, autoFocus, kompakt, onTreffer,
}: {
  wert:      string;
  onChange:  (v: string) => void;
  autoFocus?: boolean;
  kompakt?:  boolean;
  /**
   * Wird gemeldet, sobald eine Nummer erkannt (oder als unbekannt bestätigt)
   * ist. Damit kann das umgebende Formular sich selbst ausfüllen — genau
   * dafür ist die ganze Erkennung da.
   */
  onTreffer?: (t: TeilenummerTreffer | null) => void;
}) {
  // Erst nachschlagen, wenn der Wert kurz stillsteht — sonst eine Abfrage je
  // Tastenanschlag. Der Scanner feuert ohnehin am Stück.
  const [ruhig, setRuhig] = useState(wert);
  useEffect(() => {
    const t = setTimeout(() => setRuhig(wert), 350);
    return () => clearTimeout(t);
  }, [wert]);

  const abfrage = api.teilenummern.nachschlagen.useQuery(
    { nummer: ruhig },
    { enabled: ruhig.trim().length >= 4, staleTime: 30_000 },
  );

  const d       = abfrage.data;
  const treffer = d?.treffer ?? null;
  const zeigt   = ruhig.trim().length >= 4 && !abfrage.isLoading && !!d;

  // Ergebnis nach oben melden, sobald es feststeht. Über die Nummer als
  // Abhängigkeit, damit es genau einmal je erkannter Nummer feuert und nicht
  // bei jedem Neuzeichnen.
  const gemeldet = treffer?.nummer ?? null;
  useEffect(() => {
    if (!zeigt || !onTreffer) return;
    onTreffer(treffer ? {
      nummer:     treffer.nummer,
      hersteller: treffer.hersteller,
      teiltyp:    treffer.teiltyp,
      modelle:    treffer.modelle.map((m) => ({ modell: m.modell })),
    } : null);
    // onTreffer bewusst nicht in den Abhängigkeiten: Eine im Elternteil neu
    // erzeugte Funktion würde sonst eine Endlosschleife auslösen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gemeldet, zeigt]);

  return (
    <div>
      <label className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">
        Teilenummer <span className="font-normal text-[#65676b] dark:text-[#b0b3b8]">(scannen oder tippen, optional)</span>
      </label>
      <input
        type="text"
        value={wert}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder="z. B. DA0X8JTB8D0"
        // Scanner tippen sehr schnell; Autokorrektur und Großschreibhilfe des
        // Handgeräts würden dabei nur stören.
        autoCapitalize="characters" autoCorrect="off" spellCheck={false}
        className={`w-full px-3 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] font-mono ${kompakt ? "py-2 min-h-[44px]" : "py-3 min-h-[56px] text-lg"}`}
      />

      {zeigt && (
        <div className="mt-2 text-sm">
          {!d.plausibel ? (
            <p className="text-[#8A5A00] dark:text-[#f7b928]">
              Das sieht nicht wie eine Teilenummer aus. Wird trotzdem gespeichert,
              du kannst es später auf der Pflegeseite richtigstellen.
            </p>
          ) : treffer ? (
            <div className="rounded-lg border border-[#04B475]/40 bg-[#04B475]/8 p-3 flex gap-3">
              {/* Vergleichsbild aus der ersten Erkennung. Bei Teilen, die sich
                  nur in Nuancen unterscheiden, sagt es mehr als jede
                  Beschreibung. */}
              {treffer.fotoStand && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={`/api/teilenummern/foto?id=${treffer.id}&mini=1&v=${treffer.fotoStand}`}
                  alt={`Vergleichsbild ${treffer.nummer}`}
                  className="w-16 h-16 object-cover rounded-lg border border-[#04B475]/40 shrink-0 bg-white"
                />
              )}
              <div className="min-w-0">
              <div className="font-bold text-[#038F5C] dark:text-[#04B475]">
                ✓ Bekannt: {treffer.nummer}
              </div>
              <div className="text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
                {[treffer.hersteller, treffer.teiltyp].filter(Boolean).join(" · ") || "noch ohne Angaben"}
                {treffer.sichtungen > 1 && ` · schon ${treffer.sichtungen}× erfasst`}
              </div>
              {treffer.istSeriennummer && (
                <div className="text-[#c62828] dark:text-[#ff8a80] font-bold mt-1">
                  Als Seriennummer gekennzeichnet — wird nicht zur Zuordnung genutzt.
                </div>
              )}
              {treffer.modelle.length > 0 && (
                <div className="text-[#1a1a1a] dark:text-[#e4e6eb] mt-1">
                  Passt in {treffer.modelle.length} Modell{treffer.modelle.length === 1 ? "" : "e"}:{" "}
                  <span className="text-[#65676b] dark:text-[#b0b3b8]">
                    {treffer.modelle.slice(0, 4).map((m) => m.modell).join(", ")}
                    {treffer.modelle.length > 4 && ` und ${treffer.modelle.length - 4} weitere`}
                  </span>
                </div>
              )}
              </div>
            </div>
          ) : (
            <p className="text-[#0064d2] dark:text-[#45bdff]">
              Neue Nummer. Wird angelegt und später nachgeschlagen — du kannst
              ganz normal weitermachen.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

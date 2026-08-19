"use client";
import { useState } from "react";

// ── Automatische Suche je Teilenummer ────────────────────────────────────────
//
// Zeigt Vorschläge samt Fundstellen. Der Fund selbst ändert nichts an den
// Daten — übernommen wird nur, was hier angehakt und bestätigt wird.
//
// Hintergrund: Nach außen ist zugesagt, Kompatibilitäten nur zu pflegen, wenn
// sie sicher sind. Ein Treffer in einer Verkaufsanzeige ist das nicht, also
// bleibt der Klick eines Menschen dazwischen.

export type AutoFund = {
  ok:          boolean;
  grund?:      string;
  gesucht:     string[];
  fundstellen: { titel: string; ausriss: string; link: string }[];
  vorschlaege: { modellId: number; name: string; treffer: number; bereits: boolean }[];
  ankerFehlt:  boolean;
};

export function AutoBereich({
  fund, laeuft, onSuchen, onUebernehmen, uebernahmeLaeuft,
}: {
  fund?:            AutoFund;
  laeuft:           boolean;
  onSuchen:         () => void;
  onUebernehmen:    (ids: number[]) => void;
  uebernahmeLaeuft: boolean;
}) {
  const [gewaehlt, setGewaehlt] = useState<Set<number> | null>(null);

  // Beim ersten Anzeigen alles vorauswählen, was noch nicht bekannt ist —
  // der Regelfall ist „passt, übernehmen", nicht „einzeln durchklicken".
  const auswahl = gewaehlt ?? new Set(
    (fund?.vorschlaege ?? []).filter((v) => !v.bereits).map((v) => v.modellId),
  );

  function umschalten(id: number) {
    const n = new Set(auswahl);
    if (n.has(id)) n.delete(id); else n.add(id);
    setGewaehlt(n);
  }

  return (
    <div className="rounded-lg border border-[#008BD2]/40 bg-[#008BD2]/5 p-3 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={onSuchen} disabled={laeuft}
          className="px-4 py-2 rounded-lg bg-[#008BD2] text-white font-bold text-sm disabled:opacity-50 min-h-[44px]">
          {laeuft ? "Sucht…" : "🔎 Automatisch nachschlagen"}
        </button>
        {fund?.gesucht?.length ? (
          <span className="text-xs font-mono text-[#65676b] dark:text-[#b0b3b8]">
            gesucht: {fund.gesucht.join(" · ")}
          </span>
        ) : null}
      </div>

      {fund && !fund.ok && (
        <p className="text-sm text-[#8A5A00] dark:text-[#f7b928]">{fund.grund}</p>
      )}

      {/* Der Prüfstein: Das Spendergerät MUSS in den Fundstellen vorkommen.
          Tut es das nicht, stimmt etwas nicht — dann lieber gar nichts. */}
      {fund?.ankerFehlt && (
        <p className="text-sm text-[#c62828] dark:text-[#ff8a80] font-bold">
          ⚠️ Das Spendergerät, aus dem dieses Teil stammt, kommt in keiner Fundstelle vor.
          Entweder wurde die Nummer falsch gelesen, oder die Funde gehören zu einem
          anderen Teil. Bitte nichts übernehmen, ohne es geprüft zu haben.
        </p>
      )}

      {fund?.ok && fund.vorschlaege.length > 0 && (
        <>
          <ul className="flex flex-wrap gap-1.5">
            {fund.vorschlaege.map((v) => (
              <li key={v.modellId}>
                <button onClick={() => umschalten(v.modellId)}
                  className={`text-xs px-2 py-1 rounded border ${
                    auswahl.has(v.modellId)
                      ? "bg-[#0064d2]/10 border-[#0064d2] text-[#0064d2] dark:text-[#45bdff] font-bold"
                      : "border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8]"
                  }`}>
                  {auswahl.has(v.modellId) ? "✓ " : ""}{v.name}
                  {v.bereits && " (schon drin)"}
                </button>
              </li>
            ))}
          </ul>
          <button
            onClick={() => onUebernehmen(Array.from(auswahl))}
            disabled={auswahl.size === 0 || uebernahmeLaeuft}
            className="px-4 py-2 rounded-lg bg-[#04B475] text-white font-bold text-sm disabled:opacity-50 min-h-[44px]">
            {uebernahmeLaeuft ? "…" : `${auswahl.size} Modelle übernehmen`}
          </button>
        </>
      )}

      {fund?.fundstellen && fund.fundstellen.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-[#0064d2] dark:text-[#45bdff]">
            {fund.fundstellen.length} Fundstellen ansehen
          </summary>
          <ul className="mt-2 space-y-1.5">
            {fund.fundstellen.map((f, i) => (
              <li key={i} className="text-xs">
                <a href={f.link} target="_blank" rel="noopener noreferrer"
                  className="text-[#0064d2] dark:text-[#45bdff] underline">{f.titel}</a>
                <div className="text-[#65676b] dark:text-[#b0b3b8]">{f.ausriss}</div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

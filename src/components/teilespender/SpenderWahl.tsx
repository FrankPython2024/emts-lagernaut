"use client";

import { useState } from "react";
import { api } from "@/trpc/react";
import { normalizeLogId, formatLogId } from "@/lib/pickup/logId";

// ── „Aus welchem Gerät kam das Teil?" ────────────────────────────────────────
//
// Erscheint im Auslager-Dialog für die Positionen, zu denen der Teilespender
// überhaupt Kandidaten gefunden hat. Wer hier ein Gerät antippt, sorgt dafür,
// dass genau dieses Gerät für genau dieses Teil nicht mehr vorgeschlagen wird.
//
// ⚠️ Warum das nötig ist: Gemessen am 10.09.2026 laufen **798 von 849**
// ausgegebenen Teilen als DIREKT-Buchung — also ohne dass das Teil je in den
// Bestand kommt. Nur beim Einlagern wird sonst die Spender-LogID erfasst
// (`Buchung.herkunftLogId`). Ohne diese Auswahl bliebe ein leergeräumtes Gerät
// dauerhaft in der Trefferliste und würde beim nächsten Mal wieder geholt.
//
// ⚠️ Der Vermerk gilt **je Teiltyp**, nicht je Gerät. Ein T490, aus dem das
// Display heraus ist, kommt für eine Tastatur weiterhin in Frage.
//
// ⚠️ Freiwillig. Ein Pflichtfeld würde die Ausgabe blockieren, wenn jemand die
// LogID nicht zur Hand hat — lieber ein fehlender Vermerk als eine blockierte
// Reparatur.

export type SpenderWahlMap = Record<number, string>;

type Props = {
  /** Die Positionen der Auslagerung: Anfrage-Id und Teiltyp. */
  teile: { teilId: number; teiltyp: string }[];
  wahl: SpenderWahlMap;
  onChange: (teilId: number, logId: string | null) => void;
  /** false = Nutzer darf keine Entnahme vermerken → Block bleibt ganz aus. */
  aktiv?: boolean;
};

const knopf =
  "px-2.5 py-1.5 rounded-lg text-xs font-mono border transition-colors min-h-[36px]";

export function SpenderWahl({ teile, wahl, onChange, aktiv = true }: Props) {
  const [freitext, setFreitext] = useState<Record<number, string>>({});

  const ids = teile.map((t) => t.teilId);
  const q = api.teilespender.hinweiseFuerAnfragen.useQuery(
    { anfrageIds: ids },
    { enabled: aktiv && ids.length > 0, staleTime: 30_000, retry: false },
  );
  const hinweise = q.data ?? {};

  // Nur Positionen zeigen, zu denen es überhaupt Kandidaten gibt — sonst stünde
  // die Frage bei jeder Ausgabe im Weg.
  const relevant = aktiv
    ? teile.filter((t) => (hinweise[t.teilId]?.alleKandidaten.length ?? 0) > 0)
    : [];
  if (relevant.length === 0) return null;

  function freitextUebernehmen(teilId: number): void {
    const roh = (freitext[teilId] ?? "").trim();
    const ziffern = normalizeLogId(roh);
    if (!ziffern) return;
    onChange(teilId, formatLogId(ziffern));
    setFreitext((prev) => ({ ...prev, [teilId]: "" }));
  }

  return (
    <div className="p-3 rounded-xl bg-[#f0f2f5] dark:bg-[#18191a] border border-[#ced4da] dark:border-[#3e4042] space-y-3">
      <div className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase tracking-wider">
        🔍 Aus welchem Spendergerät kam das Teil?
      </div>
      <p className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
        Angetippte Geräte werden für dieses Teil nicht mehr vorgeschlagen. Andere Teile desselben
        Geräts bleiben verfügbar. Angabe ist freiwillig.
      </p>

      {relevant.map((t) => {
        const h = hinweise[t.teilId]!;
        const gewaehlt = wahl[t.teilId] ?? null;
        return (
          <div key={t.teilId} className="space-y-1.5">
            <div className="text-sm font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">
              {t.teiltyp}
              <span className="ml-2 text-xs font-normal text-[#65676b] dark:text-[#b0b3b8]">
                {h.alleKandidaten.length} {h.alleKandidaten.length === 1 ? "Gerät" : "Geräte"}{" "}
                gefunden
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {/* ⚠️ `alleKandidaten`, NICHT `vorschau`: Die Vorschau ist bei
                  Knappheit bereits zugeteilt und kann leer sein. Wer ein Gerät
                  geholt hat, das einer älteren Anfrage zugeteilt war, muss das
                  trotzdem vermerken können. */}
              {h.alleKandidaten.map((v) => {
                const aktiv = gewaehlt === v.logId;
                return (
                  <button
                    key={v.logId}
                    type="button"
                    onClick={() => onChange(t.teilId, aktiv ? null : v.logId)}
                    aria-pressed={aktiv}
                    title={`${v.stellplatz ?? "ohne Platz"} · Colli ${v.colli ?? "—"}`}
                    className={
                      knopf +
                      " " +
                      (aktiv
                        ? "bg-[#04b475] text-white border-[#04b475] font-bold"
                        : "bg-white dark:bg-[#242526] text-[#1a1a1a] dark:text-[#e4e6eb] border-[#ced4da] dark:border-[#3e4042]")
                    }
                  >
                    {/* Der Haken trägt die Aussage mit — nicht nur die Farbe. */}
                    {aktiv ? "✓ " : ""}
                    {v.logId}
                    <span className="ml-1.5 font-sans font-normal opacity-70">
                      {v.stellplatz ?? "—"}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Ein Gerät, das nicht in der Liste steht (anderer Weg, Nachzügler
                aus einem älteren Export) — LogID scannen oder tippen. */}
            {gewaehlt && !h.alleKandidaten.some((v) => v.logId === gewaehlt) && (
              <div className="text-xs text-[#04b475] font-semibold">
                ✓ Eigene Eingabe: <span className="font-mono">{gewaehlt}</span>{" "}
                <button
                  type="button"
                  onClick={() => onChange(t.teilId, null)}
                  className="underline text-[#65676b] dark:text-[#b0b3b8] font-normal"
                >
                  entfernen
                </button>
              </div>
            )}
            <div className="flex gap-1.5">
              <input
                value={freitext[t.teilId] ?? ""}
                onChange={(e) => setFreitext((prev) => ({ ...prev, [t.teilId]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    freitextUebernehmen(t.teilId);
                  }
                }}
                placeholder="andere LogID scannen…"
                aria-label={`Andere Spender-LogID für ${t.teiltyp}`}
                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-xs font-mono border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] min-h-[36px]"
              />
              <button
                type="button"
                onClick={() => freitextUebernehmen(t.teilId)}
                disabled={!(freitext[t.teilId] ?? "").trim()}
                className={knopf + " bg-white dark:bg-[#242526] border-[#ced4da] dark:border-[#3e4042] text-[#1a1a1a] dark:text-[#e4e6eb] disabled:opacity-40"}
              >
                übernehmen
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

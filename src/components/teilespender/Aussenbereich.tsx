// Kennzeichnung „steht im Außenbereich des EMTS" (Stellplatz ETL-0-9-0) für die
// Teilespender-Listen. Symbol UND Wort, nicht nur Farbe. Regel: istAussenbereich()
// in src/lib/teilespender/ort.ts.

import { istAussenbereich } from "@/lib/teilespender/ort";

const HINWEIS = "Steht draußen im Außenbereich des EMTS (Stellplatz ETL-0-9-0) — Weg nach draußen einplanen.";

/** Schild unter dem Stellplatz. Rendert nichts, wenn das Gerät drinnen steht. */
export function AussenbereichSchild({ stellplatz }: { stellplatz: string | null | undefined }) {
  if (!istAussenbereich(stellplatz)) return null;
  return (
    <div
      title={HINWEIS}
      className="mt-1 inline-flex items-center gap-1 rounded-lg border-2 border-[#008BD2] bg-[#008BD2]/10 px-2 py-0.5 text-xs font-black text-[#005a8c] dark:text-[#7cc8f0]"
    >
      <span aria-hidden>⛅</span> Außenbereich EMTS
    </div>
  );
}

/** Kurzform für enge Stellen (Knöpfe in der Spenderauswahl). */
export function AussenbereichKurz({ stellplatz }: { stellplatz: string | null | undefined }) {
  if (!istAussenbereich(stellplatz)) return null;
  return (
    <span title={HINWEIS} className="ml-1.5 font-sans text-[11px] font-black text-[#005a8c] dark:text-[#7cc8f0]">
      · ⛅ außen
    </span>
  );
}

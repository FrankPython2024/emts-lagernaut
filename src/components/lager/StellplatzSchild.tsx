"use client";

// Bedeutung besonderer Stellplätze („ETL-0-4-0" → „EMTS-Abholwagen, …") als
// Schild unter dem Stellplatz. Die Liste pflegt man unter /admin/stellplaetze;
// Regeln in src/lib/lager/stellplaetze.ts.
// Ohne Emoji: Der Zebra zeigt manche als weißes Kästchen (CLAUDE.md, Pickup).
// „außerhalb EMTS" ist hervorgehoben — dorthin ist es ein eigener Weg.

import { useCallback } from "react";
import { api } from "@/trpc/react";
import { findeBedeutung, type StellplatzBedeutung } from "@/lib/lager/stellplaetze";

/**
 * Nachschlagen in der gepflegten Liste. Eine gemeinsame Abfrage für alle Schilder
 * einer Seite (React Query legt gleiche Abfragen zusammen), 5 min zwischengespeichert.
 */
export function useStellplatzBedeutung(): (stellplatz: string | null | undefined) => StellplatzBedeutung | null {
  const { data } = api.stellplatzInfo.liste.useQuery(undefined, { staleTime: 5 * 60_000, refetchOnWindowFocus: false });
  return useCallback((s) => findeBedeutung(data, s), [data]);
}

const HERVOR = "border-2 border-[#008BD2] bg-[#008BD2]/10 text-[#005a8c] dark:text-[#7cc8f0] font-black";
const NORMAL = "border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] font-bold";

/** Schild mit der Beschreibung. Rendert nichts bei normalen Regalplätzen. */
export function StellplatzSchild({ stellplatz, className = "" }: { stellplatz: string | null | undefined; className?: string }) {
  const b = useStellplatzBedeutung()(stellplatz);
  if (!b) return null;
  return (
    <div title={b.ausserhalb ? `${b.text} — Weg einplanen` : b.text}
      className={`mt-1 inline-block rounded-lg px-2 py-0.5 text-xs leading-snug ${b.ausserhalb ? HERVOR : NORMAL} ${className}`}>
      {b.ausserhalb ? `Außerhalb EMTS: ${b.text}` : b.text}
    </div>
  );
}

/** Kurzform für enge Stellen (Knöpfe der Spenderauswahl). */
export function StellplatzKurz({ stellplatz }: { stellplatz: string | null | undefined }) {
  const b = useStellplatzBedeutung()(stellplatz);
  if (!b) return null;
  return (
    <span title={b.text} className={`ml-1.5 font-sans text-[11px] ${b.ausserhalb ? "font-black text-[#005a8c] dark:text-[#7cc8f0]" : "font-semibold opacity-80"}`}>
      · {b.kurz}
    </span>
  );
}

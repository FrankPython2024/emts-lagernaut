"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { inferRouterOutputs } from "@trpc/server";
import { api } from "@/trpc/react";
import type { AppRouter } from "@/server/routers";
import { GeraeteReiseTabs } from "../_tabs";
import { useGeraetModal } from "../_geraetModal";

// Geräte-Reise — S5: Drilldown-Liste (Stufe / Stellplatz / ohne Verbleib),
// paginiert. Reine Auswertung, kein Bestandseffekt.

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Zeile = RouterOutputs["geraeteReise"]["geraeteListe"]["zeilen"][number];

const PRO_SEITE = 50;

function nf(n: number): string {
  return n.toLocaleString("de-DE");
}
function fmtDate(d: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function tageFarbe(t: number | null): string {
  if (t == null)     return "#65676b";
  if (t <= 30)       return "#04B475";
  if (t <= 90)       return "#84CC16";
  if (t <= 180)      return "#F59E0B";
  if (t <= 365)      return "#F97316";
  return "#EF4444";
}

const cardCls = "bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm";

export default function GeraeteReiseListePage() {
  return (
    <Suspense fallback={null}>
      <GeraeteListe />
    </Suspense>
  );
}

function GeraeteListe() {
  const router = useRouter();
  const { oeffneGeraet } = useGeraetModal();
  const params = useSearchParams();

  const verbleib     = params?.get("verbleib")   ?? undefined;
  const stellplatz   = params?.get("stellplatz") ?? undefined;
  const stellplatzPrefix = params?.get("stellplatzPrefix") ?? undefined;
  const geraeteart   = params?.get("geraeteart") ?? undefined;
  const hersteller   = params?.get("hersteller") ?? undefined;
  const lager        = params?.get("lager")      ?? undefined;
  const lagernummer  = params?.get("lagernummer") ?? undefined;
  const ohneVerbleib = params?.get("ohneVerbleib") === "1";
  const ausgeschieden = params?.get("ausgeschieden") === "1";
  const alterVonRaw  = params?.get("alterVon");
  const alterBisRaw  = params?.get("alterBis");
  const alterVon     = alterVonRaw != null && alterVonRaw !== "" ? Number(alterVonRaw) : undefined;
  const alterBis     = alterBisRaw != null && alterBisRaw !== "" ? Number(alterBisRaw) : undefined;

  const [seite, setSeite] = useState(1);

  // Filterwechsel (neuer Deep-Link) → zurück auf Seite 1.
  useEffect(() => { setSeite(1); }, [verbleib, stellplatz, stellplatzPrefix, geraeteart, hersteller, lager, lagernummer, ohneVerbleib, ausgeschieden, alterVon, alterBis]);

  const { data, isFetching, error } = api.geraeteReise.geraeteListe.useQuery(
    { verbleib, stellplatz, stellplatzPrefix, geraeteart, hersteller, lager, lagernummer, ohneVerbleib, ausgeschieden, alterVon, alterBis, seite, proSeite: PRO_SEITE },
    { staleTime: 30_000, placeholderData: (prev) => prev },
  );

  // Kopfzeile aus allen gesetzten Filtern zusammenbauen (UND-verknüpft).
  const teile: string[] = [];
  if (ausgeschieden)     teile.push("Ausgeschieden");
  if (lagernummer)       teile.push(`Lager ${lagernummer}`);
  if (geraeteart)        teile.push(geraeteart);
  if (hersteller)        teile.push(hersteller);
  if (lager)             teile.push(lager);
  if (ohneVerbleib)      teile.push("ohne Verbleib");
  else if (verbleib)     teile.push(verbleib);
  if (stellplatz)        teile.push(`Stellplatz ${stellplatz}`);
  if (stellplatzPrefix)  teile.push(`Stellplatz ${stellplatzPrefix}*`);
  if (alterVon != null && alterBis != null) teile.push(`Alter ${nf(alterVon)}–${nf(alterBis)} Tage`);
  else if (alterVon != null)                teile.push(`Alter ab ${nf(alterVon)} Tagen`);
  else if (alterBis != null)                teile.push(`Alter bis ${nf(alterBis)} Tage`);
  const titel = teile.length > 0 ? teile.join(" · ") : "Alle Geräte";

  const gesamt = data?.gesamt ?? 0;
  const von    = gesamt === 0 ? 0 : (seite - 1) * PRO_SEITE + 1;
  const bis    = Math.min(seite * PRO_SEITE, gesamt);
  const maxSeite = Math.max(1, Math.ceil(gesamt / PRO_SEITE));

  function oeffne(logId: string) {
    oeffneGeraet(logId);
  }

  // Export-URL mit den aktuellen Filtern (gesamte Treffermenge, nicht nur Seite).
  function exportUrl(format: "csv" | "xlsx"): string {
    const p = new URLSearchParams({ format });
    if (verbleib)     p.set("verbleib", verbleib);
    if (stellplatz)   p.set("stellplatz", stellplatz);
    if (stellplatzPrefix) p.set("stellplatzPrefix", stellplatzPrefix);
    if (geraeteart)   p.set("geraeteart", geraeteart);
    if (hersteller)   p.set("hersteller", hersteller);
    if (lager)        p.set("lager", lager);
    if (lagernummer)  p.set("lagernummer", lagernummer);
    if (ohneVerbleib) p.set("ohneVerbleib", "1");
    if (ausgeschieden) p.set("ausgeschieden", "1");
    if (alterVon != null) p.set("alterVon", String(alterVon));
    if (alterBis != null) p.set("alterBis", String(alterBis));
    return `/api/geraete-reise/export?${p.toString()}`;
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">🦊 Lagerfuchs</h1>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">Geräte-Liste (Drilldown)</p>
      </div>

      <GeraeteReiseTabs />

      {/* Filter-Kopf */}
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">
          {titel} <span className="text-[#0064d2] dark:text-[#45bdff]">({nf(gesamt)})</span>
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { window.location.href = exportUrl("csv"); }}
            disabled={gesamt === 0}
            className="px-3 py-1.5 text-sm font-bold rounded-lg border border-[#ced4da] dark:border-[#3e4042] hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] disabled:opacity-40 transition-colors"
            title="Gefilterte Liste als CSV exportieren"
          >
            ⬇ CSV
          </button>
          <button
            onClick={() => { window.location.href = exportUrl("xlsx"); }}
            disabled={gesamt === 0}
            className="px-3 py-1.5 text-sm font-bold rounded-lg bg-[#04B475] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
            title="Gefilterte Liste als Excel exportieren"
          >
            ⬇ Excel
          </button>
          <button
            onClick={() => router.push("/admin/geraete-reise/auswertungen")}
            className="text-sm font-bold text-[#65676b] dark:text-[#b0b3b8] hover:text-[#0064d2] dark:hover:text-[#45bdff] transition-colors"
          >
            ← Zurück
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-[#fa3e3e]">Fehler beim Laden der Liste.</p>}

      <div className={`${cardCls} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#f0f2f5] dark:bg-[#18191a] text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8]">
              <tr>
                <th className="px-4 py-2.5 text-left">LogID</th>
                <th className="px-4 py-2.5 text-left">Hersteller / Bezeichnung</th>
                <th className="px-4 py-2.5 text-right">Verweildauer</th>
                <th className="px-4 py-2.5 text-left">Verbleib</th>
                <th className="px-4 py-2.5 text-left">Stellplatz</th>
                <th className="px-4 py-2.5 text-left">in Verbleib seit</th>
                {ausgeschieden && <th className="px-4 py-2.5 text-left">Ausgeschieden am</th>}
              </tr>
            </thead>
            <tbody>
              {data && data.zeilen.length === 0 && (
                <tr>
                  <td colSpan={ausgeschieden ? 7 : 6} className="px-4 py-8 text-center text-[#65676b] dark:text-[#b0b3b8]">
                    Keine Geräte für diesen Filter.
                  </td>
                </tr>
              )}
              {data?.zeilen.map((g: Zeile) => (
                <tr
                  key={g.logId}
                  onClick={() => oeffne(g.logId)}
                  className="border-t border-[#ced4da] dark:border-[#3e4042] cursor-pointer hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] transition-colors"
                >
                  <td className="px-4 py-2.5 font-mono font-bold text-[#0064d2] dark:text-[#45bdff] whitespace-nowrap">{g.logId}</td>
                  <td className="px-4 py-2.5 text-[#1a1a1a] dark:text-[#e4e6eb]">
                    <span className="block truncate max-w-[280px]">{[g.hersteller, g.bezeichnung].filter(Boolean).join(" ") || "—"}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-black whitespace-nowrap" style={{ color: tageFarbe(g.verweildauerTage) }}>
                    {g.verweildauerTage != null ? `${nf(g.verweildauerTage)} T` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-[#65676b] dark:text-[#b0b3b8]">{g.verbleib || "—"}</td>
                  <td className="px-4 py-2.5 text-[#65676b] dark:text-[#b0b3b8]">{g.stellplatz || "—"}</td>
                  <td className="px-4 py-2.5 text-[#65676b] dark:text-[#b0b3b8] whitespace-nowrap">{fmtDate(g.inVerbleibSeit)}</td>
                  {ausgeschieden && (
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {g.ausgeschiedenAm ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-[#ffe0e0] text-[#b3261e] dark:bg-[#3a1414] dark:text-[#ff8a8a]">
                          {fmtDate(g.ausgeschiedenAm)}
                        </span>
                      ) : "—"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-[#ced4da] dark:border-[#3e4042] flex-wrap">
          <span className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
            {isFetching ? "Lädt…" : <>{nf(von)}–{nf(bis)} von {nf(gesamt)}</>}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSeite((s) => Math.max(1, s - 1))}
              disabled={seite <= 1}
              className="px-3 py-1.5 text-sm font-bold rounded-lg border border-[#ced4da] dark:border-[#3e4042] disabled:opacity-40 hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] transition-colors"
            >
              ← Zurück
            </button>
            <span className="text-sm text-[#65676b] dark:text-[#b0b3b8] tabular-nums">
              Seite {nf(seite)} / {nf(maxSeite)}
            </span>
            <button
              onClick={() => setSeite((s) => Math.min(maxSeite, s + 1))}
              disabled={seite >= maxSeite}
              className="px-3 py-1.5 text-sm font-bold rounded-lg border border-[#ced4da] dark:border-[#3e4042] disabled:opacity-40 hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] transition-colors"
            >
              Vor →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

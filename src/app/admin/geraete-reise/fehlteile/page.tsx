"use client";
import { useEffect, useState } from "react";
import { useDebounce } from "use-debounce";
import type { inferRouterOutputs } from "@trpc/server";
import { api } from "@/trpc/react";
import type { AppRouter } from "@/server/routers";
import { GeraeteReiseTabs } from "../_tabs";
import { useGeraetModal } from "../_geraetModal";

// Fehlteile — Teil von Lagerfuchs (Tabelle FehlteilStand). Suche, Filter, Export.
// Gegated über GERAETE_REISE_VIEW (serverseitig). Fehlteile sind ALLE Artikel-
// arten — kein Hersteller-Filter wie beim regulären Geräte-Import. LogID öffnet
// das Lagerfuchs-Detail-Popup.

const NAVY  = "#202F61";
const BLAU  = "#008BD2";
const GRUEN = "#04B475";

const PRO_SEITE = 50;

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Zeile = RouterOutputs["fehlteile"]["liste"]["rows"][number];

function nf(n: number): string {
  return n.toLocaleString("de-DE");
}
function fmtDate(d: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const cardCls = "bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm";
const selectCls = "px-3 rounded-xl border-2 border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] font-bold min-h-[56px]";

// Filter-Dropdown aus filterWerte (nur vorhandene Werte + Anzahl).
function FilterSelect({
  id, label, wert, setWert, optionen,
}: {
  id: string; label: string; wert: string; setWert: (v: string) => void;
  optionen?: { wert: string; anzahl: number }[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase tracking-wide">{label}</span>
      <select id={id} value={wert} onChange={(e) => setWert(e.target.value)} className={selectCls}>
        <option value="">Alle</option>
        {(optionen ?? []).map((o) => (
          <option key={o.wert} value={o.wert}>{o.wert} ({nf(o.anzahl)})</option>
        ))}
      </select>
    </label>
  );
}

export default function FehlteilePage() {
  const { oeffneGeraet } = useGeraetModal();

  const [input, setInput]       = useState("");
  const [debInput]              = useDebounce(input, 300);
  const [geraeteart, setGa]     = useState("");
  const [hersteller, setHe]     = useState("");
  const [sortiment, setSo]      = useState("");
  const [inVerbleibDurch, setIvd] = useState("");
  const [seitVon, setVon]       = useState("");
  const [seitBis, setBis]       = useState("");
  const [page, setPage]         = useState(1);

  const suche = debInput.trim();

  // Gemeinsames Filter-Objekt (Liste + Export-URL identisch).
  const filter = {
    suche:           suche || undefined,
    geraeteart:      geraeteart || undefined,
    hersteller:      hersteller || undefined,
    sortiment:       sortiment || undefined,
    inVerbleibDurch: inVerbleibDurch || undefined,
    seitVon:         seitVon || undefined,
    seitBis:         seitBis || undefined,
  };

  const kennzahlenQ  = api.fehlteile.kennzahlen.useQuery(undefined, { staleTime: 60_000 });
  const filterWerteQ = api.fehlteile.filterWerte.useQuery(undefined, { staleTime: 60_000 });
  const listeQ = api.fehlteile.liste.useQuery(
    { ...filter, page, pageSize: PRO_SEITE },
    { staleTime: 15_000, placeholderData: (p) => p },
  );

  // Filterwechsel → zurück auf Seite 1.
  useEffect(() => { setPage(1); }, [suche, geraeteart, hersteller, sortiment, inVerbleibDurch, seitVon, seitBis]);

  const rows     = listeQ.data?.rows ?? [];
  const total    = listeQ.data?.total ?? 0;
  const von      = total === 0 ? 0 : (page - 1) * PRO_SEITE + 1;
  const bis      = Math.min(page * PRO_SEITE, total);
  const maxSeite = Math.max(1, Math.ceil(total / PRO_SEITE));

  function exportUrl(format: "csv" | "xlsx"): string {
    const p = new URLSearchParams();
    p.set("format", format);
    for (const [k, v] of Object.entries(filter)) if (v) p.set(k, v);
    return `/api/fehlteile/export?${p.toString()}`;
  }

  function filterLeeren() {
    setInput(""); setGa(""); setHe(""); setSo(""); setIvd(""); setVon(""); setBis("");
  }
  const hatFilter = !!(suche || geraeteart || hersteller || sortiment || inVerbleibDurch || seitVon || seitBis);

  return (
    <div className="max-w-[1600px] space-y-6">
      <div>
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">🧩 Fehlteile</h1>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
          Geräte mit Verbleib „Fehlteile" — alle Artikelarten, durchsuchbar &amp; exportierbar
        </p>
      </div>

      <GeraeteReiseTabs />

      {/* Kopf-Statistik */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className={`${cardCls} p-4`}>
          <div className="text-2xl sm:text-3xl font-black" style={{ color: NAVY }}>{nf(kennzahlenQ.data?.gesamt ?? 0)}</div>
          <div className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mt-1 uppercase tracking-wide">Fehlteile gesamt</div>
        </div>
        {(kennzahlenQ.data?.proGeraeteart ?? []).slice(0, 3).map((g) => (
          <div key={g.geraeteart} className={`${cardCls} p-4`}>
            <div className="text-2xl sm:text-3xl font-black" style={{ color: BLAU }}>{nf(g.anzahl)}</div>
            <div className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mt-1 uppercase tracking-wide truncate" title={g.geraeteart}>{g.geraeteart}</div>
          </div>
        ))}
      </div>

      {/* Suche + Filter */}
      <div className={`${cardCls} p-5 space-y-4`}>
        <label htmlFor="ft-suche" className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Suche</label>
        <div className="relative">
          <input
            id="ft-suche"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="LogID, Seriennummer oder Bezeichnung …"
            className="w-full px-4 text-lg font-bold rounded-xl border-2 border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#008BD2] dark:focus:border-[#45bdff] transition-colors min-h-[56px]"
          />
          {input && (
            <button
              onClick={() => setInput("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#65676b] hover:text-[#fa3e3e] text-2xl font-bold min-h-[44px] min-w-[44px]"
              aria-label="Suche löschen"
            >
              ✕
            </button>
          )}
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <FilterSelect id="f-ga"  label="Geräteart"        wert={geraeteart}      setWert={setGa}  optionen={filterWerteQ.data?.geraeteart} />
          <FilterSelect id="f-he"  label="Hersteller"       wert={hersteller}      setWert={setHe}  optionen={filterWerteQ.data?.hersteller} />
          <FilterSelect id="f-so"  label="Sortiment"        wert={sortiment}       setWert={setSo}  optionen={filterWerteQ.data?.sortiment} />
          <FilterSelect id="f-ivd" label="in Verbleib durch" wert={inVerbleibDurch} setWert={setIvd} optionen={filterWerteQ.data?.inVerbleibDurch} />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase tracking-wide">in Verbleib seit — von</span>
            <input type="date" value={seitVon} onChange={(e) => setVon(e.target.value)} className={selectCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase tracking-wide">bis</span>
            <input type="date" value={seitBis} onChange={(e) => setBis(e.target.value)} className={selectCls} />
          </label>
          {hatFilter && (
            <button
              onClick={filterLeeren}
              className="text-sm font-bold text-[#008BD2] dark:text-[#45bdff] hover:underline min-h-[56px] px-2"
            >
              ↺ Filter zurücksetzen
            </button>
          )}
        </div>
      </div>

      {/* Ergebnis */}
      <p aria-live="polite" className="sr-only">{nf(total)} Fehlteile gefunden.</p>

      <div className={`${cardCls} overflow-hidden`}>
        <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042] flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-black text-[#1a1a1a] dark:text-[#e4e6eb]">
            Treffer <span style={{ color: BLAU }}>— {nf(total)}</span>
            {listeQ.isFetching && <span className="ml-2 text-xs font-normal text-[#65676b] dark:text-[#b0b3b8]">Lädt…</span>}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { window.location.href = exportUrl("csv"); }}
              disabled={total === 0}
              className="inline-flex items-center gap-1.5 px-4 rounded-xl border-2 border-[#ced4da] dark:border-[#3e4042] text-[#1a1a1a] dark:text-[#e4e6eb] font-bold text-sm min-h-[56px] disabled:opacity-40 hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] transition-colors"
            >
              <span aria-hidden>⬇</span> CSV
            </button>
            <button
              onClick={() => { window.location.href = exportUrl("xlsx"); }}
              disabled={total === 0}
              className="inline-flex items-center gap-1.5 px-4 rounded-xl text-white font-bold text-sm min-h-[56px] disabled:opacity-40 transition-opacity hover:opacity-90"
              style={{ background: GRUEN }}
            >
              <span aria-hidden>⬇</span> Excel
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#f0f2f5] dark:bg-[#18191a] text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8]">
              <tr>
                <th className="px-4 py-2.5 text-left">LogID</th>
                <th className="px-4 py-2.5 text-left">Hersteller</th>
                <th className="px-4 py-2.5 text-left">Bezeichnung</th>
                <th className="px-4 py-2.5 text-left">Geräteart</th>
                <th className="px-4 py-2.5 text-left">Zustand</th>
                <th className="px-4 py-2.5 text-left">Grading</th>
                <th className="px-4 py-2.5 text-left">seit</th>
                <th className="px-4 py-2.5 text-left">durch</th>
                <th className="px-4 py-2.5 text-left">AAN</th>
                <th className="px-4 py-2.5 text-left">Sortiment</th>
              </tr>
            </thead>
            <tbody>
              {listeQ.isLoading ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-[#65676b] dark:text-[#b0b3b8]">Lädt…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-[#65676b] dark:text-[#b0b3b8]">Keine Fehlteile für diesen Filter.</td></tr>
              ) : rows.map((g: Zeile) => (
                <tr key={g.logId} className="border-t border-[#ced4da] dark:border-[#3e4042]">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <button
                      onClick={() => oeffneGeraet(g.logId)}
                      className="font-mono font-bold text-[#0064d2] dark:text-[#45bdff] hover:underline"
                      title="Detail-Popup öffnen"
                    >
                      {g.logId}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-[#1a1a1a] dark:text-[#e4e6eb]">{g.hersteller || "—"}</td>
                  <td className="px-4 py-3 text-[#1a1a1a] dark:text-[#e4e6eb]"><span className="block truncate max-w-[260px]" title={g.bezeichnung ?? ""}>{g.bezeichnung || "—"}</span></td>
                  <td className="px-4 py-3 text-[#65676b] dark:text-[#b0b3b8]">{g.geraeteart || "—"}</td>
                  <td className="px-4 py-3 text-[#65676b] dark:text-[#b0b3b8]">{g.aktuellerZustand || "—"}</td>
                  <td className="px-4 py-3 text-[#65676b] dark:text-[#b0b3b8]">{g.grading || "—"}</td>
                  <td className="px-4 py-3 text-[#65676b] dark:text-[#b0b3b8] whitespace-nowrap">{fmtDate(g.inVerbleibSeit)}</td>
                  <td className="px-4 py-3 text-[#65676b] dark:text-[#b0b3b8]">{g.inVerbleibDurch || "—"}</td>
                  <td className="px-4 py-3 text-[#65676b] dark:text-[#b0b3b8]">{g.aan || "—"}</td>
                  <td className="px-4 py-3 text-[#65676b] dark:text-[#b0b3b8]">{g.sortiment || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-[#ced4da] dark:border-[#3e4042] flex-wrap">
          <span className="text-sm text-[#65676b] dark:text-[#b0b3b8]">{nf(von)}–{nf(bis)} von {nf(total)}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((s) => Math.max(1, s - 1))}
              disabled={page <= 1}
              className="px-4 text-sm font-bold rounded-xl border-2 border-[#ced4da] dark:border-[#3e4042] disabled:opacity-40 hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] transition-colors min-h-[56px]"
            >
              ← Zurück
            </button>
            <span className="text-sm text-[#65676b] dark:text-[#b0b3b8] tabular-nums">Seite {nf(page)} / {nf(maxSeite)}</span>
            <button
              onClick={() => setPage((s) => Math.min(maxSeite, s + 1))}
              disabled={page >= maxSeite}
              className="px-4 text-sm font-bold rounded-xl border-2 border-[#ced4da] dark:border-[#3e4042] disabled:opacity-40 hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] transition-colors min-h-[56px]"
            >
              Vor →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

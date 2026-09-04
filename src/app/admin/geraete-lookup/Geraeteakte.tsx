"use client";
import { useState } from "react";
import { api } from "@/trpc/react";

// ── Geräteakte ───────────────────────────────────────────────────────────────
//
// Die Teile-Kette zu einer LogID, in beide Richtungen.
//
// ⚠️ Die Blöcke sind bewusst unterschiedlich gekennzeichnet, weil sie
// unterschiedlich verlässlich sind. „Eingebaut" und „Geerntet" sind belegt.
// „Mögliche Zielgeräte" sind Kandidaten: Ein geerntetes Teil geht in den
// Bestand seines Artikels und ist dort von jedem anderen Stück desselben
// Artikels nicht mehr zu unterscheiden. Diese Unterscheidung darf im UI nicht
// verschwinden — ein sauber aussehender Einzelvorschlag, der in Wahrheit
// geraten ist, richtet mehr Schaden an als ein leerer Kasten.

function datum(d: Date | string): string {
  return new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const karte = "bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-4 shadow-sm";
const titel = "text-sm font-black text-[#1a1a1a] dark:text-[#e4e6eb] flex items-center gap-2 flex-wrap";
const klein = "text-xs text-[#65676b] dark:text-[#b0b3b8]";

export function Geraeteakte({ logId }: { logId: string }) {
  const [zieleOffen, setZieleOffen] = useState(false);
  const akte = api.geraeteLookup.akte.useQuery({ logId }, { enabled: logId.replace(/\D/g, "").length >= 6 });

  if (akte.isFetching && !akte.data) {
    return <p className="text-sm font-bold text-[#0064d2] dark:text-[#45bdff]">Akte wird geladen…</p>;
  }
  if (!akte.data) return null;

  const { verbaut, offen, geerntet, moeglicheZiele } = akte.data;
  const nichts = verbaut.length === 0 && offen.length === 0 && geerntet.length === 0;

  if (nichts) {
    return (
      <div className={`${karte} text-center`}>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
          Zu diesem Gerät ist in Lagernaut kein Ersatzteil-Vorgang erfasst —
          weder eingebaut noch geerntet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Eingebaut (belegt) ────────────────────────────────────────────── */}
      {verbaut.length > 0 && (
        <div className={karte}>
          <div className={titel}>
            <span>🔧 In dieses Gerät eingebaut</span>
            <span className="px-2 py-0.5 rounded-full bg-[#04B475]/15 text-[#038F5C] dark:text-[#04B475] text-xs font-black">
              {verbaut.length} belegt
            </span>
          </div>
          <p className={`${klein} mt-1 mb-3`}>
            Ein Techniker hat das Teil für genau dieses Gerät angefragt und es wurde ausgegeben.
          </p>
          <ul className="divide-y divide-[#ced4da] dark:divide-[#3e4042]">
            {verbaut.map((v) => (
              <li key={v.buchungId} className="py-2.5 space-y-1">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <span className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] text-sm">
                    {v.menge > 1 && <span className="text-[#8A5A00] dark:text-[#f7b928]">{v.menge}× </span>}
                    {v.bezeichnung}
                  </span>
                  <span className={`${klein} tabular-nums`}>{datum(v.datum)}</span>
                </div>
                <div className={`${klein} flex flex-wrap gap-x-3 gap-y-0.5`}>
                  {v.kategorie && <span>{v.kategorie}</span>}
                  {v.teilenummer && <span className="font-mono">Nr. {v.teilenummer}</span>}
                  <span>Techniker {v.techniker}</span>
                  <span>ausgegeben von {v.ausgegebenVon}</span>
                  {v.typ === "DIREKT" && (
                    <span className="text-[#8A5A00] dark:text-[#f7b928] font-bold">Direkt-Durchgabe</span>
                  )}
                  {v.spenderLogId && (
                    <span>
                      Spender <span className="font-mono">{v.spenderLogId}</span>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Angefragt, aber nichts bekommen ───────────────────────────────── */}
      {offen.length > 0 && (
        <div className={karte}>
          <div className={titel}>
            <span>📝 Angefragt, kein Teil ausgegeben</span>
            <span className="px-2 py-0.5 rounded-full bg-[#f7b928]/18 text-[#8A5A00] dark:text-[#f7b928] text-xs font-black">
              {offen.length}
            </span>
          </div>
          <p className={`${klein} mt-1 mb-3`}>
            Auch das gehört zur Akte: Für dieses Gerät wurde etwas gebraucht, das nicht da war.
          </p>
          <ul className="divide-y divide-[#ced4da] dark:divide-[#3e4042]">
            {offen.map((o) => (
              <li key={o.anfrageId} className="py-2 flex items-baseline justify-between gap-3 flex-wrap">
                <span className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
                  {o.menge > 1 && `${o.menge}× `}{o.teil}
                  {o.istSonderAnfrage && <span className={`${klein} ml-2`}>Sonderanfrage</span>}
                </span>
                <span className={`${klein} tabular-nums`}>{o.status} · {datum(o.datum)} · {o.techniker}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Geerntet (belegt) ─────────────────────────────────────────────── */}
      {geerntet.length > 0 && (
        <div className={karte}>
          <div className={titel}>
            <span>🪛 Aus diesem Gerät geerntet</span>
            <span className="px-2 py-0.5 rounded-full bg-[#04B475]/15 text-[#038F5C] dark:text-[#04B475] text-xs font-black">
              {geerntet.length} belegt
            </span>
          </div>
          <p className={`${klein} mt-1 mb-3`}>
            Das Gerät war Spender. Diese Teile wurden ausgebaut und eingelagert.
          </p>
          <ul className="divide-y divide-[#ced4da] dark:divide-[#3e4042]">
            {geerntet.map((g) => (
              <li key={g.buchungId} className="py-2 flex items-baseline justify-between gap-3 flex-wrap">
                <span className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
                  {g.menge > 1 && <span className="text-[#8A5A00] dark:text-[#f7b928] font-bold">{g.menge}× </span>}
                  {g.bezeichnung}
                </span>
                <span className={`${klein} tabular-nums`}>{datum(g.datum)} · {g.erfasstVon}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Mögliche Zielgeräte (KEIN Beleg) ──────────────────────────────── */}
      {moeglicheZiele.length > 0 && (
        <div className="rounded-xl border-2 border-dashed border-[#f7b928] bg-[#f7b928]/6 p-4">
          <button
            onClick={() => setZieleOffen((v) => !v)}
            className="w-full text-left flex items-center justify-between gap-3 min-h-[44px]"
          >
            <span className={titel}>
              <span>≈ Mögliche Zielgeräte</span>
              <span className="px-2 py-0.5 rounded-full bg-[#f7b928]/25 text-[#8A5A00] dark:text-[#f7b928] text-xs font-black">
                {moeglicheZiele.length} Kandidaten
              </span>
            </span>
            <span className="text-[#8A5A00] dark:text-[#f7b928] font-black text-lg">
              {zieleOffen ? "−" : "+"}
            </span>
          </button>
          <p className="text-xs text-[#8A5A00] dark:text-[#f7b928] mt-2 leading-relaxed">
            <b>Kein Nachweis.</b> Ein geerntetes Teil liegt im Bestand seines Artikels und
            ist dort von jedem anderen Stück desselben Artikels nicht mehr zu unterscheiden.
            Diese Liste zeigt nur: derselbe Artikel ging nach der Ernte an diese Geräte.
            Für einen belastbaren Einzelnachweis müsste jedes Stück einzeln gekennzeichnet sein.
          </p>
          {zieleOffen && (
            <ul className="divide-y divide-[#f7b928]/30 mt-3">
              {moeglicheZiele.map((z, i) => (
                <li key={`${z.anfrageId}-${i}`} className="py-2 flex items-baseline justify-between gap-3 flex-wrap">
                  <span className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
                    {z.bezeichnung}
                    <span className={`${klein} ml-2 font-mono`}>→ {z.zielLogId}</span>
                    {z.zielGeraet && <span className={`${klein} ml-2`}>{z.zielGeraet}</span>}
                  </span>
                  <span className={`${klein} tabular-nums`}>{datum(z.datum)} · {z.techniker}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

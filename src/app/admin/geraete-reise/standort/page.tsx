"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from "recharts";
import { api } from "@/trpc/react";
import { GeraeteReiseTabs } from "../_tabs";

// Geräte-Reise — S9: Standort-Suche & -Analyse (Lagernummer + Stellplatz-Präfix).
// Reine Auswertung, kein Bestandseffekt.

const AGING_FARBE: Record<string, string> = {
  "0–30":    "#04B475",
  "31–90":   "#84CC16",
  "91–180":  "#F59E0B",
  "181–365": "#F97316",
  ">365":    "#EF4444",
};

function nf(n: number): string {
  return n.toLocaleString("de-DE");
}

const cardCls = "bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm";

// Eingabe parsen: nur Ziffern → Lagernummer; mit „-" und numerischem ersten
// Teil → Lagernummer + Stellplatz-Präfix; sonst ganzer String → Stellplatz-Präfix.
function parseEingabe(raw: string): { lagernummer?: string; stellplatzPrefix?: string } {
  const s = raw.trim();
  if (!s) return {};
  if (/^\d+$/.test(s)) return { lagernummer: s };
  if (s.includes("-")) {
    const idx = s.indexOf("-");
    const erster = s.slice(0, idx);
    const rest = s.slice(idx + 1).trim();
    if (/^\d+$/.test(erster)) {
      return { lagernummer: erster, stellplatzPrefix: rest || undefined };
    }
  }
  return { stellplatzPrefix: s };
}

function Kennzahl({ label, value, sub, akzent }: { label: string; value: string; sub?: string; akzent?: string }) {
  return (
    <div className={`${cardCls} p-4`}>
      <div className="text-2xl sm:text-3xl font-black" style={{ color: akzent ?? "#0064d2" }}>{value}</div>
      <div className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mt-1 uppercase tracking-wide">{label}</div>
      {sub && <div className="text-[11px] text-[#65676b] dark:text-[#b0b3b8] mt-0.5">{sub}</div>}
    </div>
  );
}

function BalkenChart({
  data, dataKey, labelKey, einfarbig, farben, onSelect,
}: {
  data:      Record<string, unknown>[];
  dataKey:   string;
  labelKey:  string;
  einfarbig?: string;
  farben?:   Record<string, string>;
  onSelect?: (label: string) => void;
}) {
  const hoehe = Math.max(120, data.length * 34 + 20);
  return (
    <ResponsiveContainer width="100%" height={hoehe}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 48, left: 8, bottom: 4 }}
        onClick={onSelect ? (state: { activeLabel?: string | number }) => {
          if (state?.activeLabel != null) onSelect(String(state.activeLabel));
        } : undefined}
        style={onSelect ? { cursor: "pointer" } : undefined}
      >
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey={labelKey} tick={{ fontSize: 12, fill: "currentColor" }} width={150} interval={0} />
        <Tooltip formatter={(v) => [nf(Number(v)), "Geräte"]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Bar dataKey={dataKey} radius={[0, 4, 4, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={farben?.[String(d[labelKey])] ?? einfarbig ?? "#008BD2"} />
          ))}
          <LabelList dataKey={dataKey} position="right" formatter={(v) => nf(Number(v))} style={{ fontSize: 11, fill: "currentColor" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function StandortPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput]         = useState("");
  const [submitted, setSubmitted] = useState("");

  const parsed = parseEingabe(submitted);
  const hatScope = !!(parsed.lagernummer || parsed.stellplatzPrefix);

  const { data, isFetching, error } = api.geraeteReise.standortAnalyse.useQuery(
    { lagernummer: parsed.lagernummer, stellplatzPrefix: parsed.stellplatzPrefix },
    { enabled: hatScope, staleTime: 60_000 },
  );

  function suchen() {
    const v = input.trim();
    if (v) setSubmitted(v);
  }

  // Drilldown-Basis (/liste) aus dem aktuellen Scope.
  const sp = new URLSearchParams();
  if (parsed.lagernummer)      sp.set("lagernummer", parsed.lagernummer);
  if (parsed.stellplatzPrefix) sp.set("stellplatzPrefix", parsed.stellplatzPrefix);
  const listeBasis = `/admin/geraete-reise/liste?${sp.toString()}`;

  const scopeLabel = [
    parsed.lagernummer      ? `Lager ${parsed.lagernummer}` : null,
    parsed.stellplatzPrefix ? `Stellplatz ${parsed.stellplatzPrefix}*` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">🧭 Geräte-Reise</h1>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">Standort-Suche &amp; -Analyse</p>
      </div>

      <GeraeteReiseTabs />

      {/* Suchfeld */}
      <div className={`${cardCls} p-5`}>
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") suchen(); }}
            placeholder="Lagernummer oder Stellplatz — z. B. 120, 120-ETL, 120-ETL-0-0-0, ETL-0-0-0"
            className="w-full px-4 py-4 text-lg font-bold font-mono rounded-xl border-2 border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] dark:focus:border-[#45bdff] transition-colors"
          />
          {input && (
            <button
              onClick={() => { setInput(""); inputRef.current?.focus(); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[#65676b] hover:text-[#fa3e3e] text-2xl font-bold transition-colors"
              aria-label="Eingabe löschen"
            >
              ✕
            </button>
          )}
        </div>
        <button
          onClick={suchen}
          disabled={!input.trim()}
          className="mt-3 w-full sm:w-auto px-6 py-2.5 rounded-xl bg-[#0064d2] dark:bg-[#45bdff] text-white font-bold disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          🔍 Standort analysieren
        </button>
        <p className="text-[11px] text-[#65676b] dark:text-[#b0b3b8] mt-2">
          Lagernummer 120 = AfB Sömmerda · 123 = Verkaufslager. Stellplatz-Suche per Präfix (z. B. „ETL").
        </p>
      </div>

      {hatScope && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">
            {scopeLabel} {data && <span className="text-[#0064d2] dark:text-[#45bdff]">— {nf(data.kennzahlen.anzahl)} Geräte</span>}
          </h2>
          {data && data.kennzahlen.anzahl > 0 && (
            <button
              onClick={() => router.push(listeBasis)}
              className="px-4 py-2 rounded-xl bg-[#0064d2] dark:bg-[#45bdff] text-white text-sm font-bold hover:opacity-90 transition-opacity"
            >
              Alle Geräte anzeigen →
            </button>
          )}
        </div>
      )}

      {isFetching && (
        <div className="flex items-center gap-3 p-5 text-[#65676b] dark:text-[#b0b3b8]">
          <div className="w-5 h-5 border-2 border-[#0064d2]/20 border-t-[#0064d2] rounded-full animate-spin" />
          Lädt Analyse…
        </div>
      )}
      {error && <p className="text-sm text-[#fa3e3e]">Fehler beim Laden der Analyse.</p>}

      {data && !isFetching && (
        data.kennzahlen.anzahl === 0 ? (
          <div className={`${cardCls} p-8 text-center text-[#65676b] dark:text-[#b0b3b8]`}>
            Keine Geräte für <span className="font-bold">{scopeLabel}</span> gefunden.
          </div>
        ) : (
          <>
            {/* Kennzahl-Karten */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kennzahl label="Anzahl"         value={nf(data.kennzahlen.anzahl)} />
              <Kennzahl label="Ø Verweildauer" value={nf(data.kennzahlen.avgVerweildauer)} sub="Tage" akzent="#202F61" />
              <Kennzahl label="ohne Verbleib"  value={nf(data.kennzahlen.ohneVerbleib)} akzent="#F59E0B" />
              <Kennzahl label="Ladenhüter"     value={nf(data.kennzahlen.ladenhueter)} sub=">365 Tage" akzent="#F97316" />
            </div>

            {/* Hersteller + Verbleib */}
            <div className="grid lg:grid-cols-2 gap-6">
              <div className={`${cardCls} overflow-hidden`}>
                <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042]">
                  <h3 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Hersteller</h3>
                  <p className="text-[11px] text-[#65676b] dark:text-[#b0b3b8] mt-0.5">Balken anklicken für Geräteliste</p>
                </div>
                <div className="p-4 text-[#1a1a1a] dark:text-[#e4e6eb]">
                  {data.herstellerVerteilung.length === 0 ? (
                    <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] text-center py-6">Keine Daten</p>
                  ) : (
                    <BalkenChart
                      data={data.herstellerVerteilung}
                      dataKey="anzahl"
                      labelKey="hersteller"
                      einfarbig="#04B475"
                      onSelect={(h) => router.push(
                        h === "Sonstige" || h === "ohne Angabe" ? listeBasis : `${listeBasis}&hersteller=${encodeURIComponent(h)}`,
                      )}
                    />
                  )}
                </div>
              </div>

              <div className={`${cardCls} overflow-hidden`}>
                <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042]">
                  <h3 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Verbleib</h3>
                  <p className="text-[11px] text-[#65676b] dark:text-[#b0b3b8] mt-0.5">Balken anklicken für Geräteliste</p>
                </div>
                <div className="p-4 text-[#1a1a1a] dark:text-[#e4e6eb]">
                  {data.verbleibVerteilung.length === 0 ? (
                    <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] text-center py-6">Keine Daten</p>
                  ) : (
                    <BalkenChart
                      data={data.verbleibVerteilung}
                      dataKey="anzahl"
                      labelKey="verbleib"
                      einfarbig="#008BD2"
                      onSelect={(v) => router.push(
                        v === "ohne Verbleib" ? `${listeBasis}&ohneVerbleib=1` : `${listeBasis}&verbleib=${encodeURIComponent(v)}`,
                      )}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Alter */}
            <div className={`${cardCls} overflow-hidden`}>
              <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042]">
                <h3 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Alter (Verweildauer)</h3>
              </div>
              <div className="p-4 text-[#1a1a1a] dark:text-[#e4e6eb]">
                <BalkenChart data={data.agingBuckets} dataKey="anzahl" labelKey="bucket" farben={AGING_FARBE} />
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
}

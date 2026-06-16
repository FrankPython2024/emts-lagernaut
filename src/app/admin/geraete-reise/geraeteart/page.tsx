"use client";
import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from "recharts";
import { api } from "@/trpc/react";
import { GeraeteReiseTabs } from "../_tabs";

// Geräte-Reise — S6: Detailanalyse einer Geräteart (Hersteller / Verbleib / Alter).
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

function Kennzahl({ label, value, sub, akzent }: { label: string; value: string; sub?: string; akzent?: string }) {
  return (
    <div className={`${cardCls} p-4`}>
      <div className="text-2xl sm:text-3xl font-black" style={{ color: akzent ?? "#0064d2" }}>{value}</div>
      <div className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mt-1 uppercase tracking-wide">{label}</div>
      {sub && <div className="text-[11px] text-[#65676b] dark:text-[#b0b3b8] mt-0.5">{sub}</div>}
    </div>
  );
}

// Horizontales Balkendiagramm. onSelect (optional) → klickbar; farben (optional)
// färbt Balken je Label (für die Alters-Buckets grün→rot).
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

export default function GeraeteartDetailPage() {
  return (
    <Suspense fallback={null}>
      <GeraeteartDetail />
    </Suspense>
  );
}

function GeraeteartDetail() {
  const router = useRouter();
  const params = useSearchParams();
  const art    = params?.get("art") ?? "";

  const { data, isLoading, error } = api.geraeteReise.geraeteartDetail.useQuery(
    { geraeteart: art },
    { enabled: art.length > 0, staleTime: 60_000 },
  );

  const listeBasis = `/admin/geraete-reise/liste?geraeteart=${encodeURIComponent(art)}`;

  return (
    <div className="max-w-[1600px] space-y-6">
      <div>
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">🦊 Lagerfuchs</h1>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">Geräteart-Detailanalyse</p>
      </div>

      <GeraeteReiseTabs />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link
          href="/admin/geraete-reise/dashboard"
          className="text-sm font-bold text-[#65676b] dark:text-[#b0b3b8] hover:text-[#0064d2] dark:hover:text-[#45bdff] transition-colors"
        >
          ← Zurück zur Übersicht
        </Link>
        {data && (
          <Link
            href={listeBasis}
            className="px-4 py-2 rounded-xl bg-[#0064d2] dark:bg-[#45bdff] text-white text-sm font-bold hover:opacity-90 transition-opacity"
          >
            Alle Geräte anzeigen →
          </Link>
        )}
      </div>

      {!art && <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Keine Geräteart gewählt.</p>}

      {isLoading && (
        <div className="flex items-center gap-3 p-5 text-[#65676b] dark:text-[#b0b3b8]">
          <div className="w-5 h-5 border-2 border-[#0064d2]/20 border-t-[#0064d2] rounded-full animate-spin" />
          Lädt Analyse…
        </div>
      )}
      {error && <p className="text-sm text-[#fa3e3e]">Fehler beim Laden der Analyse.</p>}

      {data && (
        <>
          <h2 className="text-xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">
            {data.geraeteart} <span className="text-[#0064d2] dark:text-[#45bdff]">— {nf(data.kennzahlen.anzahl)} Geräte</span>
          </h2>

          {/* Kennzahl-Karten */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Kennzahl label="Anzahl"         value={nf(data.kennzahlen.anzahl)} />
            <Kennzahl label="Ø Verweildauer" value={nf(data.kennzahlen.avgVerweildauer)} sub="Tage" akzent="#202F61" />
            <Kennzahl label="ohne Verbleib"  value={nf(data.kennzahlen.ohneVerbleib)} akzent="#F59E0B" />
            <Kennzahl label="Ladenhüter"     value={nf(data.kennzahlen.ladenhueter)} sub=">365 Tage" akzent="#F97316" />
            <Kennzahl label="blockiert"      value={nf(data.kennzahlen.blockiert)} akzent="#EF4444" />
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
                    onSelect={(h) => {
                      // „Sonstige"/„ohne Angabe" lassen sich nicht auf einen Hersteller filtern.
                      router.push(
                        h === "Sonstige" || h === "ohne Angabe"
                          ? listeBasis
                          : `${listeBasis}&hersteller=${encodeURIComponent(h)}`,
                      );
                    }}
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
                    onSelect={(v) => {
                      router.push(
                        v === "ohne Verbleib"
                          ? `${listeBasis}&ohneVerbleib=1`
                          : `${listeBasis}&verbleib=${encodeURIComponent(v)}`,
                      );
                    }}
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
      )}
    </div>
  );
}

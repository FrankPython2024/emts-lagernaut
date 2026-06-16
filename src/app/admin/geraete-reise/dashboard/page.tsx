"use client";
import { useRouter } from "next/navigation";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from "recharts";
import { api } from "@/trpc/react";
import { GeraeteReiseTabs } from "../_tabs";
import { useGeraetModal } from "../_geraetModal";
import { useColliModal } from "../_colliModal";
import { formatEuro } from "../_format";

// Geräte-Reise — S3: Aggregat-Dashboard über alle Geräte (Stand letzter Import).
// Reine Auswertung, kein Bestandseffekt.

const AFB = ["#008BD2", "#04B475", "#202F61", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16", "#F97316"];

// Aging-Buckets in fester, semantischer Farb-Abstufung (grün → rot).
const AGING_FARBE: Record<string, string> = {
  "0–30":    "#04B475",
  "31–90":   "#84CC16",
  "91–180":  "#F59E0B",
  "181–365": "#F97316",
  ">365":    "#EF4444",
};

// Bucket → Alters-Range (für den Drilldown in /liste).
const AGING_RANGE: Record<string, { von: number; bis?: number }> = {
  "0–30":    { von: 0,   bis: 30 },
  "31–90":   { von: 31,  bis: 90 },
  "91–180":  { von: 91,  bis: 180 },
  "181–365": { von: 181, bis: 365 },
  ">365":    { von: 366 },
};

function nf(n: number): string {
  return n.toLocaleString("de-DE");
}
function fmtDateTime(d: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
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

// Horizontales Balkendiagramm (Label-Achse links, Wert beschriftet).
// onSelect (optional) macht die Balken anklickbar (→ Drilldown).
function BalkenChart({
  data, dataKey, labelKey, einfarbig, onSelect,
}: {
  data:      Record<string, unknown>[];
  dataKey:   string;
  labelKey:  string;
  einfarbig?: string;
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
        <YAxis
          type="category"
          dataKey={labelKey}
          tick={{ fontSize: 12, fill: "currentColor" }}
          width={130}
          interval={0}
        />
        <Tooltip
          formatter={(v) => [nf(Number(v)), "Geräte"]}
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
        />
        <Bar dataKey={dataKey} radius={[0, 4, 4, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={einfarbig ?? (AGING_FARBE[String(d[labelKey])] ?? AFB[i % AFB.length])} />
          ))}
          <LabelList dataKey={dataKey} position="right" formatter={(v) => nf(Number(v))} style={{ fontSize: 11, fill: "currentColor" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function GeraeteReiseDashboardPage() {
  const router = useRouter();
  const { oeffneGeraet } = useGeraetModal();
  const { oeffneColli } = useColliModal();
  const { data, isLoading, error } = api.geraeteReise.dashboard.useQuery(undefined, { staleTime: 60_000 });

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">🦊 Lagerfuchs</h1>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
          Aggregat-Übersicht aller Geräte
          {data?.letzterImport && (
            <span className="ml-1">· Stand: <span className="font-semibold">{fmtDateTime(data.letzterImport)}</span></span>
          )}
        </p>
      </div>

      <GeraeteReiseTabs />

      {isLoading && (
        <div className="flex items-center gap-3 p-5 text-[#65676b] dark:text-[#b0b3b8]">
          <div className="w-5 h-5 border-2 border-[#0064d2]/20 border-t-[#0064d2] rounded-full animate-spin" />
          Lädt Auswertung…
        </div>
      )}
      {error && <p className="text-sm text-[#fa3e3e]">Fehler beim Laden der Auswertung.</p>}

      {data && (
        <>
          {/* Kennzahl-Karten */}
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <Kennzahl label="Geräte gesamt"   value={nf(data.kennzahlen.gesamt)} />
            <Kennzahl label="Gesamtwert Bestand" value={formatEuro(data.kennzahlen.gesamtwert)} sub="Summe Einkaufswert" akzent="#04B475" />
            <Kennzahl label="Ø Verweildauer"  value={nf(data.kennzahlen.avgVerweildauer)} sub="Tage" akzent="#202F61" />
            <Kennzahl label="ohne Verbleib"   value={nf(data.kennzahlen.ohneVerbleib)} akzent="#F59E0B" />
            <Kennzahl label="blockiert"       value={nf(data.kennzahlen.blockiert)} akzent="#EF4444" />
            <Kennzahl label="Ladenhüter"      value={nf(data.kennzahlen.ladenhueter)} sub=">365 Tage" akzent="#F97316" />
          </div>

          {/* Verbleib-Verteilung */}
          <div className={`${cardCls} overflow-hidden`}>
            <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042]">
              <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Verbleib-Verteilung</h2>
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
                    v === "ohne Verbleib"
                      ? "/admin/geraete-reise/liste?ohneVerbleib=1"
                      : `/admin/geraete-reise/liste?verbleib=${encodeURIComponent(v)}`,
                  )}
                />
              )}
            </div>
          </div>

          {/* Aging + Top-Ladenhüter */}
          <div className="grid lg:grid-cols-2 gap-6">
            <div className={`${cardCls} overflow-hidden`}>
              <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042]">
                <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Aging (Verweildauer)</h2>
                <p className="text-[11px] text-[#65676b] dark:text-[#b0b3b8] mt-0.5">Balken anklicken für Geräteliste</p>
              </div>
              <div className="p-4 text-[#1a1a1a] dark:text-[#e4e6eb]">
                <BalkenChart
                  data={data.agingBuckets}
                  dataKey="anzahl"
                  labelKey="bucket"
                  onSelect={(bucket) => {
                    const r = AGING_RANGE[bucket];
                    if (!r) return;
                    const p = new URLSearchParams({ alterVon: String(r.von) });
                    if (r.bis != null) p.set("alterBis", String(r.bis));
                    router.push(`/admin/geraete-reise/liste?${p.toString()}`);
                  }}
                />
              </div>
            </div>

            <div className={`${cardCls} overflow-hidden`}>
              <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042]">
                <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Top 20 Ladenhüter</h2>
              </div>
              {data.topLadenhueter.length === 0 ? (
                <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] text-center py-6">Keine Daten</p>
              ) : (
                <div className="divide-y divide-[#ced4da] dark:divide-[#3e4042] max-h-[420px] overflow-y-auto">
                  {data.topLadenhueter.map((g) => (
                    <div
                      key={g.logId}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] transition-colors"
                    >
                      <button onClick={() => oeffneGeraet(g.logId)} className="flex-1 min-w-0 text-left">
                        <div className="font-mono font-bold text-sm text-[#0064d2] dark:text-[#45bdff]">{g.logId}</div>
                        <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] truncate">
                          {[g.hersteller, g.bezeichnung].filter(Boolean).join(" ") || "—"}
                        </div>
                        <div className="text-[11px] text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
                          {g.verbleib || "ohne Verbleib"}{g.stellplatz ? ` · Platz ${g.stellplatz}` : ""}
                        </div>
                      </button>
                      {g.colli && (
                        <button
                          onClick={() => oeffneColli(g.colli!)}
                          className="inline-flex items-center gap-1 flex-shrink-0 font-mono font-bold text-sm text-[#0064d2] dark:text-[#45bdff] hover:underline"
                          title={`Alle Geräte im Colli ${g.colli} anzeigen`}
                        >
                          <span aria-hidden>📦</span>{g.colli}
                        </button>
                      )}
                      <div className="text-right flex-shrink-0">
                        <div className="font-black text-[#F97316]">{nf(g.verweildauerTage ?? 0)}</div>
                        <div className="text-[11px] text-[#65676b] dark:text-[#b0b3b8]">Tage</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Geräteart + Lager */}
          <div className="grid lg:grid-cols-2 gap-6">
            <div className={`${cardCls} overflow-hidden`}>
              <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042]">
                <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Geräteart</h2>
                <p className="text-[11px] text-[#65676b] dark:text-[#b0b3b8] mt-0.5">Balken anklicken für Detailanalyse</p>
              </div>
              <div className="p-4 text-[#1a1a1a] dark:text-[#e4e6eb]">
                {data.geraeteartVerteilung.length === 0 ? (
                  <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] text-center py-6">Keine Daten</p>
                ) : (
                  <BalkenChart
                    data={data.geraeteartVerteilung}
                    dataKey="anzahl"
                    labelKey="geraeteart"
                    einfarbig="#04B475"
                    onSelect={(art) => {
                      if (art !== "ohne Angabe") router.push(`/admin/geraete-reise/geraeteart?art=${encodeURIComponent(art)}`);
                    }}
                  />
                )}
              </div>
            </div>

            <div className={`${cardCls} overflow-hidden`}>
              <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042]">
                <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Lager</h2>
                <p className="text-[11px] text-[#65676b] dark:text-[#b0b3b8] mt-0.5">Balken anklicken für Geräteliste</p>
              </div>
              <div className="p-4 text-[#1a1a1a] dark:text-[#e4e6eb]">
                {data.lagerVerteilung.length === 0 ? (
                  <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] text-center py-6">Keine Daten</p>
                ) : (
                  <BalkenChart
                    data={data.lagerVerteilung}
                    dataKey="anzahl"
                    labelKey="lager"
                    einfarbig="#202F61"
                    onSelect={(l) => {
                      if (l !== "ohne Angabe") router.push(`/admin/geraete-reise/liste?lager=${encodeURIComponent(l)}`);
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

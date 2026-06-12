"use client";
import Link from "next/link";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList, Legend,
} from "recharts";
import type { inferRouterOutputs } from "@trpc/server";
import { api } from "@/trpc/react";
import type { AppRouter } from "@/server/routers";
import { GeraeteReiseTabs } from "../_tabs";

// Geräte-Reise — S4: Auswertungen (Alter · Stillstand · Stau). Reine Auswertung,
// kein Bestandseffekt. Gleiche Aggregations-/Card-/recharts-Muster wie das
// Dashboard (S3).

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Auswertungen  = RouterOutputs["geraeteReise"]["auswertungen"];
type GeraetZeile   = Auswertungen["aeltesteGeraete"][number];

const AFB = ["#008BD2", "#04B475", "#202F61", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16", "#F97316"];

function nf(n: number): string {
  return n.toLocaleString("de-DE");
}

// Schweregrad nach Tagen (grün → rot) — für Alters-Hervorhebung.
function tageFarbe(t: number | null): string {
  if (t == null)     return "#65676b";
  if (t <= 30)       return "#04B475";
  if (t <= 90)       return "#84CC16";
  if (t <= 180)      return "#F59E0B";
  if (t <= 365)      return "#F97316";
  return "#EF4444";
}

const cardCls = "bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm";

function CardHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042]">
      <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{children}</h2>
    </div>
  );
}

// Einfaches horizontales Balkendiagramm (eine Serie).
function BalkenChart({
  data, dataKey, labelKey, einfarbig,
}: {
  data:      Record<string, unknown>[];
  dataKey:   string;
  labelKey:  string;
  einfarbig?: string;
}) {
  const hoehe = Math.max(120, data.length * 34 + 20);
  return (
    <ResponsiveContainer width="100%" height={hoehe}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, left: 8, bottom: 4 }}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey={labelKey} tick={{ fontSize: 12, fill: "currentColor" }} width={130} interval={0} />
        <Tooltip formatter={(v) => [nf(Number(v)), "Geräte"]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Bar dataKey={dataKey} radius={[0, 4, 4, 0]}>
          {data.map((_, i) => <Cell key={i} fill={einfarbig ?? AFB[i % AFB.length]} />)}
          <LabelList dataKey={dataKey} position="right" formatter={(v) => nf(Number(v))} style={{ fontSize: 11, fill: "currentColor" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// Gestapeltes Balkendiagramm: frisch (grün) vs. „hängt zu lange" (rot) je Stufe.
function StauChart({ data, schwelle }: { data: Auswertungen["stauNachStufe"]; schwelle: number }) {
  const chartData = data.map((s) => ({
    verbleib: s.verbleib,
    frisch:   Math.max(0, s.anzahl - s.anzahlLange),
    lange:    s.anzahlLange,
  }));
  const hoehe = Math.max(140, chartData.length * 38 + 30);
  return (
    <ResponsiveContainer width="100%" height={hoehe}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey="verbleib" tick={{ fontSize: 12, fill: "currentColor" }} width={140} interval={0} />
        <Tooltip
          formatter={(v, name) => [nf(Number(v)), name === "lange" ? `> ${schwelle} Tage` : `≤ ${schwelle} Tage`]}
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
        />
        <Legend
          formatter={(val) => (val === "lange" ? `> ${schwelle} Tage` : `≤ ${schwelle} Tage`)}
          wrapperStyle={{ fontSize: 12 }}
        />
        <Bar dataKey="frisch" stackId="s" fill="#04B475" radius={[4, 0, 0, 4]} />
        <Bar dataKey="lange"  stackId="s" fill="#EF4444" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// Kompakte, anklickbare Geräte-Liste → Deep-Link in die Geräte-Ansicht (S2).
function GeraetListe({ geraete }: { geraete: GeraetZeile[] }) {
  if (geraete.length === 0) {
    return <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] text-center py-6">Keine Daten</p>;
  }
  return (
    <div className="divide-y divide-[#ced4da] dark:divide-[#3e4042] max-h-[420px] overflow-y-auto">
      {geraete.map((g) => (
        <Link
          key={g.logId}
          href={`/admin/geraete-reise/geraet?q=${encodeURIComponent(g.logId)}`}
          className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] transition-colors"
        >
          <div className="min-w-0">
            <div className="font-mono font-bold text-sm text-[#0064d2] dark:text-[#45bdff]">{g.logId}</div>
            <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] truncate">
              {[g.hersteller, g.bezeichnung].filter(Boolean).join(" ") || "—"}
            </div>
            <div className="text-[11px] text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
              {g.verbleib || "ohne Verbleib"}{g.stellplatz ? ` · Platz ${g.stellplatz}` : ""}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="font-black" style={{ color: tageFarbe(g.verweildauerTage) }}>{nf(g.verweildauerTage ?? 0)}</div>
            <div className="text-[11px] text-[#65676b] dark:text-[#b0b3b8]">Tage</div>
          </div>
        </Link>
      ))}
    </div>
  );
}

export default function GeraeteReiseAuswertungenPage() {
  const { data, isLoading, error } = api.geraeteReise.auswertungen.useQuery(undefined, { staleTime: 60_000 });

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">🧭 Geräte-Reise</h1>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
          Auswertungen — Alter, Stillstand &amp; Stau
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
          {/* Highlight-Karten */}
          <div className="grid sm:grid-cols-3 gap-3">
            {/* Ältestes Gerät — anklickbar → S2 */}
            {data.aeltestesGeraet ? (
              <Link
                href={`/admin/geraete-reise/geraet?q=${encodeURIComponent(data.aeltestesGeraet.logId)}`}
                className={`${cardCls} p-4 hover:border-[#0064d2] dark:hover:border-[#45bdff] transition-colors block`}
              >
                <div className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase tracking-wide">Ältestes Gerät</div>
                <div className="font-mono font-black text-lg text-[#0064d2] dark:text-[#45bdff] mt-1">{data.aeltestesGeraet.logId}</div>
                <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] truncate">
                  {[data.aeltestesGeraet.hersteller, data.aeltestesGeraet.bezeichnung].filter(Boolean).join(" ") || "—"}
                </div>
                <div className="mt-2 font-black" style={{ color: tageFarbe(data.aeltestesGeraet.verweildauerTage) }}>
                  {nf(data.aeltestesGeraet.verweildauerTage ?? 0)} <span className="text-xs font-bold">Tage</span>
                </div>
              </Link>
            ) : (
              <div className={`${cardCls} p-4`}>
                <div className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase tracking-wide">Ältestes Gerät</div>
                <div className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-2">Keine Daten</div>
              </div>
            )}

            {/* Geräte ohne Bewegung */}
            <div className={`${cardCls} p-4`}>
              <div className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase tracking-wide">Geräte ohne Bewegung</div>
              <div className="text-3xl font-black text-[#202F61] dark:text-[#8ab4ff] mt-1">{nf(data.ohneBewegung.gesamt)}</div>
              <div className="text-[11px] text-[#65676b] dark:text-[#b0b3b8] mt-0.5">noch kein erfasstes Ereignis</div>
            </div>

            {/* Größter Stau */}
            <div className={`${cardCls} p-4`}>
              <div className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase tracking-wide">Größter Stau</div>
              {data.groessterStau ? (
                <>
                  <div className="font-black text-lg text-[#1a1a1a] dark:text-[#e4e6eb] mt-1 truncate">{data.groessterStau.verbleib}</div>
                  <div className="mt-1 font-black text-[#EF4444]">
                    {nf(data.groessterStau.anzahlLange)} <span className="text-xs font-bold">&gt; {data.schwelleTage} Tage</span>
                  </div>
                </>
              ) : (
                <div className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-2">Keine Daten</div>
              )}
            </div>
          </div>

          {/* Stau nach Stufe: Chart + Tabelle */}
          <div className="grid lg:grid-cols-2 gap-6">
            <div className={`${cardCls} overflow-hidden`}>
              <CardHeader>Stau nach Verbleib-Stufe</CardHeader>
              <div className="p-4 text-[#1a1a1a] dark:text-[#e4e6eb]">
                {data.stauNachStufe.length === 0 ? (
                  <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] text-center py-6">Keine Daten</p>
                ) : (
                  <StauChart data={data.stauNachStufe} schwelle={data.schwelleTage} />
                )}
              </div>
            </div>

            <div className={`${cardCls} overflow-hidden`}>
              <CardHeader>Stufen im Detail</CardHeader>
              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[#f0f2f5] dark:bg-[#18191a] text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8]">
                    <tr>
                      <th className="px-4 py-2 text-left">Stufe</th>
                      <th className="px-4 py-2 text-right">Anzahl</th>
                      <th className="px-4 py-2 text-right">&gt; {data.schwelleTage} T</th>
                      <th className="px-4 py-2 text-right">Ø Tage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.stauNachStufe.map((s) => {
                      const anteil = s.anzahl > 0 ? s.anzahlLange / s.anzahl : 0;
                      return (
                        <tr key={s.verbleib} className="border-t border-[#ced4da] dark:border-[#3e4042]">
                          <td className="px-4 py-2 font-medium text-[#1a1a1a] dark:text-[#e4e6eb]">{s.verbleib}</td>
                          <td className="px-4 py-2 text-right text-[#1a1a1a] dark:text-[#e4e6eb]">{nf(s.anzahl)}</td>
                          <td className="px-4 py-2 text-right font-bold" style={{ color: anteil >= 0.5 ? "#EF4444" : anteil >= 0.2 ? "#F97316" : "#04B475" }}>
                            {nf(s.anzahlLange)}
                          </td>
                          <td className="px-4 py-2 text-right text-[#65676b] dark:text-[#b0b3b8]">{nf(s.avgTageInStufe)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Älteste Geräte + Älteste ohne Bewegung */}
          <div className="grid lg:grid-cols-2 gap-6">
            <div className={`${cardCls} overflow-hidden`}>
              <CardHeader>Älteste Geräte (Top 20)</CardHeader>
              <GeraetListe geraete={data.aeltesteGeraete} />
            </div>

            <div className={`${cardCls} overflow-hidden`}>
              <CardHeader>Älteste ohne Bewegung (Top 20)</CardHeader>
              <GeraetListe geraete={data.ohneBewegung.liste} />
            </div>
          </div>

          {/* Vollste Stellplätze */}
          <div className={`${cardCls} overflow-hidden`}>
            <CardHeader>Vollste Stellplätze</CardHeader>
            <div className="p-4 text-[#1a1a1a] dark:text-[#e4e6eb]">
              {data.vollsteStellplaetze.length === 0 ? (
                <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] text-center py-6">Keine Daten</p>
              ) : (
                <BalkenChart data={data.vollsteStellplaetze} dataKey="anzahl" labelKey="stellplatz" einfarbig="#008BD2" />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

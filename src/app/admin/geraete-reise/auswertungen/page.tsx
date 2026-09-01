"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import type { inferRouterOutputs } from "@trpc/server";
import { api } from "@/trpc/react";
import type { AppRouter } from "@/server/routers";
import { GeraeteReiseTabs } from "../_tabs";
import { useGeraetModal } from "../_geraetModal";
import { useColliModal } from "../_colliModal";
import { formatEuroKurz } from "../_format";

// Drilldown-Ziel (S5): Verbleib-Stufe bzw. „ohne Verbleib" → Geräte-Liste.
function listeHrefStufe(verbleib: string): string {
  return verbleib === "ohne Verbleib"
    ? "/admin/geraete-reise/liste?ohneVerbleib=1"
    : `/admin/geraete-reise/liste?verbleib=${encodeURIComponent(verbleib)}`;
}

// Geräte-Reise — S4: Auswertungen (Alter · Stillstand · Stau). Reine Auswertung,
// kein Bestandseffekt. Gleiche Aggregations-/Card-/recharts-Muster wie das
// Dashboard (S3).

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Auswertungen  = RouterOutputs["geraeteReise"]["auswertungen"];
type GeraetZeile   = Auswertungen["aeltesteGeraete"][number];

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

// Gestapeltes Balkendiagramm: frisch (grün) vs. „hängt zu lange" (rot) je Stufe.
// Klick auf einen Balken → Drilldown-Liste der Stufe.
function StauChart({
  data, schwelle, onSelect,
}: {
  data:     Auswertungen["stauNachStufe"];
  schwelle: number;
  onSelect: (verbleib: string) => void;
}) {
  const chartData = data.map((s) => ({
    verbleib: s.verbleib,
    frisch:   Math.max(0, s.anzahl - s.anzahlLange),
    lange:    s.anzahlLange,
  }));
  const hoehe = Math.max(140, chartData.length * 38 + 30);
  return (
    <ResponsiveContainer width="100%" height={hoehe}>
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
        onClick={(state: { activeLabel?: string | number }) => {
          if (state?.activeLabel != null) onSelect(String(state.activeLabel));
        }}
        style={{ cursor: "pointer" }}
      >
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

// Kompakte, anklickbare Geräte-Liste → öffnet die Geräte-Reise als Popup. Die
// Colli-Nummer ist ein eigener Knopf (öffnet das Colli-Popup) — daher liegt sie
// NEBEN dem Geräte-Knopf, nicht darin (kein verschachteltes <button>).
function GeraetListe({ geraete }: { geraete: GeraetZeile[] }) {
  const { oeffneGeraet } = useGeraetModal();
  const { oeffneColli } = useColliModal();
  if (geraete.length === 0) {
    return <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] text-center py-6">Keine Daten</p>;
  }
  return (
    <div className="divide-y divide-[#ced4da] dark:divide-[#3e4042] max-h-[420px] overflow-y-auto">
      {geraete.map((g) => (
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
            <div className="font-black" style={{ color: tageFarbe(g.verweildauerTage) }}>{nf(g.verweildauerTage ?? 0)}</div>
            <div className="text-[11px] text-[#65676b] dark:text-[#b0b3b8]">Tage</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function GeraeteReiseAuswertungenPage() {
  const router = useRouter();
  const { oeffneGeraet } = useGeraetModal();
  const { data, isLoading, error } = api.geraeteReise.auswertungen.useQuery(undefined, { staleTime: 60_000 });

  return (
    <div className="max-w-[1600px] space-y-6">
      <div>
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">🦊 Lagerfuchs</h1>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
          Auswertungen: Alter, Stillstand &amp; Stau
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
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Ältestes Gerät — anklickbar → S2 */}
            {data.aeltestesGeraet ? (
              <button
                onClick={() => oeffneGeraet(data.aeltestesGeraet!.logId)}
                className={`${cardCls} p-4 hover:border-[#0064d2] dark:hover:border-[#45bdff] transition-colors block w-full text-left`}
              >
                <div className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase tracking-wide">Ältestes Gerät</div>
                <div className="font-mono font-black text-lg text-[#0064d2] dark:text-[#45bdff] mt-1">{data.aeltestesGeraet.logId}</div>
                <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] truncate">
                  {[data.aeltestesGeraet.hersteller, data.aeltestesGeraet.bezeichnung].filter(Boolean).join(" ") || "—"}
                </div>
                <div className="mt-2 font-black" style={{ color: tageFarbe(data.aeltestesGeraet.verweildauerTage) }}>
                  {nf(data.aeltestesGeraet.verweildauerTage ?? 0)} <span className="text-xs font-bold">Tage</span>
                </div>
              </button>
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

            {/* Gebundener Wert im Stau — wie viel Kapital in Langliegern steckt */}
            <div className={`${cardCls} p-4`}>
              <div className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase tracking-wide">Gebundener Wert im Stau</div>
              <div className="font-black text-lg sm:text-xl tabular-nums mt-1 break-words leading-tight text-[#EF4444]">
                {formatEuroKurz(data.gebundenerWertStau)}
              </div>
              <div className="text-[11px] text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
                Kapital in Langliegern (&gt; {data.schwelleTage} Tage)
              </div>
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
                  <StauChart
                    data={data.stauNachStufe}
                    schwelle={data.schwelleTage}
                    onSelect={(v) => router.push(listeHrefStufe(v))}
                  />
                )}
              </div>
            </div>

            <div className={`${cardCls} overflow-hidden`}>
              <CardHeader>Stufen im Detail</CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#f0f2f5] dark:bg-[#18191a] text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8]">
                    <tr>
                      <th className="px-4 py-2 text-left">Stufe</th>
                      <th className="px-4 py-2 text-right">Anzahl</th>
                      <th className="px-4 py-2 text-right">Wert</th>
                      <th className="px-4 py-2 text-right">&gt; {data.schwelleTage} T</th>
                      <th className="px-4 py-2 text-right">&gt; {data.schwelleTage} T Wert</th>
                      <th className="px-4 py-2 text-right">Ø Tage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.stauNachStufe.map((s) => {
                      const anteil = s.anzahl > 0 ? s.anzahlLange / s.anzahl : 0;
                      return (
                        <tr
                          key={s.verbleib}
                          onClick={() => router.push(listeHrefStufe(s.verbleib))}
                          className="border-t border-[#ced4da] dark:border-[#3e4042] cursor-pointer hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] transition-colors"
                        >
                          <td className="px-4 py-2 font-medium text-[#0064d2] dark:text-[#45bdff]">{s.verbleib}</td>
                          <td className="px-4 py-2 text-right text-[#1a1a1a] dark:text-[#e4e6eb] tabular-nums">{nf(s.anzahl)}</td>
                          <td className="px-4 py-2 text-right text-[#1a1a1a] dark:text-[#e4e6eb] tabular-nums">{formatEuroKurz(s.wert)}</td>
                          <td className="px-4 py-2 text-right font-bold tabular-nums" style={{ color: anteil >= 0.5 ? "#EF4444" : anteil >= 0.2 ? "#F97316" : "#04B475" }}>
                            {nf(s.anzahlLange)}
                          </td>
                          <td className="px-4 py-2 text-right font-bold tabular-nums text-[#EF4444]">{formatEuroKurz(s.wertStau)}</td>
                          <td className="px-4 py-2 text-right text-[#65676b] dark:text-[#b0b3b8] tabular-nums">{nf(s.avgTageInStufe)}</td>
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

          {/* Vollste Stellplätze — anklickbar → Drilldown-Liste */}
          <div className={`${cardCls} overflow-hidden`}>
            <CardHeader>Vollste Stellplätze</CardHeader>
            {data.vollsteStellplaetze.length === 0 ? (
              <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] text-center py-6">Keine Daten</p>
            ) : (
              <div className="divide-y divide-[#ced4da] dark:divide-[#3e4042]">
                {(() => {
                  const max = data.vollsteStellplaetze[0]?.anzahl ?? 1;
                  return data.vollsteStellplaetze.map((s) => (
                    <Link
                      key={s.stellplatz}
                      href={`/admin/geraete-reise/liste?stellplatz=${encodeURIComponent(s.stellplatz)}`}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] transition-colors"
                    >
                      <span className="font-mono font-bold text-sm text-[#0064d2] dark:text-[#45bdff] w-32 flex-shrink-0 truncate">
                        {s.stellplatz}
                      </span>
                      <span className="flex-1 h-3 rounded-full bg-[#f0f2f5] dark:bg-[#18191a] overflow-hidden">
                        <span className="block h-full rounded-full" style={{ width: `${Math.max(4, (s.anzahl / max) * 100)}%`, background: "#008BD2" }} />
                      </span>
                      <span className="font-black text-sm text-[#1a1a1a] dark:text-[#e4e6eb] w-16 text-right flex-shrink-0">
                        {nf(s.anzahl)}
                      </span>
                    </Link>
                  ));
                })()}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

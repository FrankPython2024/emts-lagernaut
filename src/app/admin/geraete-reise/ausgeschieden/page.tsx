"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from "recharts";
import { api } from "@/trpc/react";
import { GeraeteReiseTabs } from "../_tabs";
import { useGeraetModal } from "../_geraetModal";

// Geräte-Reise — S8: Ausgeschiedene Geräte (haben das System verlassen).
// Reine Auswertung, kein Bestandseffekt.

const AFB = ["#008BD2", "#04B475", "#202F61", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16", "#F97316"];

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
        <YAxis type="category" dataKey={labelKey} tick={{ fontSize: 12, fill: "currentColor" }} width={150} interval={0} />
        <Tooltip formatter={(v) => [nf(Number(v)), "Geräte"]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Bar dataKey={dataKey} radius={[0, 4, 4, 0]}>
          {data.map((_, i) => <Cell key={i} fill={einfarbig ?? AFB[i % AFB.length]} />)}
          <LabelList dataKey={dataKey} position="right" formatter={(v) => nf(Number(v))} style={{ fontSize: 11, fill: "currentColor" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function AusgeschiedenePage() {
  const router = useRouter();
  const { oeffneGeraet } = useGeraetModal();
  const { data, isLoading, error } = api.geraeteReise.ausgeschiedeneUebersicht.useQuery(undefined, { staleTime: 60_000 });

  const BASIS = "/admin/geraete-reise/liste?ausgeschieden=1";

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">🧭 Geräte-Reise</h1>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
          Ausgeschiedene Geräte — haben das System verlassen (im letzten Snapshot nicht mehr enthalten)
          {data?.letzterImport && (
            <span className="ml-1">· Stand: <span className="font-semibold">{fmtDateTime(data.letzterImport)}</span></span>
          )}
        </p>
      </div>

      <GeraeteReiseTabs />

      {isLoading && (
        <div className="flex items-center gap-3 p-5 text-[#65676b] dark:text-[#b0b3b8]">
          <div className="w-5 h-5 border-2 border-[#0064d2]/20 border-t-[#0064d2] rounded-full animate-spin" />
          Lädt…
        </div>
      )}
      {error && <p className="text-sm text-[#fa3e3e]">Fehler beim Laden.</p>}

      {data && (
        <>
          {/* Kennzahl-Karten */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Kennzahl label="Ausgeschieden gesamt" value={nf(data.kennzahlen.gesamt)} akzent="#EF4444" />
            <Kennzahl label="Neu im letzten Import" value={nf(data.kennzahlen.neuImLetztenImport)} sub="zuletzt abgegangen" akzent="#F97316" />
            <Link href={BASIS} className={`${cardCls} p-4 hover:border-[#0064d2] dark:hover:border-[#45bdff] transition-colors flex flex-col justify-center`}>
              <div className="text-sm font-black text-[#0064d2] dark:text-[#45bdff]">Alle anzeigen →</div>
              <div className="text-[11px] text-[#65676b] dark:text-[#b0b3b8] mt-1">vollständige Liste (filterbar, Export)</div>
            </Link>
          </div>

          {/* Letzter Verbleib + letzte Stellplätze */}
          <div className="grid lg:grid-cols-2 gap-6">
            <div className={`${cardCls} overflow-hidden`}>
              <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042]">
                <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Nach letztem Verbleib</h2>
                <p className="text-[11px] text-[#65676b] dark:text-[#b0b3b8] mt-0.5">Abgang-Grund-Hinweis · Balken anklicken für Liste</p>
              </div>
              <div className="p-4 text-[#1a1a1a] dark:text-[#e4e6eb]">
                {data.verbleibVerteilung.length === 0 ? (
                  <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] text-center py-6">Keine Daten</p>
                ) : (
                  <BalkenChart
                    data={data.verbleibVerteilung}
                    dataKey="anzahl"
                    labelKey="verbleib"
                    einfarbig="#EF4444"
                    onSelect={(v) => router.push(
                      v === "ohne Verbleib" ? `${BASIS}&ohneVerbleib=1` : `${BASIS}&verbleib=${encodeURIComponent(v)}`,
                    )}
                  />
                )}
              </div>
            </div>

            <div className={`${cardCls} overflow-hidden`}>
              <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042]">
                <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Letzte Stellplätze</h2>
                <p className="text-[11px] text-[#65676b] dark:text-[#b0b3b8] mt-0.5">Balken anklicken für Liste</p>
              </div>
              <div className="p-4 text-[#1a1a1a] dark:text-[#e4e6eb]">
                {data.topStellplaetze.length === 0 ? (
                  <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] text-center py-6">Keine Daten</p>
                ) : (
                  <BalkenChart
                    data={data.topStellplaetze}
                    dataKey="anzahl"
                    labelKey="stellplatz"
                    einfarbig="#202F61"
                    onSelect={(s) => {
                      if (s !== "ohne Angabe") router.push(`${BASIS}&stellplatz=${encodeURIComponent(s)}`);
                    }}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Liste der ausgeschiedenen Geräte */}
          <div className={`${cardCls} overflow-hidden`}>
            <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042]">
              <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Zuletzt ausgeschieden</h2>
              <p className="text-[11px] text-[#65676b] dark:text-[#b0b3b8] mt-0.5">die 100 jüngsten Abgänge — Zeile anklicken für Geräte-Reise</p>
            </div>
            {data.liste.length === 0 ? (
              <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] text-center py-8">Noch keine ausgeschiedenen Geräte.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#f0f2f5] dark:bg-[#18191a] text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8]">
                    <tr>
                      <th className="px-4 py-2.5 text-left">LogID</th>
                      <th className="px-4 py-2.5 text-left">Hersteller / Bezeichnung</th>
                      <th className="px-4 py-2.5 text-left">Letzter Stellplatz</th>
                      <th className="px-4 py-2.5 text-left">Letzter Verbleib</th>
                      <th className="px-4 py-2.5 text-left">Ausgeschieden am</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.liste.map((g) => (
                      <tr
                        key={g.logId}
                        onClick={() => oeffneGeraet(g.logId)}
                        className="border-t border-[#ced4da] dark:border-[#3e4042] cursor-pointer hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] transition-colors"
                      >
                        <td className="px-4 py-2.5 font-mono font-bold text-[#0064d2] dark:text-[#45bdff] whitespace-nowrap">{g.logId}</td>
                        <td className="px-4 py-2.5 text-[#1a1a1a] dark:text-[#e4e6eb]">
                          <span className="block truncate max-w-[280px]">{[g.hersteller, g.bezeichnung].filter(Boolean).join(" ") || "—"}</span>
                        </td>
                        <td className="px-4 py-2.5 text-[#65676b] dark:text-[#b0b3b8]">{g.stellplatz || "—"}</td>
                        <td className="px-4 py-2.5 text-[#65676b] dark:text-[#b0b3b8]">{g.verbleib || "—"}</td>
                        <td className="px-4 py-2.5 text-[#65676b] dark:text-[#b0b3b8] whitespace-nowrap">{fmtDateTime(g.ausgeschiedenAm)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

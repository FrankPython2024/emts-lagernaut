"use client";
import { useState } from "react";
import { AnfrageStatus } from "@prisma/client";
import { api } from "@/trpc/react";
import { StatCard } from "@/components/ui/StatCard";

// ── Typen & Konstanten ────────────────────────────────────────────────────────

type FilterRange = "woche" | "monat" | "quartal" | "jahr";
const TAGE_MAP: Record<FilterRange, number> = { woche: 7, monat: 30, quartal: 90, jahr: 365 };
const FILTER_OPTS: { key: FilterRange; label: string }[] = [
  { key: "woche",   label: "7 Tage" },
  { key: "monat",   label: "30 Tage" },
  { key: "quartal", label: "90 Tage" },
  { key: "jahr",    label: "365 Tage" },
];

const STATUS_FARBE: Record<AnfrageStatus, string> = {
  NEU:           "bg-[#0064d2]  text-white",
  BEDARF:        "bg-[#f7b928]  text-white",
  ABGESCHLOSSEN: "bg-[#00a400]  text-white",
  STORNIERT:     "bg-[#888]     text-white",
};

// ── Primitive UI ──────────────────────────────────────────────────────────────

function Skeleton({ h = "h-24" }: { h?: string }) {
  return <div className={`${h} bg-[#f0f2f5] dark:bg-[#3e4042] rounded-xl animate-pulse`} />;
}

function Panel({ title, children, sub }: { title: string; children: React.ReactNode; sub?: string }) {
  return (
    <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm">
      <div className="mb-3">
        <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{title}</h2>
        {sub && <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-0.5">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

function Empty() {
  return <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] text-center py-6">Keine Daten</p>;
}

// ── HBarChart mit optionalem Bedarf-Anteil ────────────────────────────────────

function HBarChart({ items, showBedarf }: {
  items:      { label: string; value: number; bedarfValue?: number }[];
  showBedarf?: boolean;
}) {
  if (!items.length) return <Empty />;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="space-y-2">
      {items.map((item) => {
        const pct       = (item.value / max) * 100;
        const bedarfPct = showBedarf && item.bedarfValue
          ? (item.bedarfValue / item.value) * pct
          : 0;
        return (
          <div key={item.label} className="flex items-center gap-3">
            <div className="w-28 text-xs text-[#65676b] dark:text-[#b0b3b8] truncate text-right flex-shrink-0">{item.label}</div>
            <div className="flex-1 bg-[#f0f2f5] dark:bg-[#18191a] rounded-full h-5 overflow-hidden relative">
              <div className="h-full bg-[#0064d2] dark:bg-[#45bdff] rounded-full flex items-center justify-end pr-2 transition-all duration-700"
                style={{ width: `${pct}%` }}>
                <span className="text-[10px] text-white font-bold">{item.value}</span>
              </div>
              {showBedarf && bedarfPct > 0 && (
                <div className="absolute top-0 left-0 h-full bg-[#f7b928]/60 rounded-full"
                  style={{ width: `${bedarfPct}%` }} />
              )}
            </div>
            {showBedarf && item.bedarfValue !== undefined && (
              <div className="text-[10px] text-[#f7b928] font-bold w-14 flex-shrink-0">
                {item.bedarfValue > 0 ? `${Math.round((item.bedarfValue / item.value) * 100)}% N/A` : ""}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Anfragen-Verlauf SVG ──────────────────────────────────────────────────────

function AnfragenVerlauf({ data }: {
  data: { datum: string; anfragen: number; erledigt: number; bedarf: number }[];
}) {
  if (!data.length) return <Empty />;

  const maxVal = Math.max(...data.flatMap((d) => [d.anfragen, d.erledigt, d.bedarf]), 1);
  const n      = data.length;
  const H      = 80;
  const W      = 300;

  function pts(key: "anfragen" | "erledigt" | "bedarf") {
    return data
      .map((d, i) => {
        const x = n > 1 ? (i / (n - 1)) * W : W / 2;
        const y = H - 4 - (d[key] / maxVal) * (H - 8);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }

  return (
    <div className="mt-2">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: `${H}px` }}>
        <polyline points={pts("anfragen")} fill="none" stroke="#0064d2" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        <polyline points={pts("erledigt")} fill="none" stroke="#00a400" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        <polyline points={pts("bedarf")}   fill="none" stroke="#f7b928" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* X-Achse: erste und letzte Beschriftung */}
      {n >= 2 && (
        <div className="flex justify-between text-[10px] text-[#65676b] dark:text-[#b0b3b8] mt-1">
          <span>{data[0]!.datum.slice(5)}</span>
          <span>{data[n - 1]!.datum.slice(5)}</span>
        </div>
      )}
    </div>
  );
}

// ── Balken-Chart (vertikal) ───────────────────────────────────────────────────

function VBarChart({ items }: { items: { label: string; anzahl: number }[] }) {
  const max = Math.max(...items.map((i) => i.anzahl), 1);
  return (
    <div className="flex items-end gap-1 h-20 mt-2">
      {items.map((item) => (
        <div key={item.label} className="flex-1 flex flex-col items-center gap-1" title={`${item.label}: ${item.anzahl}`}>
          <div
            className="w-full rounded-t transition-all duration-500"
            style={{
              height:     `${(item.anzahl / max) * 60}px`,
              background: item.anzahl === max ? "#0064d2" : "#0064d2aa",
            }}
          />
          <div className="text-[9px] text-[#65676b] dark:text-[#b0b3b8] truncate w-full text-center">{item.label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AnfrageStatus }) {
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_FARBE[status]}`}>
      {status}
    </span>
  );
}

// ── Team-Vergleich Grid ───────────────────────────────────────────────────────

function TeamVergleich({ data }: {
  data: { techniker: string; volumen: number; erledigungsrate: number; avgWartezeitH: number; bedarfQuote: number }[];
}) {
  if (!data.length) return <Empty />;
  const maxVol = Math.max(...data.map((d) => d.volumen), 1);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {data.map((t) => (
        <div key={t.techniker} className="bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#0064d2] text-white text-xs font-black flex items-center justify-center flex-shrink-0">
              {t.techniker.slice(0, 2)}
            </div>
            <span className="font-bold text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">{t.techniker}</span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-[#65676b] dark:text-[#b0b3b8]">Anfragen</span>
              <span className="font-bold text-[#0064d2]">{t.volumen}</span>
            </div>
            <div className="w-full bg-[#ced4da] dark:bg-[#3e4042] rounded-full h-1.5">
              <div className="h-1.5 rounded-full bg-[#0064d2]" style={{ width: `${(t.volumen / maxVol) * 100}%` }} />
            </div>
            <div className="flex justify-between text-xs mt-1">
              <span className="text-[#65676b] dark:text-[#b0b3b8]">Erledigt</span>
              <span className={`font-bold ${t.erledigungsrate >= 70 ? "text-[#00a400]" : t.erledigungsrate >= 40 ? "text-[#f7b928]" : "text-[#fa3e3e]"}`}>
                {t.erledigungsrate}%
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[#65676b] dark:text-[#b0b3b8]">Bedarf</span>
              <span className={`font-bold ${t.bedarfQuote <= 20 ? "text-[#00a400]" : t.bedarfQuote <= 40 ? "text-[#f7b928]" : "text-[#fa3e3e]"}`}>
                {t.bedarfQuote}%
              </span>
            </div>
            {t.avgWartezeitH > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-[#65676b] dark:text-[#b0b3b8]">Ø Wartezeit</span>
                <span className="font-bold text-[#65676b] dark:text-[#b0b3b8]">{t.avgWartezeitH}h</span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Hauptseite ────────────────────────────────────────────────────────────────

export default function StatistikenPage() {
  const [filter,    setFilter]    = useState<FilterRange>("monat");
  const [kuerzel,   setKuerzel]   = useState<string>(""); // "" = Alle
  const [letzteOff, setLetzteOff] = useState(0);

  const tage     = TAGE_MAP[filter];
  const hatTech  = kuerzel !== "";

  // ── Queries Übersicht (Alle) ───────────────────────────────────────────────
  const kpi         = api.statistik.getKpiOverview.useQuery({ tage }, { enabled: !hatTech });
  const verlaufAlle = api.statistik.getAnfragenVerlauf.useQuery({ tage }, { enabled: !hatTech });
  const statusData  = api.statistik.getAnfragenNachStatus.useQuery(undefined, { enabled: !hatTech });
  const topGeraete  = api.statistik.getMeistgefragteGeraete.useQuery({ tage }, { enabled: !hatTech });
  const topTeile    = api.statistik.getMeistgefragteTeile.useQuery({ tage }, { enabled: !hatTech });
  const teamVergl   = api.statistik.getTechnikerTeamVergleich.useQuery({ tage }, { enabled: !hatTech });

  // ── Queries Techniker-Detail ──────────────────────────────────────────────
  const techKpis      = api.statistik.getTechnikerKpis.useQuery({ kuerzel, tage }, { enabled: hatTech });
  const verlaufTech   = api.statistik.getAnfragenVerlauf.useQuery({ tage, kuerzel }, { enabled: hatTech });
  const techTeile     = api.statistik.getTechnikerTeile.useQuery({ kuerzel, tage }, { enabled: hatTech });
  const techGeraete   = api.statistik.getTechnikerGeraete.useQuery({ kuerzel, tage }, { enabled: hatTech });
  const techWochentag = api.statistik.getTechnikerWochentage.useQuery({ kuerzel, tage: 90 }, { enabled: hatTech });
  const techTageszeit = api.statistik.getTechnikerTageszeiten.useQuery({ kuerzel, tage: 90 }, { enabled: hatTech });
  const letzteAnfr    = api.statistik.getTechnikerLetzteAnfragen.useQuery(
    { kuerzel, tage, limit: 15, offset: letzteOff },
    { enabled: hatTech },
  );

  // Techniker-Liste für Selector
  const techList = api.statistik.getTechnikerTeamVergleich.useQuery({ tage: 365 });
  const techniker = techList.data?.map((t) => t.techniker) ?? [];

  return (
    <div className="space-y-5">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Statistiken</h1>
        <div className="flex gap-3 flex-wrap items-center">
          {/* Zeitfilter */}
          <div className="flex bg-white dark:bg-[#242526] border border-[#ced4da] dark:border-[#3e4042] rounded-xl overflow-hidden">
            {FILTER_OPTS.map(({ key, label }) => (
              <button key={key} onClick={() => setFilter(key)}
                className={`px-4 py-2 text-sm font-semibold transition-colors ${
                  filter === key
                    ? "bg-[#0064d2] text-white"
                    : "text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"
                }`}>
                {label}
              </button>
            ))}
          </div>
          {/* Techniker-Selector */}
          <select
            value={kuerzel}
            onChange={(e) => { setKuerzel(e.target.value); setLetzteOff(0); }}
            className="px-4 py-2 rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-sm text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]"
          >
            <option value="">👥 Alle Techniker</option>
            {techniker.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          ANSICHT A — ALLE TECHNIKER (Übersicht)
          ══════════════════════════════════════════════════════════════════ */}
      {!hatTech && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            {kpi.isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} />)
            ) : (
              <>
                <StatCard title="Anfragen gesamt"  value={kpi.data?.gesamtAnfragen ?? 0}  icon="🔔" color="primary" />
                <StatCard title="Erledigt"          value={kpi.data?.abgeschlossen ?? 0}   icon="✅" color="success"
                  sub={`${kpi.data?.erledigungsquote ?? 0}% Erledigungsrate`} />
                <StatCard title="Bedarf / Offen"    value={kpi.data?.bedarf ?? 0}           icon="⏳" color="warning" />
                <StatCard title="Storniert"         value={kpi.data?.storniert ?? 0}        icon="❌" color="danger" />
              </>
            )}
          </div>

          {/* Anfragen-Verlauf + Status */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            <div className="xl:col-span-2"><Panel title="Anfragen-Verlauf" sub="Täglich">
              <div className="flex gap-4 text-xs mb-1">
                <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-[#0064d2] inline-block" />Anfragen</span>
                <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-[#00a400] inline-block" />Erledigt</span>
                <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-[#f7b928] inline-block" />Bedarf</span>
              </div>
              {verlaufAlle.isLoading && <Skeleton h="h-20" />}
              {verlaufAlle.data && <AnfragenVerlauf data={verlaufAlle.data} />}
            </Panel></div>

            <Panel title="Status-Verteilung">
              {statusData.isLoading && <Skeleton h="h-20" />}
              {statusData.data && (
                <HBarChart items={statusData.data.map((s) => ({ label: s.status, value: s.anzahl }))} />
              )}
            </Panel>
          </div>

          {/* Top Geräte + Teile */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <Panel title="Top Geräte" sub={`Letzte ${tage} Tage`}>
              {topGeraete.isLoading && <Skeleton h="h-32" />}
              {topGeraete.data && (
                <HBarChart items={topGeraete.data.map((g) => ({ label: g.geraet, value: g.anzahl }))} />
              )}
            </Panel>
            <Panel title="Top Ersatzteile" sub={`Letzte ${tage} Tage`}>
              {topTeile.isLoading && <Skeleton h="h-32" />}
              {topTeile.data && (
                <HBarChart items={topTeile.data.map((t) => ({ label: t.teil, value: t.anzahl }))} />
              )}
            </Panel>
          </div>

          {/* Team-Vergleich */}
          <Panel title="Team-Vergleich" sub="Anfragen-Volumen · Erledigungsrate · Bedarf-Quote · Ø Wartezeit">
            {teamVergl.isLoading && <Skeleton h="h-28" />}
            {teamVergl.data && <TeamVergleich data={teamVergl.data} />}
          </Panel>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          ANSICHT B — EINZELNER TECHNIKER (Detail)
          ══════════════════════════════════════════════════════════════════ */}
      {hatTech && (
        <>
          {/* Techniker-Badge */}
          <div className="flex items-center gap-3 px-4 py-3 bg-[#0064d2]/10 border border-[#0064d2]/30 rounded-xl">
            <div className="w-10 h-10 rounded-full bg-[#0064d2] text-white font-black text-sm flex items-center justify-center flex-shrink-0">
              {kuerzel.slice(0, 2)}
            </div>
            <div>
              <div className="font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Techniker: {kuerzel}</div>
              <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">Letzte {tage} Tage · nur Anfragen-Daten</div>
            </div>
            <button onClick={() => setKuerzel("")}
              className="ml-auto text-[#65676b] hover:text-[#fa3e3e] text-lg font-bold transition-colors">
              ×
            </button>
          </div>

          {/* Persönliche KPIs */}
          {techKpis.isLoading ? (
            <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} />)}
            </div>
          ) : techKpis.data ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
              <StatCard title="Gesamt"        value={techKpis.data.gesamt}          icon="🔔" color="primary" />
              <StatCard title="Erledigungsrate" value={`${techKpis.data.erledigungsrate}%`} icon="✅" color="success"
                sub={`${techKpis.data.abgeschlossen} erledigt`} />
              <StatCard title="Bedarf-Quote"  value={`${techKpis.data.bedarfQuote}%`}      icon="⏳" color="warning"
                sub={techKpis.data.bedarfQuote <= 20 ? "Gut" : techKpis.data.bedarfQuote <= 40 ? "OK" : "Hoch"} />
              <StatCard title="Storniert"     value={techKpis.data.storniert}       icon="❌" color="danger" />
              <StatCard title="Ø Wartezeit"   value={`${techKpis.data.avgWartezeitH}h`}     icon="⏱️" color="purple"
                sub="bis Abschluss" />
              <StatCard title="Aktivste Woche" value={techKpis.data.aktivsteWoche}  icon="📅" color="primary"
                sub={`${techKpis.data.aktivsteWocheAnzahl} Anfragen`} />
            </div>
          ) : null}

          {/* Anfragen-Verlauf */}
          <Panel title="Anfragen-Verlauf" sub={`${kuerzel} · täglich`}>
            <div className="flex gap-4 text-xs mb-1">
              <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-[#0064d2] inline-block" />Anfragen</span>
              <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-[#00a400] inline-block" />Erledigt</span>
              <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-[#f7b928] inline-block" />Bedarf</span>
            </div>
            {verlaufTech.isLoading && <Skeleton h="h-20" />}
            {verlaufTech.data && <AnfragenVerlauf data={verlaufTech.data} />}
          </Panel>

          {/* Wochentag + Tageszeit */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <Panel title="Wochentag-Analyse" sub="90 Tage — wann fragt er an?">
              {techWochentag.isLoading && <Skeleton h="h-24" />}
              {techWochentag.data && <VBarChart items={techWochentag.data.map((d) => ({ label: d.tag, anzahl: d.anzahl }))} />}
            </Panel>
            <Panel title="Tageszeit-Analyse" sub="90 Tage — zu welcher Uhrzeit?">
              {techTageszeit.isLoading && <Skeleton h="h-24" />}
              {techTageszeit.data && (
                <VBarChart
                  items={techTageszeit.data
                    .filter((d) => d.anzahl > 0 || d.stunde % 4 === 0)
                    .map((d) => ({ label: `${d.stunde}h`, anzahl: d.anzahl }))}
                />
              )}
            </Panel>
          </div>

          {/* Top Teile + Top Geräte */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <Panel title="Top Ersatzteile" sub="🟡 = Bedarf-Anteil (nicht auf Lager)">
              {techTeile.isLoading && <Skeleton h="h-32" />}
              {techTeile.data && (
                <HBarChart
                  showBedarf
                  items={techTeile.data.map((t) => ({
                    label:       t.teil,
                    value:       t.anzahl,
                    bedarfValue: t.bedarfAnzahl,
                  }))}
                />
              )}
            </Panel>
            <Panel title="Top Geräte">
              {techGeraete.isLoading && <Skeleton h="h-32" />}
              {techGeraete.data && (
                <HBarChart items={techGeraete.data.map((g) => ({ label: g.name || g.geraet, value: g.anzahl }))} />
              )}
            </Panel>
          </div>

          {/* Letzte Anfragen */}
          <Panel title="Letzte Anfragen">
            {letzteAnfr.isLoading && <Skeleton h="h-40" />}
            {letzteAnfr.data && (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] border-b border-[#ced4da] dark:border-[#3e4042]">
                        <th className="text-left py-2 pr-3">Datum</th>
                        <th className="text-left py-2 px-3">Teil</th>
                        <th className="text-left py-2 px-3">Gerät</th>
                        <th className="text-left py-2 px-3">LogID</th>
                        <th className="text-left py-2 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f0f2f5] dark:divide-[#3e4042]">
                      {letzteAnfr.data.anfragen.map((a) => (
                        <tr key={a.id} className="hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] transition-colors">
                          <td className="py-2 pr-3 text-[#65676b] dark:text-[#b0b3b8] text-xs whitespace-nowrap">
                            {new Date(a.datum).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                          </td>
                          <td className="py-2 px-3 font-semibold text-[#1a1a1a] dark:text-[#e4e6eb] max-w-[140px] truncate">{a.teil}</td>
                          <td className="py-2 px-3 text-[#65676b] dark:text-[#b0b3b8] text-xs max-w-[120px] truncate">{a.geraeteName ?? a.geraet}</td>
                          <td className="py-2 px-3 font-mono text-xs text-[#65676b] dark:text-[#b0b3b8]">{a.logId}</td>
                          <td className="py-2 px-3"><StatusBadge status={a.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Pagination */}
                {letzteAnfr.data.total > 15 && (
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#ced4da] dark:border-[#3e4042]">
                    <span className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
                      {letzteOff + 1}–{Math.min(letzteOff + 15, letzteAnfr.data.total)} von {letzteAnfr.data.total}
                    </span>
                    <div className="flex gap-2">
                      <button onClick={() => setLetzteOff(Math.max(0, letzteOff - 15))} disabled={letzteOff === 0}
                        className="px-3 py-1 text-xs rounded-lg border border-[#ced4da] dark:border-[#3e4042] disabled:opacity-40 hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors">
                        ←
                      </button>
                      <button onClick={() => setLetzteOff(letzteOff + 15)} disabled={letzteOff + 15 >= letzteAnfr.data.total}
                        className="px-3 py-1 text-xs rounded-lg border border-[#ced4da] dark:border-[#3e4042] disabled:opacity-40 hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors">
                        →
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}


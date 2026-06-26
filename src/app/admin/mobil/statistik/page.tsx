"use client";

import Link from "next/link";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, LineChart, Line, CartesianGrid,
} from "recharts";
import { api } from "@/trpc/react";
import { usePermissions } from "@/hooks/usePermissions";

// AfB-Hausfarben + abgeleitete Palette für Mehrkategorien-Diagramme.
const AFB = { dunkelblau: "#202F61", blau: "#008BD2", gruen: "#04B475" } as const;
const PALETTE = ["#008BD2", "#04B475", "#202F61", "#45a8d8", "#0a8f5e", "#5b6aa0", "#7ec8ec", "#BA7517", "#8B5CF6", "#EC4899"];
const ROT = "#EF4444";

const cardCls = "bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm";

function nf(n: number): string { return n.toLocaleString("de-DE"); }
function eur(n: number): string { return n.toLocaleString("de-DE", { style: "currency", currency: "EUR" }); }
function fmtDatum(d: Date | string): string {
  return new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export default function MobilStatistikPage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const enabled = !permsLoading && has("MOBIL_VIEW");

  const kpisQ        = api.mobil.statKpis.useQuery(undefined, { enabled });
  const topQ         = api.mobil.statTopModelle.useQuery({ limit: 10 }, { enabled });
  const teiltypQ     = api.mobil.statTeiltypVerteilung.useQuery(undefined, { enabled });
  const herstellerQ  = api.mobil.statBestandProHersteller.useQuery(undefined, { enabled });
  const lagerwertQ   = api.mobil.statLagerwert.useQuery(undefined, { enabled });
  const ausgeschQ    = api.mobil.statAusgeschieden.useQuery({ limit: 10 }, { enabled });
  const unterQ       = api.mobil.statUnterMindestbestand.useQuery(undefined, { enabled });
  const verlaufQ     = api.mobil.statVerlauf.useQuery(undefined, { enabled });

  if (permsLoading) {
    return <div role="status" className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">⏳ Lade Berechtigungen…</div>;
  }
  if (!has("MOBIL_VIEW")) {
    return (
      <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">
        Kein Zugriff. Bitte das Recht <strong>MOBIL_VIEW</strong> bei der Rolle aktivieren.
      </div>
    );
  }

  const top        = topQ.data ?? [];
  const teiltypen  = teiltypQ.data ?? [];
  const hersteller = herstellerQ.data ?? [];
  const ausgesch   = ausgeschQ.data;
  const unter      = unterQ.data;
  const verlauf    = verlaufQ.data;

  return (
    <div className="max-w-[1400px] space-y-5">
      {/* Kopf */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/admin/mobil" className="text-[#65676b] hover:text-[#008BD2] text-sm font-semibold">← Mobil-Ersatzteile</Link>
          <h1 className="text-2xl sm:text-3xl font-black text-[#202F61] dark:text-[#e4e6eb]">📊 Mobil-Statistik</h1>
        </div>
      </div>

      {/* KPI-Reihe */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi label="Aktive Teile"  wert={kpisQ.data ? nf(kpisQ.data.aktiveTeile) : "—"} farbe={AFB.dunkelblau} hinweis="im Bestand" laden={kpisQ.isLoading} />
        <Kpi label="Modelle"       wert={kpisQ.data ? nf(kpisQ.data.modelle) : "—"} farbe={AFB.dunkelblau} hinweis="im Katalog" laden={kpisQ.isLoading} />
        <Kpi label="Lagerwert"     wert={kpisQ.data ? eur(kpisQ.data.lagerwert) : "—"} farbe={AFB.blau} hinweis="EK aktiver Teile" laden={kpisQ.isLoading} />
        <Kpi label="Ausgeschieden" wert={kpisQ.data ? nf(kpisQ.data.ausgeschieden) : "—"} farbe={AFB.gruen} hinweis="ausgeliefert/gebraucht" laden={kpisQ.isLoading} />
        <Kpi
          label="Unter Mindest"
          wert={kpisQ.data ? nf(kpisQ.data.unterMindestbestand) : "—"}
          farbe={(kpisQ.data?.unterMindestbestand ?? 0) > 0 ? ROT : AFB.gruen}
          hinweis="Gruppen unter Soll"
          laden={kpisQ.isLoading}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Top-10 Modelle nach Bestand */}
        <Karte titel="🏆 Top-10 Modelle nach Bestand">
          <ChartZustand laden={topQ.isLoading} leer={top.length === 0} leerText="Noch keine aktiven Teile.">
            <ResponsiveContainer width="100%" height={Math.max(180, top.length * 34 + 24)}>
              <BarChart data={top} layout="vertical" margin={{ top: 4, right: 28, left: 8, bottom: 4 }}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="modell" tick={{ fontSize: 12, fill: "currentColor" }} width={130} interval={0} />
                <Tooltip formatter={(v) => [nf(Number(v)), "Stück"]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="stueck" radius={[0, 4, 4, 0]}>
                  {top.map((t, i) => <Cell key={t.id} fill={i === 0 ? AFB.blau : "#45a8d8"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <TabelleFallback
              kopf={["#", "Modell", "Hersteller", "Stück", "EK-Summe"]}
              zeilen={top.map((t, i) => [`${i + 1}.`, t.modell, t.hersteller, nf(t.stueck), eur(t.ekSumme)])}
              rechts={[false, false, false, true, true]}
            />
          </ChartZustand>
        </Karte>

        {/* Teiltyp-Verteilung (Donut) */}
        <Karte titel="🧩 Teiltyp-Verteilung">
          <ChartZustand laden={teiltypQ.isLoading} leer={teiltypen.length === 0} leerText="Noch keine zugeordneten Teiltypen.">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={teiltypen}
                  dataKey="anzahl"
                  nameKey="teiltyp"
                  innerRadius={56}
                  outerRadius={92}
                  paddingAngle={2}
                  stroke="none"
                >
                  {teiltypen.map((t, i) => <Cell key={t.teiltyp} fill={PALETTE[i % PALETTE.length]} />)}
                </Pie>
                <Tooltip formatter={(v, n) => [nf(Number(v)), n as string]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
            {/* Legende mit Farbe + Wert (zugleich Text-Alternative) */}
            <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
              {teiltypen.map((t, i) => (
                <li key={t.teiltyp} className="flex items-center gap-2 text-sm">
                  <span aria-hidden className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                  <span className="flex-1 truncate text-[#1a1a1a] dark:text-[#e4e6eb]">{t.teiltyp}</span>
                  <span className="font-black tabular-nums text-[#202F61] dark:text-[#e4e6eb]">{nf(t.anzahl)}</span>
                </li>
              ))}
            </ul>
          </ChartZustand>
        </Karte>

        {/* Bestand + EK pro Hersteller */}
        <Karte titel="🏭 Bestand pro Hersteller">
          <ChartZustand laden={herstellerQ.isLoading} leer={hersteller.length === 0} leerText="Noch keine zugeordneten Teile.">
            <ResponsiveContainer width="100%" height={Math.max(180, hersteller.length * 38 + 24)}>
              <BarChart data={hersteller} layout="vertical" margin={{ top: 4, right: 28, left: 8, bottom: 4 }}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="hersteller" tick={{ fontSize: 12, fill: "currentColor" }} width={110} interval={0} />
                <Tooltip
                  formatter={(v, n) => n === "anzahl" ? [nf(Number(v)), "Stück"] : [eur(Number(v)), "EK-Summe"]}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Bar dataKey="anzahl" radius={[0, 4, 4, 0]}>
                  {hersteller.map((h, i) => <Cell key={h.hersteller} fill={PALETTE[i % PALETTE.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <TabelleFallback
              kopf={["Hersteller", "Stück", "EK-Summe"]}
              zeilen={hersteller.map((h) => [h.hersteller, nf(h.anzahl), eur(h.ekSumme)])}
              rechts={[false, true, true]}
              fuss={lagerwertQ.data ? ["Lagerwert gesamt", "", eur(lagerwertQ.data.gesamt)] : undefined}
            />
          </ChartZustand>
        </Karte>

        {/* Ausgeschiedene Teile je Teiltyp */}
        <Karte titel="📤 Ausgeschieden je Teiltyp" untertitel={ausgesch ? `${nf(ausgesch.gesamt)} Teile insgesamt ausgeliefert/gebraucht` : undefined}>
          <ChartZustand
            laden={ausgeschQ.isLoading}
            leer={!ausgesch || ausgesch.jeTeiltyp.length === 0}
            leerText="Noch nichts ausgeschieden — Abgänge erscheinen hier nach künftigen Importen."
          >
            <ResponsiveContainer width="100%" height={Math.max(160, (ausgesch?.jeTeiltyp.length ?? 0) * 32 + 24)}>
              <BarChart data={ausgesch?.jeTeiltyp ?? []} layout="vertical" margin={{ top: 4, right: 28, left: 8, bottom: 4 }}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="teiltyp" tick={{ fontSize: 12, fill: "currentColor" }} width={130} interval={0} />
                <Tooltip formatter={(v) => [nf(Number(v)), "ausgeschieden"]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="anzahl" fill={AFB.gruen} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
            {ausgesch && ausgesch.jeModell.length > 0 && (
              <TabelleFallback
                titel="Top-Modelle (ausgeschieden)"
                kopf={["Modell", "Hersteller", "Anzahl"]}
                zeilen={ausgesch.jeModell.map((m) => [m.modell, m.hersteller, nf(m.anzahl)])}
                rechts={[false, false, true]}
              />
            )}
          </ChartZustand>
        </Karte>
      </div>

      {/* Gruppen unter Mindestbestand */}
      <Karte titel="⚠️ Unter Mindestbestand" untertitel={unter ? `${nf(unter.anzahl)} ${unter.anzahl === 1 ? "Gruppe" : "Gruppen"}` : undefined}>
        <ChartZustand laden={unterQ.isLoading} leer={!unter || unter.anzahl === 0} leerText="✓ Alle gepflegten Mindestbestände erfüllt.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#f0f2f5] dark:bg-[#18191a] text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8]">
                <tr>
                  <th className="px-4 py-2 text-left">Modell</th>
                  <th className="px-4 py-2 text-left">Hersteller</th>
                  <th className="px-4 py-2 text-left">Teiltyp</th>
                  <th className="px-4 py-2 text-right">Ist</th>
                  <th className="px-4 py-2 text-right">Soll</th>
                  <th className="px-4 py-2 text-right">Fehlt</th>
                </tr>
              </thead>
              <tbody>
                {(unter?.gruppen ?? []).map((g) => (
                  <tr key={`${g.hersteller}-${g.modell}-${g.teiltyp}`} className="border-t border-[#ced4da] dark:border-[#3e4042]">
                    <td className="px-4 py-2 font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">{g.modell}</td>
                    <td className="px-4 py-2 text-[#65676b] dark:text-[#b0b3b8]">{g.hersteller}</td>
                    <td className="px-4 py-2 text-[#65676b] dark:text-[#b0b3b8]">{g.teiltyp}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-[#1a1a1a] dark:text-[#e4e6eb]">{nf(g.ist)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-[#65676b] dark:text-[#b0b3b8]">{nf(g.soll)}</td>
                    <td className="px-4 py-2 text-right font-black tabular-nums" style={{ color: ROT }}>−{nf(g.fehlt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartZustand>
      </Karte>

      {/* Bestandsverlauf über Import-Zeitpunkte (oder Platzhalter) */}
      <Karte titel="📈 Bestandsverlauf über Importe">
        {verlaufQ.isLoading ? (
          <Laden />
        ) : !verlauf?.genugDaten ? (
          <div className="rounded-xl border border-dashed border-[#ced4da] dark:border-[#3e4042] p-6 text-center">
            <p className="text-base font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">Verlauf füllt sich mit jedem Import</p>
            <p className="mt-1 text-sm text-[#65676b] dark:text-[#b0b3b8]">
              Für eine Verlaufskurve werden mindestens 2 Import-Zeitpunkte gebraucht
              {" "}(aktuell {nf(verlauf?.zeitpunkte ?? 0)}). Nach dem nächsten Import erscheint hier die Kurve.
            </p>
          </div>
        ) : (
          <>
            <p className="mb-2 text-sm text-[#65676b] dark:text-[#b0b3b8]">
              Je Import-Zeitpunkt die Anzahl zuletzt erfasster Teile — der jüngste Punkt entspricht dem aktuellen Bestand.
            </p>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={verlauf.punkte.map((p) => ({ label: fmtDatum(p.zeitpunkt), erfasst: p.erfasst }))} margin={{ top: 4, right: 16, left: -8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ced4da55" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "currentColor" }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11, fill: "currentColor" }} allowDecimals={false} />
                <Tooltip formatter={(v) => [nf(Number(v)), "Teile"]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Line type="monotone" dataKey="erfasst" stroke={AFB.blau} strokeWidth={2.5} dot={{ r: 3, fill: AFB.blau }} />
              </LineChart>
            </ResponsiveContainer>
            <TabelleFallback
              kopf={["Import-Zeitpunkt", "Teile erfasst"]}
              zeilen={verlauf.punkte.map((p) => [fmtDatum(p.zeitpunkt), nf(p.erfasst)])}
              rechts={[false, true]}
            />
          </>
        )}
      </Karte>
    </div>
  );
}

// ── Bausteine ───────────────────────────────────────────────────────────────────

function Kpi({ label, wert, farbe, hinweis, laden }: { label: string; wert: string; farbe: string; hinweis: string; laden: boolean }) {
  return (
    <div className={`${cardCls} p-4`}>
      <div className="text-xs font-bold uppercase tracking-wide text-[#65676b] dark:text-[#b0b3b8]">{label}</div>
      <div className="text-2xl sm:text-3xl font-black mt-1 tabular-nums truncate" style={{ color: farbe }} title={wert}>
        {laden ? "…" : wert}
      </div>
      <div className="text-[11px] text-[#65676b] dark:text-[#b0b3b8] mt-0.5">{hinweis}</div>
    </div>
  );
}

function Karte({ titel, untertitel, children }: { titel: string; untertitel?: string; children: React.ReactNode }) {
  return (
    <section className={`${cardCls} overflow-hidden`}>
      <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042]">
        <h2 className="font-black text-[#1a1a1a] dark:text-[#e4e6eb]">{titel}</h2>
        {untertitel && <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-0.5">{untertitel}</p>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Laden() {
  return <div role="status" className="text-sm text-[#65676b] dark:text-[#b0b3b8] text-center py-8">⏳ Lädt…</div>;
}

// Lade-/Leer-/Inhalt-Umschalter für ein Diagramm.
function ChartZustand({ laden, leer, leerText, children }: { laden: boolean; leer: boolean; leerText: string; children: React.ReactNode }) {
  if (laden) return <Laden />;
  if (leer) return <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] text-center py-8">{leerText}</p>;
  return <>{children}</>;
}

// Text-/Tabellen-Alternative unter jedem Diagramm (Barrierefreiheit + Genauigkeit).
function TabelleFallback({
  titel, kopf, zeilen, rechts, fuss,
}: {
  titel?: string;
  kopf: string[];
  zeilen: string[][];
  rechts: boolean[];
  fuss?: string[];
}) {
  if (zeilen.length === 0) return null;
  return (
    <div className="mt-3">
      {titel && <div className="text-xs font-bold uppercase tracking-wide text-[#65676b] dark:text-[#b0b3b8] mb-1">{titel}</div>}
      <div className="overflow-x-auto rounded-lg border border-[#f0f2f5] dark:border-[#3e4042]">
        <table className="w-full text-sm">
          <thead className="bg-[#f0f2f5] dark:bg-[#18191a] text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8]">
            <tr>
              {kopf.map((k, i) => (
                <th key={k} className={`px-3 py-2 ${rechts[i] ? "text-right" : "text-left"}`}>{k}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {zeilen.map((z, ri) => (
              <tr key={ri} className="border-t border-[#f0f2f5] dark:border-[#3e4042]">
                {z.map((c, ci) => (
                  <td key={ci} className={`px-3 py-1.5 ${rechts[ci] ? "text-right tabular-nums" : "text-left"} text-[#1a1a1a] dark:text-[#e4e6eb]`}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
          {fuss && (
            <tfoot>
              <tr className="border-t-2 border-[#ced4da] dark:border-[#3e4042] font-black">
                {fuss.map((c, ci) => (
                  <td key={ci} className={`px-3 py-2 ${rechts[ci] ? "text-right tabular-nums" : "text-left"} text-[#202F61] dark:text-[#e4e6eb]`}>{c}</td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

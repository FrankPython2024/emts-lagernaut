"use client";

import { useState } from "react";
import Link from "next/link";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { api } from "@/trpc/react";
import { usePermissions } from "@/hooks/usePermissions";
import { PageLoader } from "@/components/ui/LoadingSpinner";

type Zeitraum = "4w" | "3m" | "12m" | "all";
const ZEITRAEUME: { k: Zeitraum; label: string }[] = [
  { k: "4w",  label: "4 Wochen" },
  { k: "3m",  label: "3 Monate" },
  { k: "12m", label: "12 Monate" },
  { k: "all", label: "Alles" },
];

const cardCls = "bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm";

function nf(n: number): string { return n.toLocaleString("de-DE"); }
function fmtDatum(d: Date | string): string {
  return new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export default function VerbrauchsmaterialAuswertungPage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const [zeitraum, setZeitraum] = useState<Zeitraum>("3m");
  const [artikelId, setArtikelId] = useState<number | null>(null);

  const enabled = !permsLoading && has("MATERIAL_VIEW");
  const kpisQ      = api.verbrauchsmaterial.kpis.useQuery({ zeitraum }, { enabled });
  const topQ       = api.verbrauchsmaterial.topVerbrauch.useQuery({ zeitraum }, { enabled });
  const nachbQ     = api.verbrauchsmaterial.nachbestellen.useQuery(undefined, { enabled });
  const artikelQ   = api.verbrauchsmaterial.liste.useQuery({ nurAktive: true }, { enabled });
  const verlaufQ   = api.verbrauchsmaterial.verlauf.useQuery(
    { artikelId: artikelId ?? 0 },
    { enabled: enabled && artikelId != null },
  );

  if (permsLoading) return <PageLoader />;
  if (!has("MATERIAL_VIEW")) {
    return (
      <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">
        Kein Zugriff. Bitte das Recht <strong>MATERIAL_VIEW</strong> bei der Rolle aktivieren.
      </div>
    );
  }

  const top = topQ.data ?? [];
  const maxTop = top.length > 0 ? top[0].verbrauch : 1;
  const nachb = nachbQ.data ?? [];

  const verlaufDaten = (verlaufQ.data?.eintraege ?? []).map((e) => ({
    label:     fmtDatum(e.datum),
    verbrauch: e.verbrauch,
    bestand:   e.bestand,
  }));

  return (
    <div className="max-w-[1400px] space-y-5">
      {/* Kopf */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/admin/verbrauchsmaterial" className="text-[#65676b] hover:text-[#008BD2] text-sm font-semibold">← Verbrauchsmaterial</Link>
          <h1 className="text-2xl font-black text-[#202F61] dark:text-[#e4e6eb]">📊 Auswertung</h1>
        </div>
        {/* Zeitraum-Auswahl (wirkt auf KPIs + Top-10) */}
        <div role="group" aria-label="Zeitraum" className="inline-flex rounded-xl overflow-hidden border border-[#ced4da] dark:border-[#3e4042]">
          {ZEITRAEUME.map(({ k, label }) => (
            <button
              key={k}
              onClick={() => setZeitraum(k)}
              aria-pressed={zeitraum === k}
              className={`px-3 h-10 text-sm font-bold transition-colors ${zeitraum === k ? "bg-[#008BD2] text-white" : "bg-white dark:bg-[#242526] text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI-Zeile */}
      <div className="grid sm:grid-cols-3 gap-3">
        <div className={`${cardCls} p-4`}>
          <div className="text-xs font-bold uppercase tracking-wide text-[#65676b] dark:text-[#b0b3b8]">Artikel gesamt</div>
          <div className="text-3xl font-black text-[#202F61] dark:text-[#e4e6eb] mt-1 tabular-nums">{kpisQ.data ? nf(kpisQ.data.aktivGesamt) : "—"}</div>
          <div className="text-[11px] text-[#65676b] dark:text-[#b0b3b8] mt-0.5">aktiv</div>
        </div>
        <div className={`${cardCls} p-4`} style={{ borderColor: (kpisQ.data?.unterMindest ?? 0) > 0 ? "#EF4444" : undefined }}>
          <div className="text-xs font-bold uppercase tracking-wide text-[#65676b] dark:text-[#b0b3b8]">Nachzubestellen</div>
          <div className="text-3xl font-black mt-1 tabular-nums" style={{ color: (kpisQ.data?.unterMindest ?? 0) > 0 ? "#EF4444" : "#04B475" }}>
            {kpisQ.data ? nf(kpisQ.data.unterMindest) : "—"}
          </div>
          <div className="text-[11px] text-[#65676b] dark:text-[#b0b3b8] mt-0.5">unter Mindestbestand</div>
        </div>
        <div className={`${cardCls} p-4`}>
          <div className="text-xs font-bold uppercase tracking-wide text-[#65676b] dark:text-[#b0b3b8]">Verbrauch im Zeitraum</div>
          <div className="text-3xl font-black text-[#008BD2] dark:text-[#45bdff] mt-1 tabular-nums">{kpisQ.data ? nf(kpisQ.data.gesamtverbrauch) : "—"}</div>
          <div className="text-[11px] text-[#65676b] dark:text-[#b0b3b8] mt-0.5">{ZEITRAEUME.find((z) => z.k === zeitraum)?.label}</div>
        </div>
      </div>

      {/* Mindestbestand-Warnung */}
      <div className={`${cardCls} overflow-hidden`}>
        <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042] flex items-center gap-2"
          style={{ background: nachb.length > 0 ? "rgba(239,68,68,0.08)" : undefined }}>
          <span aria-hidden>{nachb.length > 0 ? "⚠️" : "✓"}</span>
          <h2 className="font-black text-[#1a1a1a] dark:text-[#e4e6eb]">
            Nachbestellen{nachb.length > 0 ? ` — ${nachb.length} ${nachb.length === 1 ? "Artikel" : "Artikel"}` : ""}
          </h2>
        </div>
        {nachbQ.isLoading ? (
          <div className="px-5 py-6 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">Lädt…</div>
        ) : nachb.length === 0 ? (
          <div className="px-5 py-6 text-center text-sm text-[#04713f]">Alles über Mindestbestand — nichts nachzubestellen. 🎉</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#f0f2f5] dark:bg-[#18191a] text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8]">
                <tr>
                  <th className="px-4 py-2 text-left">Artikel</th>
                  <th className="px-4 py-2 text-left">Kategorie</th>
                  <th className="px-4 py-2 text-left">Standort</th>
                  <th className="px-4 py-2 text-right">Bestand</th>
                  <th className="px-4 py-2 text-right">Mindest</th>
                  <th className="px-4 py-2 text-right">Fehlt</th>
                  <th className="px-4 py-2 text-left">AAN</th>
                </tr>
              </thead>
              <tbody>
                {nachb.map((a) => (
                  <tr key={a.id} className="border-t border-[#ced4da] dark:border-[#3e4042]">
                    <td className="px-4 py-2 font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">{a.name}</td>
                    <td className="px-4 py-2 text-[#65676b] dark:text-[#b0b3b8]">{a.kategorie ?? "—"}</td>
                    <td className="px-4 py-2 text-[#65676b] dark:text-[#b0b3b8]">{a.standort ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-[#1a1a1a] dark:text-[#e4e6eb]">{nf(a.aktuellerBestand)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-[#65676b] dark:text-[#b0b3b8]">{nf(a.mindestbestand)}</td>
                    <td className="px-4 py-2 text-right font-black tabular-nums text-[#EF4444]">−{nf(a.fehlt)}</td>
                    <td className="px-4 py-2 font-mono text-xs text-[#65676b] dark:text-[#b0b3b8]">{a.aan ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Top-10-Verbrauch */}
        <div className={`${cardCls} overflow-hidden`}>
          <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042]">
            <h2 className="font-black text-[#1a1a1a] dark:text-[#e4e6eb]">🏆 Top 10 Verbrauch</h2>
          </div>
          <div className="p-4">
            {topQ.isLoading ? (
              <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] text-center py-6">Lädt…</p>
            ) : top.length === 0 ? (
              <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] text-center py-6">Kein Verbrauch im Zeitraum.</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={Math.max(160, top.length * 34 + 20)}>
                  <BarChart data={top} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                    <XAxis type="number" hide allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "currentColor" }} width={150} interval={0} />
                    <Tooltip formatter={(v) => [nf(Number(v)), "Verbrauch"]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Bar dataKey="verbrauch" radius={[0, 4, 4, 0]}>
                      {top.map((t, i) => (
                        <Cell key={t.artikelId} fill={i === 0 ? "#008BD2" : "#45a8d8"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <ol className="mt-2 space-y-1">
                  {top.map((t, i) => (
                    <li key={t.artikelId} className="flex items-center gap-2 text-sm">
                      <span className="w-5 text-right font-black text-[#65676b] dark:text-[#b0b3b8]">{i + 1}.</span>
                      <button
                        onClick={() => setArtikelId(t.artikelId)}
                        className="flex-1 min-w-0 text-left truncate text-[#0064d2] dark:text-[#45bdff] hover:underline"
                        title="Verlauf anzeigen"
                      >
                        {t.name}
                      </button>
                      <span className="font-black tabular-nums text-[#1a1a1a] dark:text-[#e4e6eb]">{nf(t.verbrauch)}</span>
                    </li>
                  ))}
                </ol>
                <div className="sr-only">Maximalwert {nf(maxTop)}</div>
              </>
            )}
          </div>
        </div>

        {/* Verlauf je Artikel */}
        <div className={`${cardCls} overflow-hidden`}>
          <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042] flex items-center justify-between gap-3 flex-wrap">
            <h2 className="font-black text-[#1a1a1a] dark:text-[#e4e6eb]">📈 Verlauf je Artikel</h2>
            <select
              value={artikelId ?? ""}
              onChange={(e) => setArtikelId(e.target.value ? Number(e.target.value) : null)}
              className="px-3 h-10 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] max-w-[220px]"
            >
              <option value="">Artikel wählen…</option>
              {(artikelQ.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div className="p-4">
            {artikelId == null ? (
              <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] text-center py-6">Artikel wählen, um den Verbrauch über die Wochen zu sehen.</p>
            ) : verlaufQ.isLoading ? (
              <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] text-center py-6">Lädt…</p>
            ) : verlaufDaten.length === 0 ? (
              <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] text-center py-6">Noch keine Zählungen für diesen Artikel.</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={verlaufDaten} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "currentColor" }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11, fill: "currentColor" }} allowDecimals={false} />
                    <Tooltip
                      formatter={(v, name) => [nf(Number(v)), name === "verbrauch" ? "Verbrauch" : "Bestand"]}
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    />
                    <Bar dataKey="verbrauch" fill="#008BD2" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-3 max-h-48 overflow-y-auto border border-[#f0f2f5] dark:border-[#3e4042] rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-[#f0f2f5] dark:bg-[#18191a] text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left">Datum</th>
                        <th className="px-3 py-2 text-right">Verbrauch</th>
                        <th className="px-3 py-2 text-right">Bestand</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...verlaufDaten].reverse().map((e, i) => (
                        <tr key={i} className="border-t border-[#f0f2f5] dark:border-[#3e4042]">
                          <td className="px-3 py-1.5 text-[#1a1a1a] dark:text-[#e4e6eb]">{e.label}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-bold text-[#BA7517]">{e.verbrauch > 0 ? nf(e.verbrauch) : "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-[#1a1a1a] dark:text-[#e4e6eb]">{nf(e.bestand)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

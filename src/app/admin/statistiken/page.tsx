"use client";
import { useEffect, useState } from "react";
import { AnfrageStatus } from "@prisma/client";
import { api } from "@/trpc/react";
import { StatCard } from "@/components/ui/StatCard";
import { useStandortFilter } from "@/lib/standort/standortContext";
import { useSocket } from "@/hooks/useSocket";
import { EVENTS } from "@/modules/realtime/events";
import { DashboardAnsicht } from "./DashboardAnsicht";

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
  NEU:              "bg-[#0064d2]  text-white",
  BEDARF:           "bg-[#f7b928]  text-white",
  IN_BEARBEITUNG:   "bg-[#d97706]  text-white",
  ABGESCHLOSSEN:    "bg-[#00a400]  text-white",
  STORNIERT:        "bg-[#fa3e3e]  text-white",
  NICHT_VERFUEGBAR: "bg-[#f97316]  text-white",
};

// Hex-Varianten für eingefärbte Balken (Status-Verteilung)
const STATUS_HEX: Record<string, string> = {
  NEU:              "#0064d2",
  BEDARF:           "#f7b928",
  IN_BEARBEITUNG:   "#d97706",
  ABGESCHLOSSEN:    "#00a400",
  STORNIERT:        "#fa3e3e",
  NICHT_VERFUEGBAR: "#f97316",
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

// ── Wert ausgegeben (Laptop-Teile über Anfragen) ──────────────────────────────

function euro(n: number): string {
  return n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

function WertAusgegebenPanel({ tage, standortId }: { tage: number; standortId: number | null | undefined }) {
  const q = api.preise.wertAusgegeben.useQuery({ tage, standortId: standortId ?? null });
  return (
    <Panel title="💸 Wert ausgegeben" sub={`Teile (AUSGANG + Bedarf) × Kategorie-Preis + Sonderanfragen (Pauschale/Review) · letzte ${tage} Tage`}>
      {q.isLoading && <Skeleton h="h-40" />}
      {q.data && (
        <>
          <div className="mb-4">
            <div className="text-3xl font-black tabular-nums text-[#00a400]">{euro(q.data.gesamt)}</div>
            <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
              🧩 {q.data.mengeGesamt.toLocaleString("de-DE")} Teile ({euro(q.data.teileWert)}) · {q.data.proKategorie.length} Kategorien bewertet
            </div>
            {q.data.sonderanfragen.anzahl > 0 && (
              <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
                💬 {q.data.sonderanfragen.anzahl.toLocaleString("de-DE")} Sonderanfragen ({euro(q.data.sonderanfragen.wert)})
                {q.data.sonderanfragen.pauschal > 0 && (
                  <> · {q.data.sonderanfragen.pauschal}× Pauschale {euro(q.data.sonderanfragen.pauschale)}</>
                )}
                {" "}
                <a href="/admin/sonderanfragen" className="underline font-semibold">bewerten</a>
              </div>
            )}
          </div>

          {q.data.proKategorie.length === 0 ? (
            <Empty />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] border-b border-[#ced4da] dark:border-[#3e4042]">
                    <th className="text-left py-2 pr-3">Kategorie</th>
                    <th className="text-right py-2 px-3">Menge</th>
                    <th className="text-right py-2 px-3">Preis</th>
                    <th className="text-right py-2 pl-3">Wert</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0f2f5] dark:divide-[#3e4042]">
                  {q.data.proKategorie.map((r) => (
                    <tr key={r.kategorie}>
                      <td className="py-2 pr-3 font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">{r.kategorie}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-[#65676b] dark:text-[#b0b3b8]">{r.menge.toLocaleString("de-DE")}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-[#65676b] dark:text-[#b0b3b8]">{euro(r.preis)}</td>
                      <td className="py-2 pl-3 text-right tabular-nums font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{euro(r.wert)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {q.data.ohnePreis.length > 0 && (
            <div className="mt-3 text-xs text-[#f7b928]">
              ⚠️ {q.data.ohnePreis.length} Kategorien ohne Preis (nicht enthalten):{" "}
              {q.data.ohnePreis.map((o) => `${o.kategorie} (${o.menge})`).join(", ")} —{" "}
              <a href="/admin/preise" className="underline font-semibold">Preise ergänzen</a>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

// ── Abgaben an andere Niederlassungen ────────────────────────────────────────
// Bewusst ein eigenes Panel und NICHT in „Wert ausgegeben" eingerechnet: Das ist
// kein Verbrauch durch die eigene Technik, sondern Material, das das Haus
// verlässt. Zusammengezählt wären beide Zahlen nicht mehr interpretierbar.

function AbgabenPanel({ tage, standortId }: { tage: number; standortId: number | null | undefined }) {
  const q = api.abgaben.auswertung.useQuery({ tage, standortId: standortId ?? null });
  return (
    <Panel title="🚚 Abgaben an Niederlassungen" sub={`Material an andere Standorte der Gruppe · statistischer Wert · letzte ${tage} Tage`}>
      {q.isLoading && <Skeleton h="h-32" />}
      {q.data && (
        <>
          <div className="mb-4">
            <div className="text-3xl font-black tabular-nums text-[#008BD2]">{euro(q.data.gesamtWert)}</div>
            <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
              📦 {q.data.gesamtMenge.toLocaleString("de-DE")} Stück abgegeben
              {q.data.proNiederlassung.length > 0 && <> · {q.data.proNiederlassung.length} Niederlassungen</>}
            </div>
            {q.data.ohnePreis > 0 && (
              <div className="text-xs text-[#f7b928] mt-0.5">
                ⚠️ {q.data.ohnePreis.toLocaleString("de-DE")} Stück ohne hinterlegten Preis — nicht im Wert enthalten
              </div>
            )}
          </div>

          {q.data.proNiederlassung.length === 0 ? (
            <Empty />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] border-b border-[#ced4da] dark:border-[#3e4042]">
                    <th className="text-left py-2 pr-3">Niederlassung</th>
                    <th className="text-right py-2 px-3">Stück</th>
                    <th className="text-right py-2 pl-3">ca. Wert</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0f2f5] dark:divide-[#3e4042]">
                  {q.data.proNiederlassung.map((z) => (
                    <tr key={z.id}>
                      <td className="py-2 pr-3 font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">{z.name}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-[#65676b] dark:text-[#b0b3b8]">
                        {z.menge.toLocaleString("de-DE")}
                      </td>
                      <td className="py-2 pl-3 text-right tabular-nums font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{euro(z.wert)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-3 text-xs text-[#65676b] dark:text-[#b0b3b8]">
            Einzeln erfassen und verwalten unter{" "}
            <a href="/admin/abgaben" className="underline font-semibold">Abgaben an Niederlassungen</a>.
          </div>
        </>
      )}
    </Panel>
  );
}

// ── Bauteil-Ernte: was wurde aus Spender-Altgeräten gewonnen ─────────────────
// Zeigt nur Einlagerungen MIT gescannter Spender-LogID. Ältere Einlagerungen
// haben keine Herkunft (die LogID wurde früher nicht gespeichert) — die Anzahl
// wird bewusst offen ausgewiesen, damit die Zahlen nicht als „alles" gelesen werden.

function ErntePanel({ tage, standortId }: { tage: number; standortId: number | null | undefined }) {
  const q = api.preise.wertGeerntet.useQuery({ tage, standortId: standortId ?? null });
  return (
    <Panel title="🔧 Bauteil-Ernte" sub={`Aus Spender-Altgeräten gewonnene Teile × Kategorie-Preis · letzte ${tage} Tage`}>
      {q.isLoading && <Skeleton h="h-40" />}
      {q.data && (
        <>
          <div className="mb-4">
            <div className="text-3xl font-black tabular-nums text-[#04B475]">{euro(q.data.wert)}</div>
            <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
              📦 {q.data.geraete.toLocaleString("de-DE")} Spendergeräte · 🧩 {q.data.mengeGesamt.toLocaleString("de-DE")} Teile gewonnen
              {q.data.geraete > 0 && <> · Ø {q.data.proGeraet.toLocaleString("de-DE")} Teile je Gerät</>}
            </div>
            {q.data.erfassung.ohneHerkunft > 0 && (
              <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
                ℹ️ {q.data.erfassung.ohneHerkunft.toLocaleString("de-DE")} Einlagerungen ohne Spender-LogID (nicht enthalten)
              </div>
            )}
            {q.data.erfassung.druckTeile > 0 && (
              <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
                🖨️ {q.data.erfassung.druckTeile.toLocaleString("de-DE")} Teile selbst gedruckt
                <span className="text-[#90939a]"> — eigene Fertigung, zählt nicht als Ernte</span>
              </div>
            )}
          </div>

          {q.data.mengeGesamt === 0 && (
            <div className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
              Noch keine Ernte mit Spender-LogID erfasst. Beim Einlagern die LogID des Altgeräts scannen —
              dann erscheint hier, was aus welchem Gerät gewonnen wurde.
            </div>
          )}

          {q.data.mengeGesamt > 0 && (
            <>
              {q.data.proKategorie.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] border-b border-[#ced4da] dark:border-[#3e4042]">
                        <th className="text-left py-2 pr-3">Kategorie</th>
                        <th className="text-right py-2 px-3">Menge</th>
                        <th className="text-right py-2 px-3">Preis</th>
                        <th className="text-right py-2 pl-3">Wert</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f0f2f5] dark:divide-[#3e4042]">
                      {q.data.proKategorie.map((r) => (
                        <tr key={r.kategorie}>
                          <td className="py-2 pr-3 font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">{r.kategorie}</td>
                          <td className="py-2 px-3 text-right tabular-nums text-[#65676b] dark:text-[#b0b3b8]">{r.menge.toLocaleString("de-DE")}</td>
                          <td className="py-2 px-3 text-right tabular-nums text-[#65676b] dark:text-[#b0b3b8]">{euro(r.preis)}</td>
                          <td className="py-2 pl-3 text-right tabular-nums font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{euro(r.wert)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {q.data.topModelle.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] mb-1.5">
                    Ergiebigste Spendermodelle
                  </div>
                  <ul className="space-y-1">
                    {q.data.topModelle.map((m) => (
                      <li key={m.modell} className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="text-[#1a1a1a] dark:text-[#e4e6eb] truncate">{m.modell}</span>
                        <span className="tabular-nums text-[#65676b] dark:text-[#b0b3b8] shrink-0">
                          {m.teile.toLocaleString("de-DE")} Teile aus {m.geraete.toLocaleString("de-DE")} Gerät{m.geraete === 1 ? "" : "en"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {q.data.ohnePreis.length > 0 && (
                <div className="mt-3 text-xs text-[#f7b928]">
                  ⚠️ {q.data.ohnePreis.length} Kategorien ohne Preis (nicht im Wert enthalten):{" "}
                  {q.data.ohnePreis.map((o) => `${o.kategorie} (${o.menge})`).join(", ")} —{" "}
                  <a href="/admin/preise" className="underline font-semibold">Preise ergänzen</a>
                </div>
              )}
            </>
          )}

          {/* Altdaten: vor Einführung der Herkunfts-Erfassung. Aus der Buchungs-Notiz
              ist nur das MODELL rekonstruierbar — bewusst getrennt und ohne „je Gerät",
              weil eine Buchung auch eine Sammel-Einlagerung sein kann. */}
          {q.data.altModelle.length > 0 && (
            <div className="mt-5 pt-4 border-t border-dashed border-[#ced4da] dark:border-[#3e4042]">
              <div className="text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8]">
                Früher bearbeitete Modelle <span className="font-medium normal-case">(vor der Herkunfts-Erfassung)</span>
              </div>
              <div className="text-xs text-[#90939a] mb-1.5">
                Aus der Buchungs-Notiz rekonstruiert — nur Modell, nicht das einzelne Gerät.
                <strong className="font-semibold"> Enthält auch selbst gefertigte Teile (3D-Druck)</strong>,
                die sich in Altdaten nicht von echter Ernte trennen lassen — hohe Stückzahlen kommen meist daher.
              </div>
              <ul className="space-y-1">
                {q.data.altModelle.map((m) => (
                  <li key={m.modell} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-[#65676b] dark:text-[#b0b3b8] truncate">{m.modell}</span>
                    <span className="tabular-nums text-[#90939a] shrink-0">
                      {m.teile.toLocaleString("de-DE")} Teile · {m.buchungen} Einlagerung{m.buchungen === 1 ? "" : "en"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

// ── HBarChart mit optionalem Bedarf-Anteil ────────────────────────────────────

function HBarChart({ items, showBedarf, barColor }: {
  items:      { label: string; value: number; bedarfValue?: number }[];
  showBedarf?: boolean;
  barColor?:  (label: string) => string | undefined;
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
        const col = barColor?.(item.label);
        return (
          <div key={item.label} className="flex items-center gap-3">
            <div
              className="w-28 text-xs text-[#65676b] dark:text-[#b0b3b8] truncate text-right flex-shrink-0"
              title={item.label}
              aria-label={item.label}
            >
              {item.label}
            </div>
            <div className="flex-1 bg-[#f0f2f5] dark:bg-[#18191a] rounded-full h-5 overflow-hidden relative">
              <div className={`h-full rounded-full flex items-center justify-end pr-2 transition-all duration-700 ${col ? "" : "bg-[#0064d2] dark:bg-[#45bdff]"}`}
                style={{ width: `${pct}%`, ...(col ? { background: col } : {}) }}>
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
  data: { datum: string; anfragen: number; erledigt: number; bedarf: number; nichtVerfuegbar?: number }[];
}) {
  if (!data.length) return <Empty />;

  const nv = (d: typeof data[number]) => d.nichtVerfuegbar ?? 0;
  const maxVal = Math.max(...data.flatMap((d) => [d.anfragen, d.erledigt, d.bedarf, nv(d)]), 1);
  const n      = data.length;
  const H      = 80;
  const W      = 300;

  function pts(key: "anfragen" | "erledigt" | "bedarf" | "nichtVerfuegbar") {
    return data
      .map((d, i) => {
        const x = n > 1 ? (i / (n - 1)) * W : W / 2;
        const y = H - 4 - ((d[key] ?? 0) / maxVal) * (H - 8);
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
        <polyline points={pts("nichtVerfuegbar")} fill="none" stroke="#f97316" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
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
  data: { techniker: string; volumen: number; erledigungsrate: number; bedarfQuote: number; nichtVerfuegbar?: number }[];
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
            {(t.nichtVerfuegbar ?? 0) > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-[#65676b] dark:text-[#b0b3b8]">Nicht verfügbar</span>
                <span className="font-bold text-[#f97316]">{t.nichtVerfuegbar}</span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Monats-Namen ──────────────────────────────────────────────────────────────

const MONATE = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

function rateColor(rate: number | null): string {
  if (rate === null) return "text-[#65676b] dark:text-[#b0b3b8]";
  if (rate >= 90)   return "text-[#00a400]";
  if (rate >= 75)   return "text-[#f7b928]";
  return "text-[#fa3e3e]";
}

function rateBg(rate: number | null): string {
  if (rate === null) return "#ced4da";
  if (rate >= 90)   return "#00a400";
  if (rate >= 75)   return "#f7b928";
  return "#fa3e3e";
}

// ── Monats-Balken-Chart ───────────────────────────────────────────────────────

type MonatData = { monat: number; gesamt: number | null; erledigungsrate: number | null };

function MonatsBalkenChart({
  monate, onKlick, ausgewaehlt,
}: {
  monate:       MonatData[];
  onKlick:      (m: MonatData) => void;
  ausgewaehlt?: number;
}) {
  const max = Math.max(...monate.map((m) => m.gesamt ?? 0), 1);
  return (
    <div className="flex items-end gap-1 h-24 mt-2">
      {monate.map((m) => {
        const isCurrent = new Date().getMonth() + 1 === m.monat;
        const isSelected = ausgewaehlt === m.monat;
        const h = m.gesamt ? Math.max((m.gesamt / max) * 80, 4) : 0;
        return (
          <button
            key={m.monat}
            onClick={() => m.gesamt && onKlick(m)}
            disabled={!m.gesamt}
            title={m.gesamt ? `${MONATE[m.monat - 1]}: ${m.gesamt} Anfragen (${m.erledigungsrate ?? "—"}%)` : MONATE[m.monat - 1]}
            className={`flex-1 flex flex-col items-center gap-0.5 group transition-opacity ${!m.gesamt ? "opacity-30 cursor-default" : "cursor-pointer"}`}
          >
            <div
              className={`w-full rounded-t transition-all ${isSelected ? "ring-2 ring-[#0064d2]" : ""}`}
              style={{
                height:     `${h}px`,
                background: rateBg(m.erledigungsrate),
                opacity:    isCurrent ? 1 : 0.8,
              }}
            />
            <span className={`text-[8px] ${isCurrent ? "font-black text-[#0064d2]" : "text-[#65676b] dark:text-[#b0b3b8]"}`}>
              {MONATE[m.monat - 1]!.slice(0, 3)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Jahresarchiv-Sektion ──────────────────────────────────────────────────────

type MonatsDetailData = {
  kuerzel: string; monat: number; jahr: number;
  gesamt: number; erledigt: number; bedarf: number; storniert: number; nichtVerfuegbar: number;
  erledigungsrate: number;
  topTeile:   { teil: string; anzahl: number }[];
  topGeraete: { geraet: string; name: string; anzahl: number }[];
  anfragen:   { id: number; datum: Date | string; teil: string; geraeteName: string | null; geraet: string; logId: string; status: AnfrageStatus }[];
};

function MonatsDetailModal({ data, onClose }: { data: MonatsDetailData; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-[#242526] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#ced4da] dark:border-[#3e4042]">
          <h2 className="font-black text-lg text-[#1a1a1a] dark:text-[#e4e6eb]">
            {data.kuerzel} · {MONATE[data.monat - 1]} {data.jahr}
          </h2>
          <button onClick={onClose} aria-label="Schließen" className="text-[#65676b] hover:text-[#fa3e3e] text-xl font-bold w-11 h-11 flex items-center justify-center rounded-lg hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl p-3 text-center">
              <div className="text-2xl font-black text-[#0064d2]">{data.gesamt}</div>
              <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">Anfragen</div>
            </div>
            <div className="bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl p-3 text-center">
              <div className={`text-2xl font-black ${rateColor(data.erledigungsrate)}`}>{data.erledigungsrate}%</div>
              <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">Erledigungsrate</div>
            </div>
            <div className="bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl p-3 text-center">
              <div className="text-2xl font-black text-[#f7b928]">{data.bedarf}</div>
              <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">Bedarf</div>
            </div>
            <div className="bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl p-3 text-center">
              <div className="text-2xl font-black text-[#00a400]">{data.erledigt}</div>
              <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">Erledigt</div>
            </div>
            <div className="bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl p-3 text-center">
              <div className="text-2xl font-black text-[#fa3e3e]">{data.storniert}</div>
              <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">Storniert</div>
            </div>
            <div className="bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl p-3 text-center">
              <div className="text-2xl font-black text-[#f97316]">{data.nichtVerfuegbar}</div>
              <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">Nicht verfügbar</div>
            </div>
          </div>

          {/* Top Teile + Top Geräte */}
          <div className="grid grid-cols-2 gap-4">
            {data.topTeile.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase mb-2">Top 3 Teile</h3>
                {data.topTeile.map((t, i) => (
                  <div key={t.teil} className="flex items-center gap-2 py-1">
                    <span className="text-xs text-[#65676b] w-4">{i + 1}.</span>
                    <span className="text-sm font-medium text-[#1a1a1a] dark:text-[#e4e6eb] flex-1 truncate">{t.teil}</span>
                    <span className="text-xs font-bold text-[#0064d2]">×{t.anzahl}</span>
                  </div>
                ))}
              </div>
            )}
            {data.topGeraete.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase mb-2">Top 3 Geräte</h3>
                {data.topGeraete.map((g, i) => (
                  <div key={g.geraet} className="flex items-center gap-2 py-1">
                    <span className="text-xs text-[#65676b] w-4">{i + 1}.</span>
                    <span className="text-sm font-medium text-[#1a1a1a] dark:text-[#e4e6eb] flex-1 truncate">{g.name}</span>
                    <span className="text-xs font-bold text-[#0064d2]">×{g.anzahl}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Anfragen-Tabelle */}
          <div>
            <h3 className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase mb-2">
              Alle Anfragen ({data.anfragen.length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8]">
                    <th className="text-left py-1.5 pr-3">Datum</th>
                    <th className="text-left py-1.5 px-3">Teil</th>
                    <th className="text-left py-1.5 px-3">Gerät</th>
                    <th className="text-left py-1.5 px-3">LogID</th>
                    <th className="text-left py-1.5 pl-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0f2f5] dark:divide-[#3e4042]">
                  {data.anfragen.map((a) => (
                    <tr key={a.id}>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        {new Date(a.datum).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}
                      </td>
                      <td className="py-1.5 px-3 max-w-[120px] truncate font-medium">{a.teil}</td>
                      <td className="py-1.5 px-3 max-w-[100px] truncate text-[#65676b] dark:text-[#b0b3b8]">{a.geraeteName ?? a.geraet}</td>
                      <td className="py-1.5 px-3 font-mono text-[#65676b] dark:text-[#b0b3b8]">{a.logId}</td>
                      <td className="py-1.5 pl-3">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_FARBE[a.status]}`}>{a.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Jahresarchiv-Sektion (innerhalb Techniker-Detail) ─────────────────────────

function JahresArchivSektion({ kuerzel }: { kuerzel: string }) {
  const aktuellesJahr              = new Date().getFullYear();
  const [gewaehlterJahr, setJahr]  = useState(aktuellesJahr);
  const [monatsModal, setMonatsModal] = useState<number | null>(null); // Monat 1-12

  const verfuegbareJahre = api.statistik.getTechnikerVerfuegbareJahre.useQuery({ kuerzel });
  const archiv           = api.statistik.getTechnikerJahresArchiv.useQuery({ kuerzel, jahr: gewaehlterJahr });
  const monatsDetail     = api.statistik.getTechnikerMonatsDetail.useQuery(
    { kuerzel, monat: monatsModal ?? 1, jahr: gewaehlterJahr },
    { enabled: monatsModal !== null },
  );

  const jahre    = verfuegbareJahre.data ?? [aktuellesJahr];
  const jahrIdx  = jahre.indexOf(gewaehlterJahr);
  const monate   = archiv.data?.monate ?? [];
  const jKpis    = archiv.data?.jahresKpis;

  return (
    <Panel title="Jahresarchiv">
      {/* Jahr-Selector */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => setJahr(jahre[jahrIdx + 1] ?? gewaehlterJahr)}
          disabled={jahrIdx >= jahre.length - 1}
          className="px-3 py-1.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-sm disabled:opacity-30 hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors"
        >
          ←
        </button>
        <span className="text-xl font-black text-[#1a1a1a] dark:text-[#e4e6eb] min-w-[60px] text-center">{gewaehlterJahr}</span>
        <button
          onClick={() => setJahr(jahre[jahrIdx - 1] ?? gewaehlterJahr)}
          disabled={jahrIdx <= 0}
          className="px-3 py-1.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-sm disabled:opacity-30 hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors"
        >
          →
        </button>
        <span className="text-xs text-[#65676b] dark:text-[#b0b3b8] ml-2">Klick auf Monat für Details</span>
      </div>

      {archiv.isLoading && (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-3"><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>
          <Skeleton h="h-28" />
          <Skeleton h="h-48" />
        </div>
      )}

      {archiv.data && (
        <>
          {/* Jahres-KPIs */}
          {jKpis && jKpis.gesamt > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl p-3 text-center">
                <div className="text-2xl font-black text-[#0064d2]">{jKpis.gesamt}</div>
                <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">Anfragen {gewaehlterJahr}</div>
              </div>
              <div className="bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl p-3 text-center">
                <div className={`text-2xl font-black ${rateColor(jKpis.erledigungsrate)}`}>{jKpis.erledigungsrate}%</div>
                <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">Jahres-Rate</div>
              </div>
              {jKpis.besterMonat?.gesamt && (
                <div className="bg-[#00a400]/10 rounded-xl p-3 text-center">
                  <div className="text-lg font-black text-[#00a400]">{MONATE[jKpis.besterMonat.monat - 1]}</div>
                  <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">Bester Monat ({jKpis.besterMonat.erledigungsrate}%)</div>
                </div>
              )}
              {jKpis.schlechtesterMonat?.gesamt && (
                <div className="bg-[#fa3e3e]/10 rounded-xl p-3 text-center">
                  <div className="text-lg font-black text-[#fa3e3e]">{MONATE[jKpis.schlechtesterMonat.monat - 1]}</div>
                  <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">Schlechtester ({jKpis.schlechtesterMonat.erledigungsrate}%)</div>
                </div>
              )}
            </div>
          )}

          {/* Monats-Balken */}
          {monate.length > 0 && (
            <div className="mb-4">
              <div className="flex gap-2 text-[10px] text-[#65676b] dark:text-[#b0b3b8] mb-1">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block bg-[#00a400]" />≥90%</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block bg-[#f7b928]" />75–89%</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block bg-[#fa3e3e]" />&lt;75%</span>
              </div>
              <MonatsBalkenChart
                monate={monate}
                onKlick={(m) => setMonatsModal(m.monat)}
                ausgewaehlt={monatsModal ?? undefined}
              />
            </div>
          )}

          {/* Monats-Tabelle */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] border-b border-[#ced4da] dark:border-[#3e4042]">
                  <th className="text-left py-2 pr-3">Monat</th>
                  <th className="text-center py-2 px-3">Anfragen</th>
                  <th className="text-center py-2 px-3">Erledigt</th>
                  <th className="text-center py-2 px-3">Bedarf</th>
                  <th className="text-center py-2 pl-3">Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f2f5] dark:divide-[#3e4042]">
                {monate.map((m) => {
                  const jetzt       = new Date();
                  const istAktuell  = jetzt.getFullYear() === gewaehlterJahr && jetzt.getMonth() + 1 === m.monat;
                  const istZukunft  = gewaehlterJahr > jetzt.getFullYear() || (gewaehlterJahr === jetzt.getFullYear() && m.monat > jetzt.getMonth() + 1);
                  const hatDaten    = m.gesamt !== null;
                  return (
                    <tr
                      key={m.monat}
                      onClick={() => hatDaten && setMonatsModal(m.monat)}
                      className={`transition-colors ${hatDaten ? "cursor-pointer hover:bg-[#f0f2f5] dark:hover:bg-[#18191a]" : ""} ${istAktuell ? "bg-[#0064d2]/5 font-bold" : ""}`}
                    >
                      <td className={`py-2 pr-3 ${istAktuell ? "text-[#0064d2] font-black" : istZukunft ? "text-[#65676b] dark:text-[#b0b3b8]" : "text-[#1a1a1a] dark:text-[#e4e6eb]"}`}>
                        {MONATE[m.monat - 1]}
                        {istAktuell && <span className="ml-1 text-[10px] bg-[#0064d2] text-white px-1 rounded">lfd.</span>}
                      </td>
                      <td className="text-center py-2 px-3">{m.gesamt ?? <span className="text-[#65676b]">—</span>}</td>
                      <td className="text-center py-2 px-3 text-[#00a400]">{m.erledigt ?? <span className="text-[#65676b]">—</span>}</td>
                      <td className="text-center py-2 px-3 text-[#f7b928]">{m.bedarf ?? <span className="text-[#65676b]">—</span>}</td>
                      <td className={`text-center py-2 pl-3 font-bold ${rateColor(m.erledigungsrate)}`}>
                        {m.erledigungsrate !== null ? `${m.erledigungsrate}%` : <span className="text-[#65676b]">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Monats-Detail Modal */}
      {monatsModal !== null && monatsDetail.data && (
        <MonatsDetailModal
          data={monatsDetail.data as MonatsDetailData}
          onClose={() => setMonatsModal(null)}
        />
      )}
    </Panel>
  );
}

// ── Jahresübersicht aller Techniker (Tab in Übersicht) ────────────────────────

function AlleJahresOverview() {
  const aktuellesJahr = new Date().getFullYear();
  const overview = api.statistik.getAllTechnikerJahresOverview.useQuery({ jahr: aktuellesJahr });

  if (overview.isLoading) return <Skeleton h="h-40" />;
  if (!overview.data?.length) return <Empty />;

  const max = Math.max(
    ...overview.data.flatMap((t) => t.monate.map((m) => m ?? 0)),
    1,
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8]">
            <th className="text-left py-2 pr-4 font-bold uppercase">Techniker</th>
            {MONATE.map((m) => (
              <th key={m} className="text-center py-2 px-1 font-normal">{m.slice(0, 3)}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#f0f2f5] dark:divide-[#3e4042]">
          {overview.data.map((t) => (
            <tr key={t.techniker}>
              <td className="py-2 pr-4 font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{t.techniker}</td>
              {t.monate.map((anzahl, i) => (
                <td key={i} className="text-center py-2 px-1">
                  {anzahl ? (
                    <div
                      className="mx-auto rounded"
                      title={`${MONATE[i]}: ${anzahl}`}
                      style={{
                        width:      "20px",
                        height:     `${Math.max((anzahl / max) * 24, 4)}px`,
                        background: "#0064d2",
                        opacity:    0.4 + (anzahl / max) * 0.6,
                      }}
                    />
                  ) : (
                    <span className="text-[#ced4da] dark:text-[#3e4042]">·</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Hauptseite ────────────────────────────────────────────────────────────────

export default function StatistikenPage() {
  const [filter,     setFilter]    = useState<FilterRange>("monat");
  const [kuerzel,    setKuerzel]   = useState<string>(""); // "" = Alle
  const [letzteOff,  setLetzteOff] = useState(0);
  const [uebersichtTab, setUebersichtTab] = useState<"overview" | "jahresarchiv">("overview");

  // ── Ansicht: klassisch (Standard) ODER neues Dashboard ────────────────────
  // Bewusst „klassisch" als Startwert — die gewohnte Seite bleibt das, was ohne
  // Zutun erscheint. Die Wahl wird lokal gemerkt, damit sie einen Reload übersteht.
  // Erst NACH dem Mount aus dem Speicher lesen, sonst weicht der Server-HTML vom
  // Client ab (Hydration-Fehler).
  const [ansicht, setAnsicht] = useState<"klassisch" | "dashboard">("klassisch");
  useEffect(() => {
    try {
      if (localStorage.getItem("statistik-ansicht") === "dashboard") setAnsicht("dashboard");
    } catch { /* privater Modus o.ä. — dann bleibt es bei klassisch */ }
  }, []);
  function wechsleAnsicht(neu: "klassisch" | "dashboard") {
    setAnsicht(neu);
    try { localStorage.setItem("statistik-ansicht", neu); } catch { /* egal */ }
  }
  // Das Dashboard zeigt die Team-Übersicht. Für die Einzel-Auswertung eines
  // Technikers gibt es dort (noch) kein Gegenstück → dann klassisch rendern.
  const zeigeDashboard = ansicht === "dashboard" && kuerzel === "";

  const { activeStandortId } = useStandortFilter();
  const sId = activeStandortId;

  const tage     = TAGE_MAP[filter];
  const hatTech  = kuerzel !== "";

  // Live-Updates: bei relevanten Events den kompletten statistik-Sub-Router
  // invalidieren. React Query batcht das Refetching der aktiven Queries.
  const utils      = api.useUtils();
  const { on, off } = useSocket();
  useEffect(() => {
    const refresh = () => { void utils.statistik.invalidate(); };
    on(EVENTS.ANFRAGE_NEU,        refresh);
    on(EVENTS.ANFRAGE_UPDATED,    refresh);
    on(EVENTS.ANFRAGE_GELOESCHT,  refresh);
    on(EVENTS.BUCHUNG_ERSTELLT,   refresh);
    return () => {
      off(EVENTS.ANFRAGE_NEU);
      off(EVENTS.ANFRAGE_UPDATED);
      off(EVENTS.ANFRAGE_GELOESCHT);
      off(EVENTS.BUCHUNG_ERSTELLT);
    };
  }, [on, off, utils]);

  // ── Queries Übersicht (Alle) ───────────────────────────────────────────────
  const kpi         = api.statistik.getKpiOverview.useQuery({ tage, standortId: sId }, { enabled: !hatTech });
  const verlaufAlle = api.statistik.getAnfragenVerlauf.useQuery({ tage, standortId: sId }, { enabled: !hatTech });
  const statusData  = api.statistik.getAnfragenNachStatus.useQuery({ standortId: sId }, { enabled: !hatTech });
  const topGeraete  = api.statistik.getMeistgefragteGeraete.useQuery({ tage, standortId: sId }, { enabled: !hatTech });
  const topTeile    = api.statistik.getMeistgefragteTeile.useQuery({ tage, standortId: sId }, { enabled: !hatTech });
  const teamVergl   = api.statistik.getTechnikerTeamVergleich.useQuery({ tage, standortId: sId }, { enabled: !hatTech });

  // ── Queries Techniker-Detail ──────────────────────────────────────────────
  const techKpis      = api.statistik.getTechnikerKpis.useQuery({ kuerzel, tage }, { enabled: hatTech });
  const verlaufTech   = api.statistik.getAnfragenVerlauf.useQuery({ tage, kuerzel, standortId: sId }, { enabled: hatTech });
  const techTeile     = api.statistik.getTechnikerTeile.useQuery({ kuerzel, tage }, { enabled: hatTech });
  const techGeraete   = api.statistik.getTechnikerGeraete.useQuery({ kuerzel, tage }, { enabled: hatTech });
  const techWochentag = api.statistik.getTechnikerWochentage.useQuery({ kuerzel, tage: 90 }, { enabled: hatTech });
  const techTageszeit = api.statistik.getTechnikerTageszeiten.useQuery({ kuerzel, tage: 90 }, { enabled: hatTech });
  const letzteAnfr    = api.statistik.getTechnikerLetzteAnfragen.useQuery(
    { kuerzel, tage, limit: 15, offset: letzteOff },
    { enabled: hatTech },
  );

  // Techniker-Liste für Selector (standortId-gefiltert für Standort-Dropdown)
  const techList = api.statistik.getTechnikerTeamVergleich.useQuery({ tage: 365, standortId: sId });
  const techniker = techList.data?.map((t) => t.techniker) ?? [];

  return (
    <div className="space-y-5">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Statistiken</h1>
        <div className="flex gap-3 flex-wrap items-center">
          {/* Ansicht umschalten — klassisch bleibt Standard */}
          <div className="flex bg-white dark:bg-[#242526] border border-[#ced4da] dark:border-[#3e4042] rounded-xl overflow-hidden">
            {([
              { key: "klassisch", label: "📋 Klassisch" },
              { key: "dashboard", label: "📊 Dashboard" },
            ] as const).map(({ key, label }) => (
              <button key={key} onClick={() => wechsleAnsicht(key)}
                aria-pressed={ansicht === key}
                className={`px-4 py-2 text-sm font-semibold transition-colors ${
                  ansicht === key
                    ? "bg-[#202F61] text-white"
                    : "text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"
                }`}>
                {label}
              </button>
            ))}
          </div>
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
          DASHBOARD-ANSICHT (optional, per Umschalter)
          Deckt die Team-Übersicht ab. Team-Vergleich, Jahresarchiv und die
          Einzel-Auswertung je Techniker liegen weiterhin in der klassischen
          Ansicht — darauf wird unten hingewiesen statt es zu verstecken.
          ══════════════════════════════════════════════════════════════════ */}
      {zeigeDashboard && (
        <>
          <DashboardAnsicht tage={tage} standortId={sId} />
          <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] text-center pt-1">
            Team-Vergleich, Jahresarchiv, Wert-Auswertung und die Einzel-Auswertung je Techniker
            findest du in der{" "}
            <button onClick={() => wechsleAnsicht("klassisch")} className="underline font-semibold">
              klassischen Ansicht
            </button>.
          </p>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          ANSICHT A — ALLE TECHNIKER (Übersicht)
          ══════════════════════════════════════════════════════════════════ */}
      {!zeigeDashboard && !hatTech && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
            {kpi.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} />)
            ) : (
              <>
                <StatCard title="Anfragen gesamt"  value={kpi.data?.gesamtAnfragen ?? 0}  icon="🔔" color="primary" />
                <StatCard title="Erledigt"          value={kpi.data?.abgeschlossen ?? 0}   icon="✅" color="success"
                  sub={`${kpi.data?.erledigungsquote ?? 0}% Erledigungsrate`} />
                <StatCard title="Bedarf / Offen"    value={kpi.data?.bedarf ?? 0}           icon="⏳" color="warning" />
                <StatCard title="Storniert"         value={kpi.data?.storniert ?? 0}        icon="❌" color="danger" />
                <StatCard title="Nicht verfügbar"   value={kpi.data?.nichtVerfuegbar ?? 0}  icon="🚫" accent="orange" />
              </>
            )}
          </div>

          {/* Anfragen-Verlauf + Status */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            <div className="xl:col-span-2"><Panel title="Anfragen-Verlauf" sub="Täglich">
              <div className="flex gap-4 text-xs mb-1 flex-wrap">
                <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-[#0064d2] inline-block" />Anfragen</span>
                <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-[#00a400] inline-block" />Erledigt</span>
                <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-[#f7b928] inline-block" />Bedarf</span>
                <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-[#f97316] inline-block" />Nicht verfügbar</span>
              </div>
              {verlaufAlle.isLoading && <Skeleton h="h-20" />}
              {verlaufAlle.data && <AnfragenVerlauf data={verlaufAlle.data} />}
            </Panel></div>

            <Panel title="Status-Verteilung">
              {statusData.isLoading && <Skeleton h="h-20" />}
              {statusData.data && (
                <HBarChart items={statusData.data.map((s) => ({ label: s.status, value: s.anzahl }))} barColor={(l) => STATUS_HEX[l]} />
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

          {/* Wert ausgegeben (Laptop-Teile über Anfragen) */}
          <WertAusgegebenPanel tage={tage} standortId={sId} />

          {/* Bauteil-Ernte: was kam aus den Spender-Altgeräten rein */}
          <ErntePanel tage={tage} standortId={sId} />

          {/* Abgaben: was ging an andere Niederlassungen raus */}
          <AbgabenPanel tage={tage} standortId={sId} />

          {/* Team-Vergleich + Jahresarchiv Tab */}
          <Panel title="Techniker-Analyse">
            <div className="flex gap-1 mb-4 border-b border-[#ced4da] dark:border-[#3e4042] pb-3">
              {(["overview", "jahresarchiv"] as const).map((tab) => (
                <button key={tab} onClick={() => setUebersichtTab(tab)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                    uebersichtTab === tab
                      ? "bg-[#0064d2] text-white"
                      : "text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"
                  }`}>
                  {tab === "overview" ? "Team-Vergleich" : `Jahresarchiv ${new Date().getFullYear()}`}
                </button>
              ))}
            </div>
            {uebersichtTab === "overview" && (
              <>
                {teamVergl.isLoading && <Skeleton h="h-28" />}
                {teamVergl.data && <TeamVergleich data={teamVergl.data} />}
              </>
            )}
            {uebersichtTab === "jahresarchiv" && (
              <AlleJahresOverview />
            )}
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
            <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} />)}
            </div>
          ) : techKpis.data ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
              <StatCard title="Gesamt"        value={techKpis.data.gesamt}          icon="🔔" color="primary" />
              <StatCard title="Erledigungsrate" value={`${techKpis.data.erledigungsrate}%`} icon="✅" color="success"
                sub={`${techKpis.data.abgeschlossen} erledigt`} />
              <StatCard title="Bedarf-Quote"  value={`${techKpis.data.bedarfQuote}%`}      icon="⏳" color="warning"
                sub={techKpis.data.bedarfQuote <= 20 ? "Gut" : techKpis.data.bedarfQuote <= 40 ? "OK" : "Hoch"} />
              <StatCard title="Storniert"     value={techKpis.data.storniert}       icon="❌" color="danger" />
              <StatCard title="Aktivste Woche" value={techKpis.data.aktivsteWoche}  icon="📅" color="primary"
                sub={`${techKpis.data.aktivsteWocheAnzahl} Anfragen`} />
            </div>
          ) : null}

          {/* Anfragen-Verlauf */}
          <Panel title="Anfragen-Verlauf" sub={`${kuerzel} · täglich`}>
            <div className="flex gap-4 text-xs mb-1 flex-wrap">
              <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-[#0064d2] inline-block" />Anfragen</span>
              <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-[#00a400] inline-block" />Erledigt</span>
              <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-[#f7b928] inline-block" />Bedarf</span>
              <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-[#f97316] inline-block" />Nicht verfügbar</span>
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

          {/* Jahresarchiv-Sektion */}
          <JahresArchivSektion kuerzel={kuerzel} />
        </>
      )}
    </div>
  );
}


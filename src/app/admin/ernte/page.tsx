"use client";

import { useState } from "react";
import { api } from "@/trpc/react";
import { usePermissions } from "@/hooks/usePermissions";

const GRUEN = "#04B475";
const CYAN  = "#008BD2";

const ZEITRAEUME: { label: string; tage: number | null }[] = [
  { label: "30 Tage",  tage: 30 },
  { label: "90 Tage",  tage: 90 },
  { label: "365 Tage", tage: 365 },
  { label: "Gesamt",   tage: null },
];

function fmt(n: number, dez = 0): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: dez, maximumFractionDigits: dez });
}

function euro(n: number): string {
  return n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

export default function ErnteAuswertungPage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfSehen = has("STATISTIK_VIEW");
  const [tage, setTage] = useState<number | null>(365);

  const q = api.erne.kennzahlen.useQuery({ tage, standortId: null }, { enabled: darfSehen });

  if (permsLoading) {
    return <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Lade Berechtigungen…</div>;
  }
  if (!darfSehen) {
    return <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Kein Zugriff (Recht STATISTIK_VIEW fehlt).</div>;
  }

  const k = q.data;

  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-5">
        <h1 className="text-2xl font-black text-[#202F61] dark:text-[#e4e6eb]">🔧 Bauteil-Ernte</h1>
        <p className="mt-1 text-base text-[#65676b] dark:text-[#b0b3b8]">
          Übersicht der aus Altgeräten gewonnenen Ersatzteile: Menge, Material­wert,
          Top-Modelle und versorgte Quellen (Spender-Geräte).
        </p>
      </header>

      {/* Zeitraum */}
      <div className="mb-5 flex flex-wrap gap-2">
        {ZEITRAEUME.map((z) => {
          const aktiv = z.tage === tage;
          return (
            <button
              key={z.label}
              onClick={() => setTage(z.tage)}
              className={`px-4 min-h-[44px] rounded-lg font-bold transition-colors ${
                aktiv ? "text-white" : "text-[#65676b] dark:text-[#b0b3b8] border-2 border-[#ced4da] dark:border-[#3e4042] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"
              }`}
              style={aktiv ? { background: GRUEN } : undefined}
            >
              {z.label}
            </button>
          );
        })}
      </div>

      {q.isLoading || !k ? (
        <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Lade Kennzahlen…</div>
      ) : (
        <>
          {/* KPI-Kacheln */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KPI icon="📦" label="Teile geernte" wert={fmt(k.mengeGesamt)} farbe={GRUEN} />
            <KPI icon="💶" label="Materialwert" wert={euro(k.materialWert)} farbe={CYAN} />
            <KPI icon="♻️" label="Mit Spender-LogID" wert={fmt(k.geraete)} farbe="#00a400" />
            <KPI icon="📊" label="Kategorien" wert={fmt(k.proKategorie.length)} farbe="#202F61" />
          </div>

          {/* Info: alte Teile ohne LogID */}
          {k.mengeGesamt > k.geraete && (
            <div className="mb-6 p-4 rounded-lg bg-[#e7f3ff] dark:bg-[#1e3a4d] border border-[#008bd2] dark:border-[#0066aa]">
              <p className="text-sm text-[#004080] dark:text-[#5eb3ff]">
                <strong>ℹ️ {fmt(k.mengeGesamt - k.geraete)} Teile ohne Spender-LogID:</strong> Alte Einlagerungen vor dem Feature oder ohne gescannte LogID.
                Beim nächsten Einlagern die LogID des Spender-Geräts scannen, dann erscheint es hier in den Top-Modellen.
              </p>
            </div>
          )}

          {/* Top-Modelle */}
          {k.topModelle.length > 0 && (
            <div className="mb-6 p-4 rounded-lg bg-[#f0f2f5] dark:bg-[#2a2c2d] border border-[#e4e6eb] dark:border-[#3e4042]">
              <h2 className="text-lg font-bold text-[#202F61] dark:text-[#e4e6eb] mb-3">🏆 Top-Modelle</h2>
              <div className="space-y-2">
                {k.topModelle.map((m, i) => (
                  <div key={i} className="flex justify-between items-center p-2 bg-white dark:bg-[#1c1e1f] rounded border border-[#ced4da] dark:border-[#3e4042]">
                    <div>
                      <div className="font-mono text-sm text-[#202F61] dark:text-[#e4e6eb]">{m.logId}</div>
                      <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">{fmt(m.menge)} Teile</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-[#202F61] dark:text-[#e4e6eb]">{euro(m.wert)}</div>
                      <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">Wert</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Kategorien mit Preis */}
          {k.proKategorie.length > 0 && (
            <div className="mb-6 p-4 rounded-lg bg-[#f0f2f5] dark:bg-[#2a2c2d] border border-[#e4e6eb] dark:border-[#3e4042]">
              <h2 className="text-lg font-bold text-[#202F61] dark:text-[#e4e6eb] mb-3">📊 Nach Kategorie</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#ced4da] dark:border-[#3e4042]">
                      <th className="text-left p-2 text-[#65676b] dark:text-[#b0b3b8] font-bold">Kategorie</th>
                      <th className="text-right p-2 text-[#65676b] dark:text-[#b0b3b8] font-bold">Menge</th>
                      <th className="text-right p-2 text-[#65676b] dark:text-[#b0b3b8] font-bold">Preis/Stück</th>
                      <th className="text-right p-2 text-[#65676b] dark:text-[#b0b3b8] font-bold">Summe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {k.proKategorie.map((kat, i) => (
                      <tr key={i} className={i % 2 === 0 ? "" : "bg-white dark:bg-[#1c1e1f]"}>
                        <td className="p-2 text-[#202F61] dark:text-[#e4e6eb]">{kat.kategorie}</td>
                        <td className="text-right p-2 text-[#65676b] dark:text-[#b0b3b8]">{fmt(kat.menge)}</td>
                        <td className="text-right p-2 text-[#65676b] dark:text-[#b0b3b8]">{euro(kat.preis)}</td>
                        <td className="text-right p-2 font-bold text-[#202F61] dark:text-[#e4e6eb]">{euro(kat.wert)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Kategorien ohne Preis */}
          {k.ohnePreis.length > 0 && (
            <div className="p-4 rounded-lg bg-[#fff3cd] dark:bg-[#3f3a2f] border border-[#ffc107] dark:border-[#a89c2f]">
              <h3 className="font-bold text-[#856404] dark:text-[#ffc107] mb-2">⚠️ Teile ohne Kategorie-Preis</h3>
              <p className="text-sm text-[#856404] dark:text-[#f0d090] mb-3">
                Diese Kategorien haben noch keinen hinterlegten Stückpreis. Sie sind NICHT in die obige Wert-Summe eingerechnet.
              </p>
              <div className="space-y-1">
                {k.ohnePreis.map((kat, i) => (
                  <div key={i} className="text-sm text-[#856404] dark:text-[#f0d090]">
                    {kat.kategorie}: <strong>{fmt(kat.menge)} Teile</strong>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface KPIProps {
  icon: string;
  label: string;
  wert: string;
  farbe: string;
}

function KPI({ icon, label, wert, farbe }: KPIProps) {
  return (
    <div className="p-4 rounded-lg bg-white dark:bg-[#1c1e1f] border-2" style={{ borderColor: farbe }}>
      <div className="text-3xl mb-2">{icon}</div>
      <div className="text-2xl font-black" style={{ color: farbe }}>{wert}</div>
      <div className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">{label}</div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/trpc/react";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/components/ui/Toast";
import {
  baueCsv, ladeCsv, ladeXlsx, kopiereText, sichererDateiname,
  type MobilExportZeile,
} from "@/lib/mobil/export";

const AKZENT = "#008BD2";

export default function MobilPage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfSehen     = has("MOBIL_VIEW");
  const darfVerwalten = has("MOBIL_MANAGE");

  // Browsing-Auswahl (Hersteller → Modell → Teile).
  const [selHersteller, setSelHersteller] = useState<string | null>(null);
  const [selModellId, setSelModellId]     = useState<number | null>(null);

  const herstellerQ = api.mobil.hersteller.useQuery(undefined, { enabled: darfSehen });
  const modelleQ = api.mobil.modelle.useQuery(
    { hersteller: selHersteller ?? "" },
    { enabled: darfSehen && !!selHersteller },
  );
  const teileQ = api.mobil.teileProModell.useQuery(
    { modellId: selModellId ?? 0 },
    { enabled: darfSehen && selModellId != null },
  );
  const selModellName = modelleQ.data?.find((m) => m.id === selModellId)?.modell ?? "";

  if (permsLoading) {
    return <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Lade Berechtigungen…</div>;
  }
  if (!darfSehen) {
    return (
      <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">
        Kein Zugriff. Bitte das Recht <strong>MOBIL_VIEW</strong> bei der Rolle aktivieren.
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-[#202F61] dark:text-[#e4e6eb]">📱 Mobil-Ersatzteile</h1>
          <p className="mt-2 text-base text-[#65676b] dark:text-[#b0b3b8]">
            Smartphone- und Tablet-Teile mit LogID. Hersteller → Modell → Teile durchsuchen und exportieren.
          </p>
        </div>
        {darfVerwalten && (
          <Link
            href="/admin/mobil/import"
            className="inline-flex items-center gap-2 px-4 rounded-xl text-white text-base font-bold shadow-sm min-h-[44px]"
            style={{ background: AKZENT }}
          >
            📥 Import
          </Link>
        )}
      </header>

      {/* Schritt 1: Hersteller */}
      <div className="space-y-2">
        <Schrittkopf nr={1} text="Hersteller wählen" />
        {herstellerQ.isLoading ? (
          <Laden />
        ) : !herstellerQ.data?.length ? (
          <Leer text={darfVerwalten
            ? "Noch keine Teile importiert. Oben rechts über »Import« eine CSV hochladen."
            : "Noch keine Teile importiert."} />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {herstellerQ.data.map((h) => {
              const aktiv = selHersteller === h.hersteller;
              return (
                <button
                  key={h.hersteller}
                  type="button"
                  aria-pressed={aktiv}
                  onClick={() => { setSelHersteller(h.hersteller); setSelModellId(null); }}
                  className="text-left rounded-2xl border-2 p-4 min-h-[88px] transition-colors"
                  style={{ borderColor: aktiv ? AKZENT : "#ced4da66", background: aktiv ? `${AKZENT}14` : "transparent" }}
                >
                  <div className="text-xl font-black text-[#202F61] dark:text-[#e4e6eb]">{h.hersteller}</div>
                  <div className="mt-1 text-sm text-[#65676b] dark:text-[#b0b3b8]">
                    {h.modelle} {h.modelle === 1 ? "Modell" : "Modelle"} · <strong>{h.teile}</strong> Teile
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Schritt 2: Modelle */}
      {selHersteller && (
        <div className="space-y-2">
          <Schrittkopf nr={2} text={`Modell wählen — ${selHersteller}`} />
          {modelleQ.isLoading ? (
            <Laden />
          ) : !modelleQ.data?.length ? (
            <Leer text="Keine Modelle mit Teilen." />
          ) : (
            <div className="grid sm:grid-cols-2 gap-2">
              {modelleQ.data.map((m) => {
                const aktiv = selModellId === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={aktiv}
                    onClick={() => setSelModellId(m.id)}
                    className="flex items-center justify-between gap-3 rounded-xl border-2 px-4 min-h-[56px] transition-colors"
                    style={{ borderColor: aktiv ? AKZENT : "#ced4da66", background: aktiv ? `${AKZENT}14` : "transparent" }}
                  >
                    <span className="text-base font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{m.modell}</span>
                    <span className="flex-shrink-0 rounded-lg px-3 py-1 text-sm font-bold tabular-nums" style={{ background: `${AKZENT}1a`, color: AKZENT }}>
                      {m.stueck} Stück
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Schritt 3: Teile je Teiltyp (aufklappbar + Export) */}
      {selModellId != null && (
        <div className="space-y-2">
          <Schrittkopf
            nr={3}
            text={`Teile — ${selModellName}${teileQ.data ? ` · ${teileQ.data.gesamt} Stück gesamt` : ""}`}
          />
          {teileQ.isLoading ? (
            <Laden />
          ) : !teileQ.data?.teiltypen.length ? (
            <Leer text="Keine Teile für dieses Modell." />
          ) : (
            <div className="space-y-3">
              {teileQ.data.teiltypen.map((g) => (
                <TeiltypCard
                  key={g.teiltyp}
                  modellId={selModellId}
                  hersteller={selHersteller ?? ""}
                  modellName={selModellName}
                  teiltyp={g.teiltyp}
                  stueck={g.stueck}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Teiltyp-Karte: Kopf mit Stückzahl + Export, aufklappbare LogID-Liste ────────
function TeiltypCard({
  modellId, hersteller, modellName, teiltyp, stueck,
}: {
  modellId: number;
  hersteller: string;
  modellName: string;
  teiltyp: string;
  stueck: number;
}) {
  const { show } = useToast();
  const utils = api.useUtils();
  const [offen, setOffen] = useState(false);
  const [exportLaeuft, setExportLaeuft] = useState(false);

  const logIdsQ = api.mobil.logIdsProTeiltyp.useQuery(
    { modellId, teiltyp },
    { enabled: offen },
  );

  // LogIDs nach Colli gruppieren (Liste ist bereits nach colli, logId sortiert).
  const gruppen = useMemo(() => {
    const rows = logIdsQ.data ?? [];
    const map = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = r.colli ?? "ohne Colli";
      const arr = map.get(k) ?? [];
      arr.push(r);
      map.set(k, arr);
    }
    return [...map.entries()];
  }, [logIdsQ.data]);

  // Export: LogIDs der Gruppe imperativ holen (nutzt Cache, falls schon geladen).
  async function hole(): Promise<MobilExportZeile[]> {
    const rows = await utils.mobil.logIdsProTeiltyp.fetch({ modellId, teiltyp });
    return rows.map((r) => ({
      logId: r.logId, colli: r.colli, stellplatz: r.stellplatz, bezeichnung: r.bezeichnung, ek: r.ek,
    }));
  }
  const dateiname = (ext: string) => sichererDateiname(["mobil", hersteller, modellName, teiltyp], ext);

  async function mitLadezustand(fn: () => Promise<void>) {
    if (exportLaeuft) return;
    setExportLaeuft(true);
    try { await fn(); }
    catch { show("Export fehlgeschlagen.", "error"); }
    finally { setExportLaeuft(false); }
  }
  const onCopy = () => mitLadezustand(async () => {
    const rows = await hole();
    const ok = await kopiereText(rows.map((r) => r.logId).join("\n"));
    show(ok ? `Kopiert ✓ (${rows.length} LogIDs)` : "Kopieren fehlgeschlagen.", ok ? "success" : "error");
  });
  const onCsv = () => mitLadezustand(async () => { ladeCsv(dateiname("csv"), baueCsv(await hole())); });
  const onXlsx = () => mitLadezustand(async () => { await ladeXlsx(dateiname("xlsx"), await hole()); });

  const btn = "inline-flex items-center justify-center gap-1 rounded-lg px-3 min-h-[44px] text-sm font-bold border border-[#ced4da] dark:border-[#3e4042] text-[#202F61] dark:text-[#e4e6eb] hover:bg-[#f0f2f5] dark:hover:bg-[#3a3b3c] disabled:opacity-40 transition-colors";

  return (
    <div className="rounded-2xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          onClick={() => setOffen((o) => !o)}
          aria-expanded={offen}
          className="flex-1 flex items-center justify-between gap-3 min-h-[44px] px-1 text-left"
        >
          <span className="text-lg font-bold text-[#202F61] dark:text-[#e4e6eb]">
            <span aria-hidden className="inline-block w-4 text-[#90939a]">{offen ? "▾" : "▸"}</span> {teiltyp}
          </span>
          <span className="text-lg font-black tabular-nums text-[#202F61] dark:text-[#e4e6eb]">{stueck} Stück</span>
        </button>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button type="button" aria-label={`LogIDs von ${teiltyp} kopieren`} title="LogIDs kopieren" onClick={onCopy} disabled={exportLaeuft} className={btn}>📋</button>
          <button type="button" aria-label={`${teiltyp} als CSV herunterladen`} title="CSV" onClick={onCsv} disabled={exportLaeuft} className={btn}>⬇ CSV</button>
          <button type="button" aria-label={`${teiltyp} als Excel herunterladen`} title="Excel (.xlsx)" onClick={onXlsx} disabled={exportLaeuft} className={btn}>⬇ XLSX</button>
        </div>
      </div>

      {offen && (
        <div className="border-t border-[#ced4da] dark:border-[#3e4042] p-3 bg-[#f7f8fa] dark:bg-[#18191a]">
          {logIdsQ.isLoading ? (
            <Laden />
          ) : !gruppen.length ? (
            <Leer text="Keine LogIDs." />
          ) : (
            <div className="space-y-4">
              {gruppen.map(([colli, rows]) => (
                <div key={colli}>
                  <div className="text-sm font-bold text-[#202F61] dark:text-[#e4e6eb]">
                    Colli {colli} <span className="text-[#65676b] dark:text-[#b0b3b8] font-semibold">· {rows.length} Stück</span>
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {rows.map((r) => (
                      <li key={r.logId} className="font-mono text-sm text-[#1a1a1a] dark:text-[#e4e6eb] flex flex-wrap items-baseline gap-x-2">
                        <span>{r.logId}</span>
                        {r.stellplatz && <span className="text-[#90939a] dark:text-[#6b6e73]">@ {r.stellplatz}</span>}
                        {r.auch.length > 0 && (
                          <span className="font-sans text-xs text-[#b25e00] dark:text-[#ffb74d]">auch: {r.auch.join(", ")}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Kleine Helfer ──────────────────────────────────────────────────────────────
function Schrittkopf({ nr, text }: { nr: number; text: string }) {
  return (
    <h2 className="flex items-center gap-2 text-lg font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
      <span
        className="inline-flex items-center justify-center w-7 h-7 rounded-full text-white text-sm font-black flex-shrink-0"
        style={{ background: AKZENT }}
        aria-hidden
      >
        {nr}
      </span>
      {text}
    </h2>
  );
}

function Laden() {
  return <div role="status" className="text-base text-[#65676b] dark:text-[#b0b3b8] py-3">⏳ Lade…</div>;
}

function Leer({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[#ced4da] dark:border-[#3e4042] p-5 text-base text-[#65676b] dark:text-[#b0b3b8]">
      {text}
    </div>
  );
}

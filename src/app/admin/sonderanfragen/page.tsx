"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { api } from "@/trpc/react";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/components/ui/Toast";

const AKZENT = "#008BD2";
const PAUSCHALE = 5; // muss zu SONDER_PAUSCHALE in src/server/routers/preise.ts passen

// Deutsche Euro-Eingabe → number | null | NaN(=ungültig). "" → null (= Pauschale).
function parseEuro(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  let norm = t.replace(/\s/g, "");
  if (norm.includes(",")) norm = norm.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(norm);
  if (!isFinite(n) || n < 0) return NaN;
  return Math.round(n * 100) / 100;
}
function fmtEuro(n: number | null): string {
  return n == null ? "" : n.toFixed(2).replace(".", ",");
}
function euro(n: number): string {
  return n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}
function fmtDatum(d: Date | string): string {
  return new Date(d).toLocaleDateString("de-DE");
}

export default function SonderanfragenPage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfSehen = has("ANFRAGE_VIEW_ALL");
  const { data: session } = useSession();
  const darfBearbeiten = (session?.user as { rolle?: string } | undefined)?.rolle === "ADMIN";

  const { show } = useToast();
  const utils = api.useUtils();

  const [nurUnbewertet, setNurUnbewertet] = useState(false);
  const listeQ = api.anfragen.sonderListe.useQuery({ nurUnbewertet }, { enabled: darfSehen });

  // Lokaler Eingabe-Entwurf: anfrageId → Eingabestring. Aus der Query geseedet.
  const [entwurf, setEntwurf] = useState<Record<number, string>>({});
  useEffect(() => {
    if (!listeQ.data) return;
    setEntwurf(Object.fromEntries(listeQ.data.map((r) => [r.id, fmtEuro(r.sonderWert)])));
  }, [listeQ.data]);

  const setzen = api.anfragen.setSonderWert.useMutation();

  const geaendert = useMemo(() => {
    if (!listeQ.data) return [] as number[];
    return listeQ.data.filter((r) => (entwurf[r.id] ?? "") !== fmtEuro(r.sonderWert)).map((r) => r.id);
  }, [listeQ.data, entwurf]);

  const bewertetAnzahl = useMemo(
    () => (listeQ.data ?? []).filter((r) => r.sonderWert != null).length,
    [listeQ.data],
  );

  async function speichern() {
    // Zuerst alle Eingaben validieren, dann der Reihe nach speichern.
    const eintraege: { id: number; wert: number | null }[] = [];
    for (const id of geaendert) {
      const wert = parseEuro(entwurf[id] ?? "");
      if (typeof wert === "number" && Number.isNaN(wert)) {
        show(`Ungültiger Wert (bitte Zahl ≥ 0, z.B. 12,50).`, "error");
        return;
      }
      eintraege.push({ id, wert });
    }
    if (eintraege.length === 0) { show("Nichts geändert.", "info"); return; }
    try {
      for (const e of eintraege) await setzen.mutateAsync(e);
      show(`✅ ${eintraege.length} Sonderanfrage${eintraege.length === 1 ? "" : "n"} bewertet`, "success");
      void utils.anfragen.sonderListe.invalidate();
      void utils.preise.wertAusgegeben.invalidate();
    } catch (err) {
      show(err instanceof Error ? err.message : "Fehler beim Speichern", "error");
    }
  }

  if (permsLoading) {
    return <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Lade Berechtigungen…</div>;
  }
  if (!darfSehen) {
    return <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Kein Zugriff (Recht ANFRAGE_VIEW_ALL fehlt).</div>;
  }

  const liste = listeQ.data ?? [];

  const inputCls =
    "w-28 min-h-[44px] text-right rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#3a3b3c] px-3 py-2 text-base font-semibold text-[#202F61] dark:text-[#e4e6eb] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#008BD2] disabled:opacity-50";

  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-5">
        <h1 className="text-2xl font-black text-[#202F61] dark:text-[#e4e6eb]">💬 Sonderanfragen bewerten</h1>
        <p className="mt-1 text-base text-[#65676b] dark:text-[#b0b3b8]">
          Sonderanfragen haben keinen Lagerartikel und damit keinen Kategorie-Preis. In der Auswertung
          „Wert ausgegeben" zählt jede erledigte Sonderanfrage mit der Pauschale{" "}
          <span className="font-bold">{euro(PAUSCHALE)}</span>. Hier kann ein genauer Wert hinterlegt
          werden (leer = Pauschale). Eingabe als Euro mit Komma (z.B. <span className="font-mono">12,50</span>).
        </p>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 min-h-[44px] cursor-pointer select-none">
          <input type="checkbox" checked={nurUnbewertet} onChange={(e) => setNurUnbewertet(e.target.checked)} className="w-5 h-5 accent-[#008BD2]" />
          <span className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Nur unbewertete zeigen</span>
        </label>
        <span className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
          {liste.length} Sonderanfragen · <span className="font-bold" style={{ color: AKZENT }}>{bewertetAnzahl} einzeln bewertet</span>
        </span>
        {geaendert.length > 0 && (
          <span className="rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 px-2 py-0.5 text-xs font-bold">
            {geaendert.length} ungespeichert
          </span>
        )}
      </div>

      {listeQ.isLoading ? (
        <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Lade Sonderanfragen…</div>
      ) : liste.length === 0 ? (
        <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Keine Sonderanfragen gefunden.</div>
      ) : (
        <div className="rounded-2xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-bold uppercase tracking-wide text-[#90939a] border-b border-[#ced4da] dark:border-[#3e4042]">
                <th className="px-4 py-3">Datum</th>
                <th className="px-4 py-3">Techniker</th>
                <th className="px-4 py-3">Beschreibung</th>
                <th className="px-4 py-3">Kategorie</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Wert (€)</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((r) => {
                const dirty = (entwurf[r.id] ?? "") !== fmtEuro(r.sonderWert);
                return (
                  <tr key={r.id} className="border-b border-[#f0f2f5] dark:border-[#3a3b3c] last:border-0 align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-[#65676b] dark:text-[#b0b3b8] tabular-nums">{fmtDatum(r.datum)}</td>
                    <td className="px-4 py-3 whitespace-nowrap font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">{r.techniker}</td>
                    <td className="px-4 py-3 max-w-md">
                      <div className="text-[#1a1a1a] dark:text-[#e4e6eb]">{r.beschreibung?.trim() || <span className="text-[#90939a]">—</span>}</div>
                      <div className="text-xs text-[#90939a] truncate">{r.geraet}{r.logId ? ` · ${r.logId}` : ""}</div>
                    </td>
                    <td className="px-4 py-3 text-[#65676b] dark:text-[#b0b3b8]">{r.sonderKategorie?.trim() || "—"}</td>
                    <td className="px-4 py-3"><StatusText status={r.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={`Wert für Sonderanfrage ${r.id} in Euro`}
                        className={inputCls}
                        placeholder={fmtEuro(PAUSCHALE)}
                        value={entwurf[r.id] ?? ""}
                        disabled={!darfBearbeiten}
                        onChange={(e) => setEntwurf((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      />
                      {dirty && <span className="ml-2 align-middle inline-block w-2 h-2 rounded-full bg-amber-500" aria-label="ungespeichert" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {darfBearbeiten ? (
        <div className="sticky bottom-0 mt-4 flex items-center justify-end gap-3 py-3">
          <button
            type="button"
            onClick={speichern}
            disabled={setzen.isPending || geaendert.length === 0}
            className="inline-flex items-center justify-center gap-2 rounded-xl px-6 min-h-[52px] text-base font-black text-white shadow-sm disabled:opacity-40 transition-opacity"
            style={{ background: AKZENT }}
          >
            {setzen.isPending ? "Speichert…" : `Speichern${geaendert.length ? ` (${geaendert.length})` : ""}`}
          </button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-[#90939a]">Nur-Lese-Zugriff — Werte setzen dürfen nur Admins.</p>
      )}
    </div>
  );
}

function StatusText({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    ABGESCHLOSSEN:   { label: "Abgeschlossen", cls: "bg-[#04B475]/15 text-[#04B475]" },
    BEDARF:          { label: "Bedarf",        cls: "bg-[#f7b928]/20 text-[#a97a00]" },
    NEU:             { label: "Neu",           cls: "bg-[#008BD2]/15 text-[#0064d2]" },
    IN_BEARBEITUNG:  { label: "In Arbeit",     cls: "bg-[#008BD2]/15 text-[#0064d2]" },
    STORNIERT:       { label: "Storniert",     cls: "bg-[#b3261e]/15 text-[#b3261e]" },
    NICHT_VERFUEGBAR:{ label: "Nicht verfügbar", cls: "bg-[#65676b]/15 text-[#65676b]" },
  };
  const s = map[status] ?? { label: status, cls: "bg-[#65676b]/15 text-[#65676b]" };
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold whitespace-nowrap ${s.cls}`}>{s.label}</span>;
}

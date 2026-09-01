"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/trpc/react";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/components/ui/Toast";

const AKZENT = "#04B475";

// Deutsche Euro-Eingabe → number | null | NaN(=ungültig).
// "" → null (kein Preis). Komma = Dezimaltrennzeichen; Tausenderpunkte werden
// nur entfernt, wenn ein Komma vorhanden ist (sonst gilt der Punkt als Dezimal).
function parseEuro(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  let norm = t.replace(/\s/g, "");
  if (norm.includes(",")) norm = norm.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(norm);
  if (!isFinite(n) || n < 0) return NaN;
  return Math.round(n * 100) / 100;
}

// number → "12,50" fürs Eingabefeld
function fmtEuro(n: number | null): string {
  return n == null ? "" : n.toFixed(2).replace(".", ",");
}

export default function PreisePage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfSehen      = has("ARTIKEL_VIEW");
  const darfBearbeiten = has("ARTIKEL_EDIT");

  const { show } = useToast();
  const utils = api.useUtils();

  const listeQ = api.preise.kategorienMitPreis.useQuery(undefined, { enabled: darfSehen });

  // Lokaler Eingabe-Entwurf: kategorie → Eingabestring. Aus der Query geseedet.
  const [entwurf, setEntwurf] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!listeQ.data) return;
    setEntwurf(Object.fromEntries(listeQ.data.map((r) => [r.kategorie, fmtEuro(r.preis)])));
  }, [listeQ.data]);

  const setzen = api.preise.setzePreise.useMutation({
    onSuccess: (res) => {
      const teile: string[] = [];
      if (res.gespeichert) teile.push(`${res.gespeichert} gespeichert`);
      if (res.geloescht)   teile.push(`${res.geloescht} entfernt`);
      show(`✅ Preise aktualisiert${teile.length ? ` (${teile.join(", ")})` : ""}`, "success");
      void utils.preise.kategorienMitPreis.invalidate();
    },
    onError: (e) => show(e.message, "error"),
  });

  // Geänderte Zeilen ggü. dem geladenen Stand ermitteln.
  const geaendert = useMemo(() => {
    if (!listeQ.data) return [] as string[];
    return listeQ.data
      .filter((r) => (entwurf[r.kategorie] ?? "") !== fmtEuro(r.preis))
      .map((r) => r.kategorie);
  }, [listeQ.data, entwurf]);

  function speichern() {
    const eintraege: { kategorie: string; preis: number | null }[] = [];
    for (const kategorie of geaendert) {
      const preis = parseEuro(entwurf[kategorie] ?? "");
      if (typeof preis === "number" && Number.isNaN(preis)) {
        show(`Ungültiger Preis bei „${kategorie}". Bitte eine Zahl ≥ 0 eingeben (z.B. 12,50).`, "error");
        return;
      }
      eintraege.push({ kategorie, preis });
    }
    if (eintraege.length === 0) { show("Nichts geändert.", "info"); return; }
    setzen.mutate({ eintraege });
  }

  // Anzahl Kategorien mit hinterlegtem Preis (aus dem aktuellen Entwurf).
  const mitPreis = useMemo(
    () => Object.values(entwurf).filter((v) => v.trim() !== "").length,
    [entwurf],
  );

  if (permsLoading) {
    return <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Lade Berechtigungen…</div>;
  }
  if (!darfSehen) {
    return <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Kein Zugriff auf Kategorie-Preise.</div>;
  }

  const inputCls =
    "w-32 min-h-[44px] text-right rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#3a3b3c] px-3 py-2 text-base font-semibold text-[#202F61] dark:text-[#e4e6eb] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#04B475] disabled:opacity-50";

  return (
    <div className="max-w-3xl mx-auto">
      <header className="mb-5">
        <h1 className="text-2xl font-black text-[#202F61] dark:text-[#e4e6eb]">💶 Kategorie-Preise</h1>
        <p className="mt-1 text-base text-[#65676b] dark:text-[#b0b3b8]">
          Stückpreis je Ersatzteil-Kategorie. Grundlage für die Auswertung „Wert ausgegeben über
          Anfragen". Eingabe als Euro mit Komma (z.B. <span className="font-mono">12,50</span>). Leer = kein Preis.
        </p>
      </header>

      {listeQ.isLoading ? (
        <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Lade Kategorien…</div>
      ) : !listeQ.data || listeQ.data.length === 0 ? (
        <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Keine Artikel-Kategorien gefunden.</div>
      ) : (
        <>
          <div className="mb-3 text-sm text-[#65676b] dark:text-[#b0b3b8]">
            {listeQ.data.length} Kategorien · <span className="font-bold" style={{ color: AKZENT }}>{mitPreis} mit Preis</span>
            {geaendert.length > 0 && (
              <span className="ml-2 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 px-2 py-0.5 text-xs font-bold">
                {geaendert.length} ungespeichert
              </span>
            )}
          </div>

          <div className="rounded-2xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] shadow-sm overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs font-bold uppercase tracking-wide text-[#90939a] border-b border-[#ced4da] dark:border-[#3e4042]">
                  <th className="px-4 py-3">Kategorie</th>
                  <th className="px-4 py-3 text-right">Artikel</th>
                  <th className="px-4 py-3 text-right">Preis (€)</th>
                </tr>
              </thead>
              <tbody>
                {listeQ.data.map((r) => {
                  const dirty = (entwurf[r.kategorie] ?? "") !== fmtEuro(r.preis);
                  return (
                    <tr key={r.kategorie} className="border-b border-[#f0f2f5] dark:border-[#3a3b3c] last:border-0">
                      <td className="px-4 py-3 text-base font-bold text-[#202F61] dark:text-[#e4e6eb]">
                        {r.kategorie}
                        {dirty && <span className="ml-2 align-middle inline-block w-2 h-2 rounded-full bg-amber-500" aria-label="ungespeichert" />}
                      </td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums text-[#65676b] dark:text-[#b0b3b8]">{r.anzahl}</td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={`Preis für ${r.kategorie} in Euro`}
                          className={inputCls}
                          placeholder="—"
                          value={entwurf[r.kategorie] ?? ""}
                          disabled={!darfBearbeiten}
                          onChange={(e) => setEntwurf((prev) => ({ ...prev, [r.kategorie]: e.target.value }))}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {darfBearbeiten && (
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
          )}

          {!darfBearbeiten && (
            <p className="mt-4 text-sm text-[#90939a]">Nur-Lese-Zugriff. Zum Ändern fehlt das Recht „Artikel bearbeiten".</p>
          )}
        </>
      )}
    </div>
  );
}

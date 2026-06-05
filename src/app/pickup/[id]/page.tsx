"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { api } from "@/trpc/react";
import { formatLogId } from "@/lib/pickup/logId";
import { playScanSound, type ScanResult } from "@/lib/pickup/scanSound";

type Feedback = {
  result:   ScanResult;
  logId:    string;
  position: {
    id: number; logId: string; colli: string | null; stellplatz: string | null;
    bezeichnung: string | null; status: string; gefundenVonName: string | null; gefundenAm: Date | string | null;
  } | null;
};

function fmtZeit(d: Date | string | null): string {
  if (!d) return "";
  return new Date(d).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

// Großes, farbcodiertes Ergebnis-Banner — IMMER Icon + Text (nicht nur Farbe).
function ErgebnisBanner({ fb }: { fb: Feedback | null }) {
  if (!fb) {
    return (
      <div role="status" className="rounded-2xl border-2 border-dashed border-[#ced4da] dark:border-[#3e4042] p-5 text-center text-[#65676b] dark:text-[#b0b3b8] text-lg">
        Bereit zum Scannen…
      </div>
    );
  }
  const p = fb.position;
  if (fb.result === "GEFUNDEN") {
    return (
      <div role="status" aria-live="assertive" className="rounded-2xl border-2 p-5" style={{ borderColor: "#04B475", background: "rgba(4,180,117,0.10)" }}>
        <div className="flex items-center gap-4">
          <span className="text-5xl" aria-hidden>✓</span>
          <div className="min-w-0">
            <div className="text-2xl font-black" style={{ color: "#04713f" }}>Gefunden</div>
            <div className="text-base font-bold text-[#202F61] dark:text-[#e4e6eb] font-mono">{formatLogId(fb.logId)}</div>
            <div className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
              {p?.bezeichnung ?? "—"} · Colli {p?.colli ?? "—"} · Stellplatz {p?.stellplatz ?? "—"}
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (fb.result === "SCHON") {
    return (
      <div role="status" aria-live="assertive" className="rounded-2xl border-2 p-5" style={{ borderColor: "#BA7517", background: "rgba(186,117,23,0.10)" }}>
        <div className="flex items-center gap-4">
          <span className="text-5xl" aria-hidden>⚠</span>
          <div className="min-w-0">
            <div className="text-2xl font-black" style={{ color: "#BA7517" }}>Schon gescannt</div>
            <div className="text-base font-bold text-[#202F61] dark:text-[#e4e6eb] font-mono">{formatLogId(fb.logId)}</div>
            <div className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
              von {p?.gefundenVonName ?? "—"}{p?.gefundenAm ? `, ${fmtZeit(p.gefundenAm)}` : ""}
            </div>
          </div>
        </div>
      </div>
    );
  }
  // FREMD
  return (
    <div role="status" aria-live="assertive" className="rounded-2xl border-2 p-5" style={{ borderColor: "#fa3e3e", background: "rgba(250,62,62,0.10)" }}>
      <div className="flex items-center gap-4">
        <span className="text-5xl" aria-hidden>✗</span>
        <div className="min-w-0">
          <div className="text-2xl font-black" style={{ color: "#b3261e" }}>Nicht auf der Liste</div>
          <div className="text-base font-bold text-[#202F61] dark:text-[#e4e6eb] font-mono">{fb.logId ? formatLogId(fb.logId) : "—"}</div>
        </div>
      </div>
    </div>
  );
}

export default function PickupScanPage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfPick = has("PICKUP_PICK");

  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const router = useRouter();
  const utils = api.useUtils();
  const inputRef = useRef<HTMLInputElement>(null);

  const [eingabe, setEingabe]       = useState("");
  const [feedback, setFeedback]     = useState<Feedback | null>(null);
  const [fremdScans, setFremdScans] = useState<{ logId: string; zeit: Date }[]>([]);

  const { data, isLoading, error } = api.pickup.pickDetails.useQuery(
    { id },
    { enabled: !permsLoading && darfPick && Number.isInteger(id) && id > 0 },
  );

  const scan = api.pickup.scan.useMutation({
    onSuccess: (res, vars) => {
      setFeedback(res as Feedback);
      playScanSound(res.result);
      if (res.result === "FREMD") {
        setFremdScans((prev) => [{ logId: res.logId || vars.logIdRaw, zeit: new Date() }, ...prev].slice(0, 50));
      }
      void utils.pickup.pickDetails.invalidate({ id });
    },
    onSettled: () => { setEingabe(""); inputRef.current?.focus(); },
  });

  const zuruecksetzen = api.pickup.treffersZuruecksetzen.useMutation({
    onSuccess: () => { void utils.pickup.pickDetails.invalidate({ id }); inputRef.current?.focus(); },
  });

  // Nach jedem Ergebnis Fokus zurück ins Scan-Feld (Handheld-tauglich).
  useEffect(() => { inputRef.current?.focus(); }, [feedback]);

  // Positionen nach Colli gruppieren — STABILE, deterministische Sortierung
  // (Colli natürlich aufsteigend, ohne Colli zuletzt; intern Stellplatz, dann LogId).
  const gruppen = useMemo(() => {
    const positionen = data?.positionen ?? [];
    const map = new Map<string, typeof positionen>();
    for (const p of positionen) {
      const key = p.colli ?? "";
      const arr = map.get(key);
      if (arr) arr.push(p); else map.set(key, [p]);
    }
    const out = [...map.entries()].map(([colli, items]) => ({ colli, items }));
    out.sort((a, b) => {
      if (a.colli === "" && b.colli === "") return 0;
      if (a.colli === "") return 1;
      if (b.colli === "") return -1;
      return a.colli.localeCompare(b.colli, "de", { numeric: true });
    });
    for (const g of out) {
      g.items.sort((x, y) => {
        const s = (x.stellplatz ?? "").localeCompare(y.stellplatz ?? "", "de", { numeric: true });
        return s !== 0 ? s : x.logId.localeCompare(y.logId, "de", { numeric: true });
      });
    }
    return out;
  }, [data]);

  function handleScan() {
    const v = eingabe.trim();
    if (!v || scan.isPending) return;
    scan.mutate({ auftragId: id, logIdRaw: v });
  }

  if (permsLoading) {
    return <div className="min-h-screen flex items-center justify-center text-[#65676b] dark:text-[#b0b3b8]">Lade Berechtigungen…</div>;
  }
  if (!darfPick) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center text-[#65676b] dark:text-[#b0b3b8]">
        Kein Zugriff auf die Scan-Ansicht. Bitte das Recht <strong className="mx-1">PICKUP_PICK</strong> bei der Rolle aktivieren.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb]">
      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
        {/* Kopf */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <button onClick={() => router.back()} className="text-[#65676b] dark:text-[#b0b3b8] hover:text-[#008BD2] text-sm mb-1">← Zurück</button>
            <h1 className="text-2xl font-black text-[#202F61] dark:text-[#e4e6eb] truncate">
              {isLoading ? "Lade…" : (data?.name ?? "Pickup")}
            </h1>
          </div>
        </div>

        {error || (!isLoading && !data) ? (
          <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8] bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042]">
            Auftrag nicht gefunden.
          </div>
        ) : (
          <>
            {/* Fortschritt */}
            {data && (() => {
              const pct = data.gesamt > 0 ? Math.round((data.gefunden / data.gesamt) * 100) : 0;
              return (
                <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-[#65676b] dark:text-[#b0b3b8]">Fortschritt</span>
                    <span className="text-lg font-black text-[#202F61] dark:text-[#e4e6eb]">{data.gefunden} / {data.gesamt} · {pct}%</span>
                  </div>
                  <div className="h-3 w-full rounded-full bg-[#f0f2f5] dark:bg-[#18191a] overflow-hidden" role="progressbar" aria-valuenow={data.gefunden} aria-valuemin={0} aria-valuemax={data.gesamt}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: "#04B475" }} />
                  </div>
                </div>
              );
            })()}

            {/* Scan-Feld */}
            <form onSubmit={(e) => { e.preventDefault(); handleScan(); }} className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] p-4 space-y-3">
              <label htmlFor="scan-input" className="block text-sm font-bold text-[#202F61] dark:text-[#e4e6eb]">LogID scannen</label>
              <div className="flex gap-2">
                <input
                  id="scan-input"
                  ref={inputRef}
                  value={eingabe}
                  onChange={(e) => setEingabe(e.target.value)}
                  autoFocus
                  autoComplete="off"
                  inputMode="numeric"
                  enterKeyHint="done"
                  spellCheck={false}
                  placeholder="LogID scannen oder eingeben…"
                  className="flex-1 min-w-0 px-4 rounded-xl border-2 border-[#008BD2]/40 bg-[#f0f2f5] dark:bg-[#18191a] text-2xl font-mono font-bold text-[#202F61] dark:text-[#e4e6eb] outline-none focus:border-[#008BD2] focus:ring-2 focus:ring-[#008BD2]/30 transition-colors min-h-[56px]"
                />
                <button
                  type="submit"
                  disabled={!eingabe.trim() || scan.isPending}
                  className="px-6 rounded-xl bg-[#008BD2] text-white text-base font-bold hover:bg-[#0077b5] disabled:opacity-40 transition-colors min-h-[56px] min-w-[56px]"
                >
                  Prüfen
                </button>
              </div>
            </form>

            {/* Ergebnis */}
            <ErgebnisBanner fb={feedback} />

            {/* Fremd-Scans dieser Sitzung */}
            {fremdScans.length > 0 && (
              <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#fa3e3e]/30 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-[#b3261e]">✗ Fremd-Scans (diese Sitzung): {fremdScans.length}</span>
                  <button onClick={() => setFremdScans([])} className="text-xs text-[#65676b] dark:text-[#b0b3b8] hover:text-[#fa3e3e]">Leeren</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {fremdScans.slice(0, 20).map((f, i) => (
                    <span key={i} className="px-2 py-1 rounded-lg bg-[#fa3e3e]/10 text-[#b3261e] text-xs font-mono font-bold">
                      {f.logId ? formatLogId(f.logId) : "—"} · {f.zeit.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Live-Liste nach Colli */}
            <div className="space-y-4">
              {gruppen.map((g) => {
                const gefunden = g.items.filter((p) => p.status === "GEFUNDEN").length;
                return (
                  <div key={g.colli || "__ohne__"} className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between gap-2 px-5 py-3 bg-[#f0f2f5] dark:bg-[#18191a] border-b border-[#ced4da] dark:border-[#3e4042]">
                      <h2 className="font-black text-sm text-[#202F61] dark:text-[#e4e6eb]">📦 Colli {g.colli || "— (ohne Colli)"}</h2>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#008BD2]/10 text-[#008BD2] dark:text-[#45bdff]">{gefunden}/{g.items.length}</span>
                    </div>
                    <div className="divide-y divide-[#f0f2f5] dark:divide-[#3e4042]">
                      {g.items.map((p) => {
                        const ok = p.status === "GEFUNDEN";
                        return (
                          <div key={p.id} className={`flex items-center gap-3 px-5 py-3 flex-wrap gap-y-1 ${ok ? "bg-[#04B475]/5" : ""}`}>
                            <span className="text-lg w-6 text-center" aria-hidden>{ok ? "✓" : "○"}</span>
                            <div className="font-mono font-black text-base min-w-[120px]" style={{ color: ok ? "#04713f" : undefined }}>
                              {formatLogId(p.logId)}
                            </div>
                            <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] min-w-[80px]">{p.stellplatz ?? "—"}</div>
                            <div className="flex-1 min-w-0 text-sm truncate" title={p.bezeichnung ?? ""}>{p.bezeichnung ?? "—"}</div>
                            {ok ? (
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] text-[#04713f] font-semibold whitespace-nowrap">
                                  {p.gefundenVonName ?? ""}{p.gefundenAm ? ` · ${fmtZeit(p.gefundenAm)}` : ""}
                                </span>
                                <button
                                  onClick={() => zuruecksetzen.mutate({ positionId: p.id })}
                                  disabled={zuruecksetzen.isPending}
                                  className="text-[11px] text-[#65676b] dark:text-[#b0b3b8] hover:text-[#fa3e3e] underline disabled:opacity-50"
                                  aria-label={`Treffer ${formatLogId(p.logId)} zurücksetzen`}
                                >
                                  Zurücksetzen
                                </button>
                              </div>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#65676b]/10 text-[#65676b] dark:text-[#b0b3b8]">Offen</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { api } from "@/trpc/react";
import { formatLogId } from "@/lib/pickup/logId";
import { playScanSound, playComplete, type ScanResult } from "@/lib/pickup/scanSound";

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
  const [tastatur, setTastatur]     = useState(false); // Soft-Tastatur erlauben (Default: aus)
  const [abschlussDialog, setAbschlussDialog] = useState(false);
  const [abschlussErgebnis, setAbschlussErgebnis] = useState<{ name: string; gesamt: number; gefunden: number; nichtGefunden: number } | null>(null);
  const prevVollRef = useRef<boolean | null>(null); // vorheriger Vollständig-Stand (für Live-Trigger)

  const abschliessen = api.pickup.abschliessen.useMutation({
    onSuccess: (r) => {
      setAbschlussErgebnis({ name: r.name, gesamt: r.gesamt, gefunden: r.gefunden, nichtGefunden: r.nichtGefunden });
      setTimeout(() => router.push("/pickup"), 1800);
    },
  });

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

  // Vollständigkeit erkennen. Ton NUR beim Live-Übergang unvollständig→vollständig
  // (nicht beim Öffnen eines bereits vollständigen Auftrags). Beim Zurückfallen
  // unter vollständig wird der Trigger wieder scharf gestellt.
  const vollstaendig = !!data && data.gesamt > 0 && data.gefunden === data.gesamt;
  useEffect(() => {
    if (!data) return;
    const istVoll = data.gesamt > 0 && data.gefunden === data.gesamt;
    if (prevVollRef.current === null) { prevVollRef.current = istVoll; return; } // Initial: nur merken
    if (istVoll && !prevVollRef.current) playComplete();
    prevVollRef.current = istVoll;
  }, [data]);

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
    return <div className="py-16 text-center text-[#65676b] dark:text-[#b0b3b8]">Lade Berechtigungen…</div>;
  }
  if (!darfPick) {
    return (
      <div className="py-16 text-center text-[#65676b] dark:text-[#b0b3b8]">
        Kein Zugriff auf die Scan-Ansicht. Bitte das Recht <strong className="mx-1">PICKUP_PICK</strong> bei der Rolle aktivieren.
      </div>
    );
  }

  return (
    <div className="space-y-5">
        {/* Kopf */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <Link href="/pickup" className="inline-block text-[#65676b] dark:text-[#b0b3b8] hover:text-[#008BD2] text-sm mb-1">← Zur Auftragsliste</Link>
            <h1 className="text-2xl font-black text-[#202F61] dark:text-[#e4e6eb] truncate">
              {isLoading ? "Lade…" : (data?.name ?? "Pickup")}
            </h1>
            {data?.bemerkung && (
              <div className="mt-1 inline-flex items-start gap-2 px-3 py-2 rounded-xl bg-[#008BD2]/10 text-[#202F61] dark:text-[#e4e6eb] text-base font-semibold">
                <span aria-hidden>📝</span>
                <span className="whitespace-pre-wrap break-words">{data.bemerkung}</span>
              </div>
            )}
          </div>
          {data && (
            <button
              onClick={() => setAbschlussDialog(true)}
              className="inline-flex items-center gap-2 px-5 rounded-xl bg-[#04B475] text-white text-base font-bold hover:bg-[#039c64] transition-colors shadow-sm min-h-[56px] flex-shrink-0"
            >
              ✓ Auftrag abschließen
            </button>
          )}
        </div>

        {error || (!isLoading && !data) ? (
          <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8] bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042]">
            Auftrag nicht gefunden.
          </div>
        ) : (
          <>
            {/* Großer Fortschritts-Zähler (dominant) */}
            {data && (
              <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] p-4 text-center">
                <div className="text-4xl sm:text-5xl font-black text-[#202F61] dark:text-[#e4e6eb] leading-none">
                  {data.gefunden} <span className="text-[#65676b] dark:text-[#b0b3b8]">/</span> {data.gesamt}
                </div>
                <div className="text-xs font-bold uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8] mt-1">gefunden</div>
                <div className="h-1 w-full rounded-full bg-[#f0f2f5] dark:bg-[#18191a] overflow-hidden mt-3" role="progressbar" aria-valuenow={data.gefunden} aria-valuemin={0} aria-valuemax={data.gesamt}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${data.gesamt > 0 ? Math.round((data.gefunden / data.gesamt) * 100) : 0}%`, background: "#04B475" }} />
                </div>
              </div>
            )}

            {/* Vollständig-Banner (100 %) — klarer nächster Schritt */}
            {vollstaendig && data && (
              <div role="status" aria-live="assertive" className="rounded-2xl border-2 p-5 flex items-center justify-between gap-4 flex-wrap" style={{ borderColor: "#04B475", background: "rgba(4,180,117,0.12)" }}>
                <div className="flex items-center gap-4 min-w-0">
                  <span className="text-5xl" aria-hidden>✅</span>
                  <div className="min-w-0">
                    <div className="text-xl font-black" style={{ color: "#04713f" }}>Vollständig</div>
                    <div className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">Alle {data.gesamt} Geräte gescannt!</div>
                  </div>
                </div>
                <button
                  onClick={() => setAbschlussDialog(true)}
                  className="inline-flex items-center gap-2 px-5 rounded-xl bg-[#04B475] text-white text-base font-bold hover:bg-[#039c64] transition-colors shadow-sm min-h-[56px] flex-shrink-0"
                >
                  ✓ Auftrag abschließen
                </button>
              </div>
            )}

            {/* Scan-Feld (prominent, autofokussiert) */}
            <form onSubmit={(e) => { e.preventDefault(); handleScan(); }} className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="scan-input" className="text-sm font-bold text-[#202F61] dark:text-[#e4e6eb]">LogID scannen</label>
                <button
                  type="button"
                  onClick={() => { setTastatur((v) => !v); inputRef.current?.focus(); }}
                  aria-pressed={tastatur}
                  title="Soft-Tastatur für manuelle Eingabe ein-/ausschalten"
                  className={`inline-flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold transition-colors min-h-[44px] ${tastatur
                    ? "bg-[#008BD2]/10 text-[#008BD2] dark:text-[#45bdff] border border-[#008BD2]/40"
                    : "text-[#65676b] dark:text-[#b0b3b8] border border-[#ced4da] dark:border-[#3e4042] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"}`}
                >
                  ⌨ Tastatur {tastatur ? "an" : "aus"}
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  id="scan-input"
                  ref={inputRef}
                  value={eingabe}
                  onChange={(e) => setEingabe(e.target.value)}
                  autoFocus
                  autoComplete="off"
                  inputMode={tastatur ? "numeric" : "none"}
                  enterKeyHint="done"
                  spellCheck={false}
                  placeholder="LogID scannen…"
                  className="flex-1 min-w-0 px-4 rounded-xl border-2 border-[#008BD2]/40 bg-[#f0f2f5] dark:bg-[#18191a] text-2xl font-mono font-bold text-[#202F61] dark:text-[#e4e6eb] outline-none focus:border-[#008BD2] focus:ring-2 focus:ring-[#008BD2]/30 transition-colors min-h-[56px]"
                />
                {tastatur && (
                  <button
                    type="submit"
                    disabled={!eingabe.trim() || scan.isPending}
                    className="px-6 rounded-xl bg-[#008BD2] text-white text-base font-bold hover:bg-[#0077b5] disabled:opacity-40 transition-colors min-h-[56px] min-w-[56px]"
                  >
                    Prüfen
                  </button>
                )}
              </div>
            </form>

            {/* Ergebnis des letzten Scans */}
            <ErgebnisBanner fb={feedback} />

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

            {/* Fremd-Scans dieser Sitzung — kompakt, ganz unten */}
            {fremdScans.length > 0 && (
              <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#fa3e3e]/30 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-[#b3261e]">✗ Fremd-Scans (Sitzung): {fremdScans.length}</span>
                  <button onClick={() => setFremdScans([])} className="text-xs text-[#65676b] dark:text-[#b0b3b8] hover:text-[#fa3e3e] min-h-[44px] px-1">Leeren</button>
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
          </>
        )}

        {/* Abschluss-Dialog (Bestätigung + Erfolg) */}
        {abschlussDialog && data && (
          <div role="dialog" aria-modal="true" aria-labelledby="pickup-abschluss-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => { if (!abschliessen.isPending && !abschlussErgebnis) setAbschlussDialog(false); }}>
            <div className="bg-white dark:bg-[#242526] rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
              {abschlussErgebnis ? (
                <div className="px-6 py-8 text-center space-y-3">
                  <div className="text-5xl" aria-hidden>✅</div>
                  <h2 className="font-black text-xl text-[#202F61] dark:text-[#e4e6eb]">Auftrag abgeschlossen</h2>
                  <p className="text-base text-[#1a1a1a] dark:text-[#e4e6eb]">
                    {abschlussErgebnis.gefunden} von {abschlussErgebnis.gesamt} gefunden{abschlussErgebnis.nichtGefunden > 0 ? `, ${abschlussErgebnis.nichtGefunden} nicht gefunden` : ""}.
                  </p>
                  <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Weiter zur Auftragsliste…</p>
                </div>
              ) : (
                <>
                  <div className="px-6 pt-6 pb-4 text-center space-y-3">
                    <div className="text-4xl" aria-hidden>{(data.gesamt - data.gefunden) > 0 ? "⚠️" : "✓"}</div>
                    <h2 id="pickup-abschluss-title" className="font-black text-lg text-[#202F61] dark:text-[#e4e6eb]">Auftrag abschließen?</h2>
                    <div className="px-4 py-3 bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
                      <strong>{data.gefunden}</strong> von <strong>{data.gesamt}</strong> Positionen gefunden.
                    </div>
                    {(data.gesamt - data.gefunden) > 0 && (
                      <div className="px-4 py-3 rounded-xl text-sm font-semibold" style={{ background: "rgba(186,117,23,0.12)", color: "#BA7517" }}>
                        ⚠ {data.gesamt - data.gefunden} Positionen wurden NICHT gefunden — trotzdem abschließen?
                      </div>
                    )}
                  </div>
                  <div className="flex gap-3 px-6 pb-6">
                    <button onClick={() => setAbschlussDialog(false)} disabled={abschliessen.isPending}
                      className="flex-1 text-sm text-[#65676b] dark:text-[#b0b3b8] font-semibold border border-[#ced4da] dark:border-[#3e4042] rounded-xl hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors min-h-[56px] disabled:opacity-50">
                      Abbrechen
                    </button>
                    <button onClick={() => abschliessen.mutate({ id })} disabled={abschliessen.isPending}
                      className="flex-1 bg-[#04B475] text-white text-sm font-bold rounded-xl hover:bg-[#039c64] disabled:opacity-50 transition-colors min-h-[56px]">
                      {abschliessen.isPending ? "Schließe ab…" : "Ja, abschließen"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
    </div>
  );
}

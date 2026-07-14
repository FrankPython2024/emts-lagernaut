"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/trpc/react";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/components/ui/Toast";

const AKZENT = "#008BD2";

// „Auf Colli buchen" (Session): Colli EINMAL scannen → öffnet eine laufende
// Browser-Session in ReForm → danach LogIDs am Stück scannen (jede wird sofort
// draufgebucht). „Session beenden" schließt sie (oder 5 Min Leerlauf).
export default function UmbuchenPage() {
  const { has, isLoading } = usePermissions();
  const darf = has("MOBIL_MANAGE");
  const { show } = useToast();

  const [colli, setColli]   = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [logId, setLogId]   = useState("");
  const colliRef = useRef<HTMLInputElement>(null);
  const logRef   = useRef<HTMLInputElement>(null);

  const statusQ = api.reform.sessionStatus.useQuery(undefined, {
    refetchInterval: (q) => (q.state.data?.offen ? 1200 : false),
    refetchOnWindowFocus: true,
  });
  const s      = statusQ.data;
  const offen  = !!s?.offen;
  const bereit = !!s?.bereit;
  const oeffnet = offen && s?.state === "start";

  const starten = api.reform.sessionStarten.useMutation({
    onSuccess: (r) => { if (r.gestartet) { show("📦 Colli-Session startet…", "info"); void statusQ.refetch(); } else show(r.grund ?? "Läuft bereits.", "info"); },
    onError: (e) => show(e.message, "error"),
  });
  const scanLog = api.reform.sessionLogId.useMutation({
    onSuccess: (r) => { if (r.ok) { setLogId(""); logRef.current?.focus(); void statusQ.refetch(); } else show(r.grund ?? "Keine offene Session.", "error"); },
    onError: (e) => show(e.message, "error"),
  });
  const beenden = api.reform.sessionBeenden.useMutation({
    onSuccess: () => { show("Session wird beendet…", "info"); void statusQ.refetch(); },
    onError: (e) => show(e.message, "error"),
  });

  // Fokus aufs LogID-Feld, sobald die Session bereit ist.
  useEffect(() => { if (bereit) logRef.current?.focus(); }, [bereit]);

  if (isLoading) return <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Lade…</div>;
  if (!darf)     return <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Kein Zugriff (Recht MOBIL_MANAGE).</div>;

  function starteSession() {
    if (!colli.trim()) { show("Colli scannen.", "error"); return; }
    starten.mutate({ colli: colli.trim(), dryRun });
  }
  function scanne() {
    const v = logId.trim();
    if (v) scanLog.mutate({ logId: v });
  }

  const gebucht = s?.gebucht ?? [];
  const okAnzahl = gebucht.filter((g) => g.ok).length;
  const feld = "w-full px-3 min-h-[56px] rounded-xl border-2 border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#3a3b3c] text-xl font-bold tabular-nums text-[#202F61] dark:text-[#e4e6eb] outline-none focus:border-[#008BD2] disabled:opacity-50";
  const karte = "rounded-2xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] p-5 shadow-sm";

  return (
    <div className="max-w-md mx-auto space-y-5">
      <header>
        <Link href="/admin/mobil" className="text-sm text-[#0064d2] dark:text-[#45bdff]">← Mobil-Ersatzteile</Link>
        <h1 className="mt-1 text-2xl font-black text-[#202F61] dark:text-[#e4e6eb]">📦 Auf Colli buchen</h1>
        <p className="mt-1 text-sm text-[#65676b] dark:text-[#b0b3b8]">
          Colli einmal scannen → dann LogIDs am Stück scannen. Jede wird sofort in ReForm draufgebucht.
        </p>
      </header>

      {!offen ? (
        /* ── Start: Colli scannen ──────────────────────────────────────────── */
        <div className={`${karte} space-y-4`}>
          <label className="block">
            <span className="block text-xs font-bold uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8] mb-1">Colli-Nummer scannen</span>
            <input ref={colliRef} autoFocus value={colli} disabled={starten.isPending}
              onChange={(e) => setColli(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); starteSession(); } }}
              placeholder="Colli scannen…" className={feld} aria-label="Colli-Nummer" />
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="w-5 h-5 accent-[#008BD2]" />
            <span className="text-sm text-[#65676b] dark:text-[#b0b3b8]">🧪 Trockenlauf — prüft nur, <strong>bucht nicht</strong></span>
          </label>
          <button type="button" onClick={starteSession} disabled={starten.isPending || !colli.trim()}
            className="w-full min-h-[56px] rounded-xl text-white text-lg font-black disabled:opacity-40"
            style={{ background: dryRun ? "#65676b" : AKZENT }}>
            {starten.isPending ? "startet…" : "📦 Colli öffnen"}
          </button>

          {s?.state === "beendet" && (
            <div className="text-sm text-[#04B475]">✅ Letzte Session beendet — {okAnzahl} Teil(e) gebucht.</div>
          )}
          {s?.state === "fehler" && (
            <div className="text-sm text-[#b3261e]">⚠️ {s.fehler || "Session fehlgeschlagen."}</div>
          )}
        </div>
      ) : (
        /* ── Offene Session: LogIDs scannen ─────────────────────────────────── */
        <div className="space-y-4">
          <div className={`${karte} space-y-3 border-[#008BD2]/40`}>
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-[#04B475] animate-pulse shrink-0" aria-hidden />
              <span className="font-bold text-[#202F61] dark:text-[#e4e6eb]">
                {oeffnet ? s?.phase : `Colli ${s?.colli} offen`}{s?.dryRun ? " · 🧪 Trockenlauf" : ""}
              </span>
            </div>

            {bereit && (
              <label className="block">
                <span className="block text-xs font-bold uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8] mb-1">LogID scannen</span>
                <input ref={logRef} value={logId}
                  onChange={(e) => setLogId(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); scanne(); } }}
                  placeholder="LogID scannen…" className={feld} aria-label="LogID" />
              </label>
            )}
            {s?.state === "buchen" && <div className="text-xs font-mono text-[#65676b] dark:text-[#b0b3b8]">{s.phase}</div>}

            <button type="button" onClick={() => beenden.mutate()} disabled={beenden.isPending}
              className="w-full min-h-[48px] rounded-xl font-bold border-2 border-[#b3261e]/40 text-[#b3261e] hover:bg-[#b3261e]/10">
              ⏹️ Session beenden
            </button>
          </div>

          {gebucht.length > 0 && (
            <div className={karte}>
              <div className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-2">
                {okAnzahl} von {gebucht.length} gebucht{s?.dryRun ? " (Trockenlauf)" : ""}
              </div>
              <ul className="space-y-1 max-h-72 overflow-y-auto">
                {[...gebucht].reverse().map((g, i) => (
                  <li key={`${g.ts}-${i}`} className="flex items-center justify-between gap-2 font-mono text-sm">
                    <span className="text-[#1a1a1a] dark:text-[#e4e6eb]">{g.ok ? "✅" : "⚠️"} {g.logId}</span>
                    {!g.ok && <span className="text-xs text-[#b3261e] truncate">{g.fehler}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

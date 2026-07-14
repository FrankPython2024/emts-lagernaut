"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/trpc/react";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/components/ui/Toast";

const AKZENT = "#008BD2";

// „Auf Colli buchen" — Colli scannen → LogID scannen → buchen (über die ReForm-Brücke).
// Trockenlauf default: bucht NICHT, prüft nur den Weg. Erst ohne Häkchen wird echt gebucht.
export default function UmbuchenPage() {
  const { has, isLoading } = usePermissions();
  const darf = has("MOBIL_MANAGE");
  const { show } = useToast();

  const [colli, setColli] = useState("");
  const [logId, setLogId] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const colliRef = useRef<HTMLInputElement>(null);
  const logRef   = useRef<HTMLInputElement>(null);

  const statusQ = api.reform.umbuchenStatus.useQuery(undefined, {
    refetchInterval: (q) => (q.state.data?.aktiv ? 1500 : false),
    refetchOnWindowFocus: false,
  });
  const s = statusQ.data;
  const aktiv = !!s?.aktiv;

  const starten = api.reform.umbuchenStarten.useMutation({
    onSuccess: (r) => {
      if (r.gestartet) { show(dryRun ? "🧪 Trockenlauf gestartet…" : "📦 Umbuchung gestartet…", "info"); void statusQ.refetch(); }
      else show(r.grund ?? "Läuft bereits.", "info");
    },
    onError: (e) => show(e.message, "error"),
  });

  function buchen() {
    if (!colli.trim() || !logId.trim()) { show("Colli und LogID scannen/eingeben.", "error"); return; }
    starten.mutate({ colli: colli.trim(), logId: logId.trim(), dryRun });
  }

  // Nach erfolgreichem Lauf Felder leeren + Fokus zurück auf Colli (für den nächsten Scan).
  const warAktiv = useRef(false);
  useEffect(() => {
    if (warAktiv.current && !aktiv && s?.state === "fertig") {
      setColli(""); setLogId("");
      colliRef.current?.focus();
    }
    warAktiv.current = aktiv;
  }, [aktiv, s?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Lade…</div>;
  if (!darf)     return <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Kein Zugriff (Recht MOBIL_MANAGE).</div>;

  const fehler = s?.state === "fehler";
  const feld = "w-full px-3 min-h-[56px] rounded-xl border-2 border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#3a3b3c] text-xl font-bold tabular-nums text-[#202F61] dark:text-[#e4e6eb] outline-none focus:border-[#008BD2] disabled:opacity-50";

  return (
    <div className="max-w-md mx-auto space-y-5">
      <header>
        <Link href="/admin/mobil" className="text-sm text-[#0064d2] dark:text-[#45bdff]">← Mobil-Ersatzteile</Link>
        <h1 className="mt-1 text-2xl font-black text-[#202F61] dark:text-[#e4e6eb]">📦 Auf Colli buchen</h1>
        <p className="mt-1 text-sm text-[#65676b] dark:text-[#b0b3b8]">
          Colli scannen, dann LogID scannen → buchen. Läuft im Hintergrund über ReForm.
        </p>
      </header>

      <div className="rounded-2xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] p-5 space-y-4 shadow-sm">
        <label className="block">
          <span className="block text-xs font-bold uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8] mb-1">1. Colli-Nummer</span>
          <input
            ref={colliRef} autoFocus value={colli} disabled={aktiv}
            onChange={(e) => setColli(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); logRef.current?.focus(); } }}
            placeholder="scannen oder eingeben…" className={feld} aria-label="Colli-Nummer"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-bold uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8] mb-1">2. LogID</span>
          <input
            ref={logRef} value={logId} disabled={aktiv}
            onChange={(e) => setLogId(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buchen(); } }}
            placeholder="scannen oder eingeben…" className={feld} aria-label="LogID"
          />
        </label>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} disabled={aktiv} className="w-5 h-5 accent-[#008BD2]" />
          <span className="text-sm text-[#65676b] dark:text-[#b0b3b8]">🧪 Trockenlauf — prüft nur den Weg, <strong>bucht nicht</strong></span>
        </label>

        <button
          type="button" onClick={buchen}
          disabled={aktiv || starten.isPending || !colli.trim() || !logId.trim()}
          className="w-full min-h-[56px] rounded-xl text-white text-lg font-black disabled:opacity-40 transition-opacity"
          style={{ background: dryRun ? "#65676b" : AKZENT }}
        >
          {aktiv ? "läuft…" : dryRun ? "🧪 Trockenlauf starten" : "📦 Jetzt buchen"}
        </button>
      </div>

      {/* Status / Ergebnis */}
      {s && s.state !== "leer" && (
        <div className={`rounded-2xl border p-4 ${fehler ? "border-[#b3261e]/40 bg-[#b3261e]/5" : s.state === "fertig" ? "border-[#04B475]/40 bg-[#04B475]/5" : "border-[#008BD2]/40 bg-[#008BD2]/5"}`}>
          <div className="flex items-center gap-2">
            {aktiv && <span className="inline-block w-2 h-2 rounded-full bg-[#008BD2] animate-pulse shrink-0" aria-hidden />}
            <span className="font-mono text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">{fehler ? `⚠️ ${s.fehler || s.phase}` : s.phase}</span>
          </div>
          {(s.colli || s.logId) && (
            <div className="mt-1 text-xs text-[#65676b] dark:text-[#b0b3b8] font-mono">
              Colli {s.colli} · LogID {s.logId}{s.dryRun ? " · Trockenlauf" : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

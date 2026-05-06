"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useDebounce } from "use-debounce";
import { api } from "@/trpc/react";

const HISTORY_KEY = "logid_search_history";
const HISTORY_MAX = 10;

// "212826176" → "212.826.176"  |  bereits formatiert bleibt unverändert
function formatLogId(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}`;
  if (digits.length > 0 && digits.length < 9) return digits; // Eingabe läuft noch
  return raw;
}

function loadHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]"); }
  catch { return []; }
}

function saveHistory(logId: string) {
  const history = [logId, ...loadHistory().filter((l) => l !== logId)].slice(0, HISTORY_MAX);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export default function GeraeteLookupPage() {
  const inputRef               = useRef<HTMLInputElement>(null);
  const [raw,     setRaw]      = useState("");
  const [history, setHistory]  = useState<string[]>([]);
  const [debouncedRaw]         = useDebounce(raw, 300);

  const formatted   = formatLogId(raw);
  const searchValue = formatLogId(debouncedRaw);
  const isReady     = searchValue.replace(/\D/g, "").length >= 6;

  const stats = api.geraeteLookup.getStats.useQuery();
  const query = api.geraeteLookup.byLogId.useQuery(
    { logId: searchValue },
    { enabled: isReady },
  );

  // localStorage nach Hydration laden
  useEffect(() => { setHistory(loadHistory()); }, []);

  // Gefundene Suche in History speichern
  useEffect(() => {
    if (query.data?.gefunden && searchValue) {
      saveHistory(searchValue);
      setHistory(loadHistory());
    }
  }, [query.data, searchValue]);

  // Autofocus
  useEffect(() => { inputRef.current?.focus(); }, []);

  function handleInput(val: string) {
    // Nur Ziffern und Punkte erlauben, Rest verwerfen
    const clean = val.replace(/[^\d.]/g, "");
    setRaw(clean);
  }

  function selectHistory(logId: string) {
    setRaw(logId);
    inputRef.current?.focus();
  }

  const result = query.data;
  const loading = query.isFetching;

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">LogID Suche</h1>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
          Gerät per LogID nachschlagen
        </p>
      </div>

      {/* Suchfeld */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm space-y-3">
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            value={raw}
            onChange={(e) => handleInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") inputRef.current?.blur(); }}
            placeholder="LogID eingeben z.B. 212.826.176"
            className="w-full px-4 py-4 text-2xl font-bold font-mono rounded-xl border-2 border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] dark:focus:border-[#45bdff] transition-colors tracking-widest"
          />
          {raw && (
            <button
              onClick={() => { setRaw(""); inputRef.current?.focus(); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[#65676b] hover:text-[#fa3e3e] text-2xl font-bold transition-colors"
            >
              ✕
            </button>
          )}
        </div>

        {/* Formatierungsvorschau */}
        {raw && formatted !== raw && (
          <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] pl-1">
            Formatiert: <span className="font-mono font-bold text-[#0064d2] dark:text-[#45bdff]">{formatted}</span>
          </p>
        )}
      </div>

      {/* Ergebnis */}
      {isReady && (
        <div className="min-h-[80px]">
          {loading && (
            <div className="flex items-center gap-3 p-5 bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm">
              <div className="w-5 h-5 border-2 border-[#0064d2]/20 border-t-[#0064d2] rounded-full animate-spin flex-shrink-0" />
              <span className="text-[#65676b] dark:text-[#b0b3b8]">Suche läuft…</span>
            </div>
          )}

          {!loading && result?.gefunden && (
            <div className="p-5 bg-white dark:bg-[#242526] rounded-xl border-2 border-[#00a400]/40 shadow-sm space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">✅</span>
                <span className="text-xs font-bold text-[#00a400] uppercase tracking-wider">Gefunden</span>
              </div>
              <div className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb] leading-tight">
                {result.bereinigt}
              </div>
              <div className="flex gap-3 text-sm text-[#65676b] dark:text-[#b0b3b8] flex-wrap">
                <span>LogID: <span className="font-mono font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{result.logId}</span></span>
                {result.hersteller && (
                  <span>Hersteller: <span className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{result.hersteller}</span></span>
                )}
              </div>
            </div>
          )}

          {!loading && result && !result.gefunden && (
            <div className="p-5 bg-white dark:bg-[#242526] rounded-xl border-2 border-[#f7b928]/40 shadow-sm flex items-center gap-3">
              <span className="text-2xl">⚠️</span>
              <div>
                <p className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Gerät nicht in der Datenbank</p>
                <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
                  LogID <span className="font-mono">{searchValue}</span> wurde nicht gefunden.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Letzte Suchen */}
      {history.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase">Letzte Suchen</p>
          <div className="flex flex-wrap gap-2">
            {history.map((logId) => (
              <button
                key={logId}
                onClick={() => selectHistory(logId)}
                className="px-3 py-1.5 font-mono text-sm bg-white dark:bg-[#242526] border border-[#ced4da] dark:border-[#3e4042] rounded-lg hover:border-[#0064d2] hover:text-[#0064d2] dark:hover:border-[#45bdff] dark:hover:text-[#45bdff] transition-colors"
              >
                {logId}
              </button>
            ))}
            <button
              onClick={() => { localStorage.removeItem(HISTORY_KEY); setHistory([]); }}
              className="px-3 py-1.5 text-xs text-[#65676b] dark:text-[#b0b3b8] hover:text-[#fa3e3e] transition-colors"
            >
              Verlauf löschen
            </button>
          </div>
        </div>
      )}

      {/* Info-Box */}
      <div className="bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <p className="text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
            {stats.data?.total.toLocaleString("de-DE") ?? "–"} Geräte in der Datenbank
          </p>
          {stats.data?.letzterImport && (
            <p className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
              Letzter Import:{" "}
              {new Date(stats.data.letzterImport).toLocaleDateString("de-DE", {
                day: "2-digit", month: "2-digit", year: "numeric",
                hour: "2-digit", minute: "2-digit",
              })}
            </p>
          )}
        </div>
        <Link
          href="/admin/geraete-import"
          className="text-xs font-bold text-[#0064d2] dark:text-[#45bdff] hover:underline"
        >
          → CSV importieren
        </Link>
      </div>
    </div>
  );
}

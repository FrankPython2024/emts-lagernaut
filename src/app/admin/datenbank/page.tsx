"use client";
import { useState } from "react";
import { api } from "@/trpc/react";
import { PageLoader } from "@/components/ui/LoadingSpinner";

/**
 * Datenbank-Explorer — Schritt 1: Passwort-Gate + leeres Gerüst.
 *
 * Nur für Rolle ADMIN (Sidebar-Gate SYSTEM_ADMIN + serverseitig adminProcedure)
 * und zusätzlich durch ein eigenes Passwort gesichert. Inhalte (Tabellen,
 * Relationen, Zeilen) folgen in den Schritten 2–4.
 */
export default function DatenbankPage() {
  const statusQuery = api.datenbank.status.useQuery(undefined, { staleTime: 30_000 });

  const [passwort, setPasswort] = useState("");
  const [fehler,   setFehler]   = useState<string | null>(null);

  const unlock = api.datenbank.unlock.useMutation({
    onSuccess: () => {
      setPasswort("");
      setFehler(null);
      statusQuery.refetch();
    },
    onError: (e) => setFehler(e.message || "Freischalten fehlgeschlagen."),
  });

  const lock = api.datenbank.lock.useMutation({
    onSuccess: () => statusQuery.refetch(),
  });

  function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (!passwort.trim() || unlock.isPending) return;
    unlock.mutate({ passwort });
  }

  if (statusQuery.isLoading) return <PageLoader />;

  const unlocked = statusQuery.data?.unlocked ?? false;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* ── Kopf ── */}
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex items-center justify-center w-11 h-11 rounded-xl text-white text-xl flex-shrink-0"
          style={{ background: "#202F61" }}
        >
          🛢️
        </span>
        <div>
          <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Datenbank-Explorer</h1>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
            Read-only Einblick in die Datenbank — nur für Administratoren, separat passwortgeschützt.
          </p>
        </div>
      </div>

      {!unlocked ? (
        /* ── Passwort-Gate ── */
        <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-6 sm:p-8">
          <div className="flex items-start gap-3 mb-5">
            <span aria-hidden className="text-2xl">🔒</span>
            <div>
              <h2 className="font-black text-lg text-[#1a1a1a] dark:text-[#e4e6eb]">Gesperrt</h2>
              <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
                Bitte das Datenbank-Explorer-Passwort eingeben. Die Freischaltung gilt für 2&nbsp;Stunden.
              </p>
            </div>
          </div>

          <form onSubmit={handleUnlock} className="space-y-4">
            <div>
              <label htmlFor="db-explorer-pw" className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1.5 uppercase tracking-wider">
                Passwort
              </label>
              <input
                id="db-explorer-pw"
                type="password"
                autoComplete="off"
                autoFocus
                value={passwort}
                onChange={(e) => { setPasswort(e.target.value); setFehler(null); }}
                aria-invalid={!!fehler}
                aria-describedby={fehler ? "db-explorer-error" : undefined}
                className="w-full min-h-[56px] px-4 rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] text-base outline-none focus:border-[#008BD2] focus:ring-2 focus:ring-[#008BD2]/40 transition-colors"
                placeholder="••••••••"
              />
            </div>

            {fehler && (
              <div
                id="db-explorer-error"
                role="alert"
                className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[#fa3e3e]/10 border border-[#fa3e3e]/30 text-[#b91c1c] dark:text-[#fca5a5] text-sm font-semibold"
              >
                <span aria-hidden>⚠️</span> {fehler}
              </div>
            )}

            <button
              type="submit"
              disabled={!passwort.trim() || unlock.isPending}
              className="w-full min-h-[56px] px-6 rounded-xl text-white font-bold text-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#008BD2] dark:focus:ring-offset-[#242526]"
              style={{ background: "#008BD2" }}
            >
              {unlock.isPending ? "Wird geprüft…" : "🔓 Freischalten"}
            </button>
          </form>
        </div>
      ) : (
        /* ── Freigeschaltet: Platzhalter (Inhalte folgen in Schritt 2) ── */
        <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-6 sm:p-8">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-3">
              <span aria-hidden className="text-2xl">✅</span>
              <div>
                <h2 className="font-black text-lg text-[#1a1a1a] dark:text-[#e4e6eb]">Datenbank-Explorer freigeschaltet</h2>
                <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Inhalte folgen in Schritt&nbsp;2.</p>
              </div>
            </div>
            <button
              onClick={() => lock.mutate()}
              disabled={lock.isPending}
              className="min-h-[44px] px-4 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-sm font-semibold text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#008BD2]"
            >
              🔒 Sperren
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { PageLoader } from "@/components/ui/LoadingSpinner";

const ROLLEN_FARBE: Record<string, string> = {
  ADMIN:      "bg-[#fa3e3e]/10 text-[#fa3e3e]",
  TECHNIKER:  "bg-[#0064d2]/10 text-[#0064d2] dark:text-[#45bdff]",
  BETRACHTER: "bg-[#00a400]/10 text-[#00a400]",
};

function Initials({ name }: { name: string }) {
  const parts = name.split(" ");
  const ini = parts.length >= 2 ? parts[0]![0] + parts[parts.length - 1]![0] : name.slice(0, 2);
  return (
    <div className="w-10 h-10 rounded-full bg-[#0064d2] text-white font-black text-sm flex items-center justify-center flex-shrink-0 uppercase">
      {ini}
    </div>
  );
}

export default function BenutzerPage() {
  const { show } = useToast();
  const { data, isLoading, refetch } = api.benutzer.getAll.useQuery();

  // Reset-Confirm Dialog State
  const [resetDialog, setResetDialog] = useState<{ id: number; kuerzel: string; name: string } | null>(null);

  const deactivate = api.benutzer.deactivate.useMutation({
    onSuccess: () => { show("Benutzer deaktiviert", "warning"); refetch(); },
    onError:   (e) => show(e.message, "error"),
  });

  const resetPw = api.benutzer.resetPasswordDefault.useMutation({
    onSuccess: (r) => {
      show(`✅ Passwort für ${r.kuerzel} auf Standard zurückgesetzt`, "success");
      setResetDialog(null);
    },
    onError: (e) => { show(e.message, "error"); setResetDialog(null); },
  });

  if (isLoading) return <PageLoader />;

  const counts = data?.reduce((acc, u) => {
    acc[u.rolle] = (acc[u.rolle] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>) ?? {};

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Benutzer</h1>
          <div className="flex gap-3 mt-1">
            {Object.entries(counts).map(([r, n]) => (
              <span key={r} className={`text-xs px-2 py-0.5 rounded-full font-bold ${ROLLEN_FARBE[r] ?? ""}`}>
                {n}× {r}
              </span>
            ))}
          </div>
        </div>
        <Link href="/admin/benutzer/neu" className="px-4 py-2 bg-[#0064d2] text-white font-bold rounded-xl hover:bg-blue-700 shadow-sm">
          + Neuer Benutzer
        </Link>
      </div>

      <div className="space-y-2">
        {data?.map((u) => (
          <div key={u.id} className={`flex items-center gap-4 bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] px-5 py-4 shadow-sm flex-wrap gap-y-2 ${!u.aktiv ? "opacity-50" : ""}`}>
            <Initials name={u.name} />
            <div className="flex-1 min-w-0">
              <div className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{u.name}
                {!u.aktiv && <span className="ml-2 text-xs text-[#65676b]">(inaktiv)</span>}
              </div>
              <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">{u.email} · {u.kuerzel}</div>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${ROLLEN_FARBE[u.rolle] ?? ""}`}>
              {u.rolle}
            </span>
            <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] text-right">
              {u.lastLogin ? `Login: ${new Date(u.lastLogin).toLocaleDateString("de-DE")}` : "Noch kein Login"}
            </div>
            <div className="flex gap-2 flex-wrap">
              <Link href={`/admin/benutzer/${u.id}`} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#f0f2f5] dark:bg-[#3e4042] hover:bg-[#ced4da] dark:hover:bg-[#555]">
                ✏️ Bearbeiten
              </Link>
              {/* Passwort zurücksetzen — nur für Nicht-Admins */}
              {u.rolle !== "ADMIN" && u.aktiv && (
                <button
                  onClick={() => setResetDialog({ id: u.id, kuerzel: u.kuerzel, name: u.name })}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
                  title="Passwort auf Standard zurücksetzen"
                >
                  🔄 Passwort reset
                </button>
              )}
              {u.aktiv && (
                <button
                  onClick={() => deactivate.mutate({ id: u.id })}
                  disabled={deactivate.isPending}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#fa3e3e]/10 text-[#fa3e3e] hover:bg-[#fa3e3e]/20 disabled:opacity-50"
                >
                  {deactivate.isPending ? "..." : "Deaktivieren"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Passwort-Reset Confirm Dialog ── */}
      {resetDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-[#242526] rounded-2xl shadow-2xl w-full max-w-md border border-amber-300 dark:border-amber-700">
            <div className="px-6 py-5">
              <div className="text-3xl mb-3">🔄</div>
              <h3 className="font-black text-lg text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">
                Passwort zurücksetzen?
              </h3>
              <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mb-4">
                <strong className="text-[#1a1a1a] dark:text-[#e4e6eb]">{resetDialog.name}</strong>
                {" "}({resetDialog.kuerzel})
              </p>
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3 text-sm text-amber-800 dark:text-amber-300 mb-2">
                Das Passwort wird auf das Standard-Passwort zurückgesetzt:
                <div className="font-black text-base mt-1 font-mono">&quot;techniker123&quot;</div>
              </div>
              <p className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
                Der Benutzer sollte es beim nächsten Login sofort ändern.
              </p>
            </div>
            <div className="flex gap-3 px-6 pb-5">
              <button
                onClick={() => setResetDialog(null)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-semibold text-sm hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={() => resetPw.mutate({ id: resetDialog.id })}
                disabled={resetPw.isPending}
                className="flex-1 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm disabled:opacity-50 transition-colors"
              >
                {resetPw.isPending ? "⏳ Zurücksetzen…" : "Ja, zurücksetzen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

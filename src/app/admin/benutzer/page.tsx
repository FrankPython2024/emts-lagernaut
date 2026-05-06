"use client";
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
  const ini = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2);
  return (
    <div className="w-10 h-10 rounded-full bg-[#0064d2] text-white font-black text-sm flex items-center justify-center flex-shrink-0 uppercase">
      {ini}
    </div>
  );
}

export default function BenutzerPage() {
  const { show } = useToast();
  const { data, isLoading, refetch } = api.benutzer.getAll.useQuery();

  const deactivate = api.benutzer.deactivate.useMutation({
    onSuccess: () => { show("Benutzer deaktiviert", "warning"); refetch(); },
    onError:   (e) => show(e.message, "error"),
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
            <div className="flex gap-2">
              <Link href={`/admin/benutzer/${u.id}`} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#f0f2f5] dark:bg-[#3e4042] hover:bg-[#ced4da] dark:hover:bg-[#555]">
                ✏️ Bearbeiten
              </Link>
              {u.aktiv && (
                <button onClick={() => deactivate.mutate({ id: u.id })}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#fa3e3e]/10 text-[#fa3e3e] hover:bg-[#fa3e3e]/20">
                  Deaktivieren
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

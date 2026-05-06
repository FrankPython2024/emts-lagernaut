"use client";
import { useState } from "react";
import { AnfrageStatus } from "@prisma/client";
import { api } from "@/trpc/react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import { PageLoader } from "@/components/ui/LoadingSpinner";

export default function AnfragenPage() {
  const { show } = useToast();
  const [statusFilter, setStatusFilter] = useState<AnfrageStatus | "">("");
  const [techFilter,   setTechFilter]   = useState("");

  const { data, isLoading, refetch } = api.anfragen.getGruppiert.useQuery({
    ...(statusFilter ? { status: statusFilter as AnfrageStatus } : {}),
    ...(techFilter   ? { techniker: techFilter } : {}),
  });

  const setStatus = api.anfragen.setStatus.useMutation({
    onSuccess: () => { show("Status aktualisiert", "success"); refetch(); },
    onError:   (e) => show(e.message, "error"),
  });

  function alleErledigen(anfragen: { id: number }[]) {
    Promise.all(
      anfragen
        .filter((a) => (a as any).status !== AnfrageStatus.ABGESCHLOSSEN && (a as any).status !== AnfrageStatus.STORNIERT)
        .map((a) => setStatus.mutateAsync({ id: a.id, status: AnfrageStatus.ABGESCHLOSSEN })),
    ).then(() => show("Alle Anfragen erledigt", "success"));
  }

  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Anfragen</h1>

      {/* Filter */}
      <div className="flex gap-3 flex-wrap">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as AnfrageStatus | "")}
          className="px-4 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] text-sm">
          <option value="">Alle Status</option>
          {Object.values(AnfrageStatus).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input placeholder="Techniker filtern..." value={techFilter} onChange={(e) => setTechFilter(e.target.value.toUpperCase())}
          className="px-4 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] text-sm w-48" />
        <span className="py-2 text-sm text-[#65676b] dark:text-[#b0b3b8]">{data?.length ?? 0} Gruppen</span>
      </div>

      {/* Gruppen */}
      <div className="space-y-4">
        {data?.map((gruppe, gi) => (
          <div key={gi} className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-5 py-4 bg-[#f0f2f5] dark:bg-[#18191a] border-b border-[#ced4da] dark:border-[#3e4042] flex-wrap gap-y-2">
              <div className="flex items-center gap-4 flex-wrap">
                <div>
                  <div className="font-black text-[#1a1a1a] dark:text-[#e4e6eb]">{gruppe.logId}</div>
                  <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
                    {gruppe.techniker} · {new Date(gruppe.datum).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    {gruppe.geraeteName && ` · ${gruppe.geraeteName}`}
                  </div>
                </div>
                <StatusBadge status={gruppe.gruppenStatus} />
                {gruppe.gruppenNr && <span className="text-xs font-mono text-[#65676b] dark:text-[#b0b3b8]">{gruppe.gruppenNr}</span>}
              </div>
              <button
                onClick={() => alleErledigen(gruppe.anfragen)}
                disabled={setStatus.isPending}
                className="px-3 py-1.5 bg-[#00a400] text-white text-xs font-bold rounded-lg hover:bg-green-600 disabled:opacity-50"
              >
                ✅ Alle erledigen
              </button>
            </div>

            {/* Items */}
            <div className="divide-y divide-[#ced4da] dark:divide-[#3e4042]">
              {gruppe.anfragen.map((a) => (
                <div key={a.id} className="flex items-center gap-4 px-5 py-3 flex-wrap gap-y-1">
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">{a.teil}</span>
                    {a.kommentar && <span className="ml-2 text-xs text-[#0064d2] dark:text-[#45bdff]">⌨️ {a.kommentar}</span>}
                  </div>
                  <StatusBadge status={a.status} />
                  <div className="flex gap-1">
                    {a.status !== AnfrageStatus.ABGESCHLOSSEN && a.status !== AnfrageStatus.STORNIERT && (
                      <button onClick={() => setStatus.mutate({ id: a.id, status: AnfrageStatus.ABGESCHLOSSEN })}
                        className="px-2 py-1 text-xs bg-[#00a400]/10 text-[#00a400] rounded hover:bg-[#00a400]/20 font-bold">
                        ✓
                      </button>
                    )}
                    {(a.status === AnfrageStatus.NEU || a.status === AnfrageStatus.BEDARF) && (
                      <button onClick={() => setStatus.mutate({ id: a.id, status: AnfrageStatus.STORNIERT })}
                        className="px-2 py-1 text-xs bg-[#fa3e3e]/10 text-[#fa3e3e] rounded hover:bg-[#fa3e3e]/20 font-bold">
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {!data?.length && (
          <div className="text-center py-16 text-[#65676b] dark:text-[#b0b3b8]">Keine Anfragen gefunden</div>
        )}
      </div>
    </div>
  );
}

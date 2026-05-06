"use client";
import Link from "next/link";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { PageLoader } from "@/components/ui/LoadingSpinner";

export default function ModelleListePage() {
  const { show } = useToast();
  const { data, isLoading, error, refetch } = api.geraete.getAll.useQuery({ nurAktive: false });

  const setAktiv = api.geraete.setAktiv.useMutation({
    onSuccess: () => { refetch(); show("Status aktualisiert", "success"); },
    onError: (e) => show(e.message, "error"),
  });

  if (isLoading) return <PageLoader />;
  if (error) return (
    <div className="p-6 bg-[#fa3e3e]/10 border border-[#fa3e3e]/30 rounded-xl text-[#fa3e3e]">
      Fehler: {error.message}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Gerätemodelle</h1>
        <Link href="/admin/modelle/neu" className="px-4 py-2 bg-[#0064d2] text-white font-bold rounded-xl hover:bg-blue-700 shadow-sm">
          + Neues Modell
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {data?.map((m) => (
          <div key={m.id} className={`bg-white dark:bg-[#242526] rounded-xl border p-5 shadow-sm transition-opacity ${m.aktiv ? "border-[#ced4da] dark:border-[#3e4042]" : "border-[#ced4da] dark:border-[#3e4042] opacity-50"}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] uppercase font-bold">{m.hersteller}</div>
                <div className="text-lg font-black text-[#1a1a1a] dark:text-[#e4e6eb]">{m.modell}</div>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full font-bold ${m.aktiv ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                {m.aktiv ? "Aktiv" : "Inaktiv"}
              </span>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setAktiv.mutate({ id: m.id, aktiv: !m.aktiv })}
                disabled={setAktiv.isPending}
                className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#ced4da] dark:hover:bg-[#555] disabled:opacity-50"
              >
                {setAktiv.isPending ? "..." : m.aktiv ? "Deaktivieren" : "Aktivieren"}
              </button>
            </div>
          </div>
        ))}
        {data?.length === 0 && (
          <div className="col-span-full text-center py-12 text-[#65676b] dark:text-[#b0b3b8]">
            Keine Modelle. <Link href="/admin/modelle/neu" className="text-[#0064d2] hover:underline">Erstes Modell anlegen →</Link>
          </div>
        )}
      </div>
    </div>
  );
}

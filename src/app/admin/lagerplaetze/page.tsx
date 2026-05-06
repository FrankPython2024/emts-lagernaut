"use client";
import { useState } from "react";
import Link from "next/link";
import { useDebounce } from "use-debounce";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { PageLoader } from "@/components/ui/LoadingSpinner";

export default function LagerplaetzePage() {
  const { show } = useToast();
  const [suche,    setSuche]    = useState("");
  const [bereich,  setBereich]  = useState("");
  const [debouncedSuche]        = useDebounce(suche, 300);

  const { data, isLoading, error, refetch } = api.lagerplaetze.getAll.useQuery({
    bereich: bereich || undefined,
  }, { refetchOnMount: "always", staleTime: 0 });

  const bereiche = api.lagerplaetze.getBereiche.useQuery();

  const deactivate = api.lagerplaetze.deactivate.useMutation({
    onSuccess: () => { show("Lagerplatz deaktiviert", "warning"); refetch(); },
    onError:   (e) => show(e.message, "error"),
  });

  if (isLoading) return <PageLoader />;
  if (error) return (
    <div className="p-6 bg-[#fa3e3e]/10 border border-[#fa3e3e]/30 rounded-xl text-[#fa3e3e]">
      Fehler: {error.message}
    </div>
  );

  const filtered = debouncedSuche
    ? (data ?? []).filter((l) =>
        l.code.toLowerCase().includes(debouncedSuche.toLowerCase()) ||
        l.beschreibung?.toLowerCase().includes(debouncedSuche.toLowerCase()),
      )
    : (data ?? []);

  const INPUT_CLS = "px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] text-sm";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Lagerplätze</h1>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-0.5">{filtered.length} Lagerplätze</p>
        </div>
        <Link href="/admin/lagerplaetze/neu"
          className="px-4 py-2 bg-[#0064d2] text-white font-bold rounded-xl hover:bg-blue-700 shadow-sm text-sm">
          + Neuer Lagerplatz
        </Link>
      </div>

      {/* Filter */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-4 shadow-sm flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-[200px]">
          <input
            type="text" placeholder="Code oder Beschreibung..."
            value={suche} onChange={(e) => setSuche(e.target.value)}
            className={`${INPUT_CLS} w-full pr-7`}
          />
          {suche && (
            <button onClick={() => setSuche("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#65676b] hover:text-[#fa3e3e] font-bold text-sm">
              ✕
            </button>
          )}
        </div>
        <select value={bereich} onChange={(e) => setBereich(e.target.value)} className={INPUT_CLS}>
          <option value="">Alle Bereiche</option>
          {bereiche.data?.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      {/* Tabelle */}
      <div className="overflow-x-auto bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm">
        <table className="w-full">
          <thead>
            <tr className="bg-[#f0f2f5] dark:bg-[#18191a] text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] border-b border-[#ced4da] dark:border-[#3e4042]">
              <th className="px-4 py-3 text-left">Code</th>
              <th className="px-4 py-3 text-left">Beschreibung</th>
              <th className="px-4 py-3 text-left">Bereich</th>
              <th className="px-4 py-3 text-center">Artikel</th>
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 text-right">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((l) => (
              <tr key={l.id} className={`border-b border-[#ced4da] dark:border-[#3e4042] hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] text-sm ${!l.aktiv ? "opacity-50" : ""}`}>
                <td className="px-4 py-3 font-mono font-bold text-[#0064d2] dark:text-[#45bdff]">{l.code}</td>
                <td className="px-4 py-3 text-[#65676b] dark:text-[#b0b3b8]">{l.beschreibung ?? "–"}</td>
                <td className="px-4 py-3">
                  {l.bereich ? (
                    <span className="px-2 py-0.5 bg-[#f0f2f5] dark:bg-[#3e4042] rounded text-xs font-medium">{l.bereich}</span>
                  ) : "–"}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`font-black text-lg ${l.artikelAnzahl > 0 ? "text-[#00a400]" : "text-[#65676b] dark:text-[#b0b3b8]"}`}>
                    {l.artikelAnzahl}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${l.aktiv ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"}`}>
                    {l.aktiv ? "Aktiv" : "Inaktiv"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-1 justify-end">
                    <Link href={`/admin/lagerplaetze/${l.id}`}
                      className="px-2 py-1 text-xs rounded bg-[#f0f2f5] dark:bg-[#3e4042] hover:bg-[#ced4da] dark:hover:bg-[#555] font-semibold">
                      ✏️ Details
                    </Link>
                    {l.aktiv && l.artikelAnzahl === 0 && (
                      <button
                        onClick={() => deactivate.mutate({ id: l.id })}
                        disabled={deactivate.isPending}
                        className="px-2 py-1 text-xs rounded bg-[#fa3e3e]/10 text-[#fa3e3e] hover:bg-[#fa3e3e]/20 font-semibold disabled:opacity-50"
                      >
                        Deakt.
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={6} className="text-center py-12 text-[#65676b] dark:text-[#b0b3b8]">
                  Keine Lagerplätze gefunden
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

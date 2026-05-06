"use client";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PageLoader } from "@/components/ui/LoadingSpinner";

export default function LagerplatzDetailPage() {
  const { id }    = useParams<{ id: string }>();
  const code      = decodeURIComponent(id);
  const router    = useRouter();
  const { show }  = useToast();
  const { data: session } = useSession();
  const kuerzel   = (session?.user as { kuerzel?: string })?.kuerzel ?? "ADMIN";

  const { data, isLoading, error, refetch } = api.lagerplaetze.getByCode.useQuery({ code });
  const alleLPs = api.lagerplaetze.getAll.useQuery();

  const [verschiebeNach, setVerschiebeNach] = useState("");
  const [neuCode,        setNeuCode]        = useState("");
  const [confirmOpen,    setConfirmOpen]    = useState(false);

  const verschiebeAlle = api.lagerplaetze.verschiebeAlle.useMutation({
    onSuccess: (r) => {
      show(`✅ ${r.verschoben} Artikel verschoben nach ${r.nach}`, "success");
      setConfirmOpen(false);
      router.push("/admin/lagerplaetze");
    },
    onError: (e) => show(e.message, "error"),
  });

  if (isLoading) return <PageLoader />;
  if (error || !data) return (
    <div className="p-6 bg-[#fa3e3e]/10 border border-[#fa3e3e]/30 rounded-xl text-[#fa3e3e]">
      {error?.message ?? "Lagerplatz nicht gefunden."}
    </div>
  );

  const zielOptionen = (alleLPs.data ?? []).filter((l) => l.lagerplatz !== code);

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => router.back()} className="text-[#65676b] hover:text-[#0064d2] text-sm">← Zurück</button>
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb] font-mono">{code}</h1>
        <span className="px-2 py-0.5 bg-[#f0f2f5] dark:bg-[#3e4042] rounded text-xs font-medium">{data.bereich}</span>
        <span className="ml-auto text-sm text-[#65676b] dark:text-[#b0b3b8]">{data.artikel.length} Artikel</span>
      </div>

      {/* Artikel Liste */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#ced4da] dark:border-[#3e4042]">
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Artikel ({data.artikel.length})</h2>
          {data.artikel.length > 0 && (
            <button onClick={() => setVerschiebeNach("")}
              className="px-3 py-1.5 text-xs font-bold bg-[#f7b928]/10 text-[#f7b928] border border-[#f7b928]/30 rounded-lg hover:bg-[#f7b928]/20"
              id="verschiebeBtn"
            >
              📦 Alle verschieben
            </button>
          )}
        </div>

        {/* Alle verschieben Form */}
        <div id="verschiebeForm" className="mb-4 p-4 bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl space-y-3" style={{ display: "none" }} />

        <div className="space-y-2 max-h-72 overflow-y-auto">
          {data.artikel.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-3 py-2 border-b border-[#ced4da] dark:border-[#3e4042] last:border-0 text-sm">
              <div>
                <span className="font-medium text-[#1a1a1a] dark:text-[#e4e6eb]">{a.bezeichnung}</span>
                <span className="ml-2 text-xs text-[#65676b] dark:text-[#b0b3b8]">{a.kategorie}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className={`font-black ${a.bestand > 0 ? "text-[#00a400]" : "text-[#fa3e3e]"}`}>{a.bestand}</span>
                <Link href={`/admin/artikel/${a.id}`} className="text-xs text-[#0064d2] dark:text-[#45bdff] hover:underline">Details</Link>
              </div>
            </div>
          ))}
          {!data.artikel.length && (
            <p className="text-center py-6 text-[#65676b] dark:text-[#b0b3b8] text-sm">Lagerplatz ist leer</p>
          )}
        </div>

        {/* Inline Verschieben */}
        {data.artikel.length > 0 && (
          <div className="mt-4 pt-4 border-t border-[#ced4da] dark:border-[#3e4042] space-y-3">
            <p className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase">Alle Artikel verschieben nach:</p>
            <select value={verschiebeNach} onChange={(e) => setVerschiebeNach(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] text-sm">
              <option value="">-- Ziel-Lagerplatz wählen --</option>
              {zielOptionen.map((l) => <option key={l.lagerplatz} value={l.lagerplatz}>{l.lagerplatz}</option>)}
            </select>
            <input type="text" placeholder="Oder neuer Code (z.B. HP-2-1-1)"
              value={neuCode}
              onChange={(e) => { setNeuCode(e.target.value.toUpperCase()); setVerschiebeNach(e.target.value.toUpperCase()); }}
              className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] text-sm font-mono" />
            <button
              disabled={!verschiebeNach}
              onClick={() => setConfirmOpen(true)}
              className="px-6 py-2.5 bg-[#f7b928] text-black font-bold rounded-xl hover:bg-yellow-500 disabled:opacity-50"
            >
              📦 Alle verschieben
            </button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen} onClose={() => setConfirmOpen(false)}
        onConfirm={() => verschiebeAlle.mutate({ alterLagerplatz: code, neuerLagerplatz: verschiebeNach, mitarbeiter: kuerzel })}
        title="Alle Artikel verschieben" loading={verschiebeAlle.isPending}
        message={<span>Alle <strong>{data.artikel.length}</strong> Artikel von <strong className="font-mono">{code}</strong> nach <strong className="font-mono">{verschiebeNach}</strong> verschieben?</span>}
        confirmText="Verschieben"
      />
    </div>
  );
}

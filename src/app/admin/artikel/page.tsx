"use client";
import { useState } from "react";
import Link from "next/link";
import { useDebounce } from "use-debounce";
import { BuchungsTyp } from "@prisma/client";
import { api } from "@/trpc/react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

type Artikel = {
  id: number; bezeichnung: string; kategorie: string;
  lagerplatz: string | null; bestand: number;
};

export default function ArtikelPage() {
  const { show } = useToast();
  const [query, setQuery]       = useState("");
  const [debouncedQ]            = useDebounce(query, 300);
  const [nurNull, setNurNull]   = useState(false);
  const [buchModal, setBuchModal] = useState<Artikel | null>(null);
  const [delTarget, setDelTarget] = useState<Artikel | null>(null);
  const [buchMenge, setBuchMenge] = useState(1);
  const [buchTyp, setBuchTyp]   = useState<BuchungsTyp>(BuchungsTyp.EINGANG);
  const [buchNotiz, setBuchNotiz] = useState("");
  const [buchMitarb, setBuchMitarb] = useState("");

  const liste  = api.lager.getAll.useQuery(
    { limit: 200 },
    { refetchOnMount: "always", staleTime: 0 },
  );
  const suche  = api.lager.searchAdmin.useQuery(
    { query: debouncedQ },
    { enabled: debouncedQ.length >= 2 },
  );

  const buchen = api.buchungen.create.useMutation({
    onSuccess: (b) => {
      show(`✅ ${b.bezeichnung}: ${b.typ} ${b.menge}x | Bestand: ${b.neuerBestand}`, "success");
      setBuchModal(null); setBuchMenge(1); setBuchNotiz(""); setBuchMitarb("");
      liste.refetch();
    },
    onError: (e) => show(e.message, "error"),
  });

  const loeschen = api.lager.delete.useMutation({
    onSuccess: () => { show("Artikel gelöscht.", "success"); setDelTarget(null); liste.refetch(); },
    onError:   (e) => show(e.message, "error"),
  });

  const data: Artikel[] = debouncedQ.length >= 2
    ? (suche.data?.map((a) => ({
        id:          a.id,
        bezeichnung: a.bezeichnung,
        kategorie:   a.kategorie,
        lagerplatz:  a.lagerplatz ?? null,
        bestand:     a.bestand,
      })) ?? [])
    : (liste.data?.artikel ?? []);

  const filtered = nurNull ? data.filter((a) => a.bestand === 0) : data;

  const columns: Column<Artikel>[] = [
    { key: "id",          header: "ID",         render: (a) => <span className="font-mono text-xs text-[#65676b]">#{a.id}</span>, width: "w-16" },
    { key: "bezeichnung", header: "Bezeichnung", render: (a) => <span className="font-semibold">{a.bezeichnung}</span> },
    { key: "kategorie",   header: "Kategorie",   render: (a) => <span className="px-2 py-0.5 bg-[#f0f2f5] dark:bg-[#3e4042] rounded text-xs">{a.kategorie}</span> },
    { key: "lagerplatz",  header: "Lagerplatz",  render: (a) => <span className="font-mono text-sm">{a.lagerplatz ?? "–"}</span> },
    {
      key: "bestand", header: "Bestand",
      render: (a) => (
        <span className={`font-black text-lg ${a.bestand > 0 ? "text-[#00a400]" : "text-[#fa3e3e]"}`}>
          {a.bestand}
        </span>
      ),
    },
    {
      key: "aktionen", header: "Aktionen",
      render: (a) => (
        <div className="flex gap-1">
          <Link href={`/admin/artikel/${a.id}`} className="px-2 py-1 text-xs rounded bg-[#f0f2f5] dark:bg-[#3e4042] hover:bg-[#ced4da] font-semibold">✏️</Link>
          <button onClick={() => setBuchModal(a)} className="px-2 py-1 text-xs rounded bg-[#0064d2]/10 text-[#0064d2] dark:text-[#45bdff] hover:bg-[#0064d2]/20 font-semibold">📥</button>
          {a.bestand === 0 && (
            <button onClick={() => setDelTarget(a)} className="px-2 py-1 text-xs rounded bg-[#fa3e3e]/10 text-[#fa3e3e] hover:bg-[#fa3e3e]/20 font-semibold">🗑️</button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Artikel</h1>
        <Link href="/admin/artikel/neu" className="px-4 py-2 bg-[#0064d2] text-white font-bold rounded-xl hover:bg-blue-700 transition-colors shadow-sm">
          + Neuer Artikel
        </Link>
      </div>

      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-4 shadow-sm flex gap-3 flex-wrap items-center">
        <input
          type="text"
          placeholder="Suchen..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-[200px] px-4 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]"
        />
        <label className="flex items-center gap-2 text-sm font-medium text-[#65676b] dark:text-[#b0b3b8] cursor-pointer">
          <input type="checkbox" checked={nurNull} onChange={(e) => setNurNull(e.target.checked)} className="w-4 h-4 accent-[#fa3e3e]" />
          Nur Bestand = 0
        </label>
        <span className="text-sm text-[#65676b] dark:text-[#b0b3b8]">{filtered.length} Artikel</span>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        keyFn={(a) => a.id}
        loading={liste.isLoading}
        emptyText="Keine Artikel gefunden"
      />

      {/* Buchen Modal */}
      <Modal open={!!buchModal} onClose={() => setBuchModal(null)} title={`Buchen: ${buchModal?.bezeichnung}`}>
        <div className="space-y-4">
          <div className="flex gap-2">
            {([BuchungsTyp.EINGANG, BuchungsTyp.AUSGANG] as BuchungsTyp[]).map((t) => (
              <button key={t} onClick={() => setBuchTyp(t)}
                className={`flex-1 py-2 rounded-lg font-bold text-sm transition-colors ${buchTyp === t ? "bg-[#0064d2] text-white" : "bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8]"}`}>
                {t === BuchungsTyp.EINGANG ? "📥 Eingang" : "📤 Ausgang"}
              </button>
            ))}
          </div>
          <input type="text" placeholder="Mitarbeiter *" value={buchMitarb} onChange={(e) => setBuchMitarb(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]" />
          <input type="number" min={1} value={buchMenge} onChange={(e) => setBuchMenge(Number(e.target.value))}
            className="w-full px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]" />
          <input type="text" placeholder="Notiz (optional)" value={buchNotiz} onChange={(e) => setBuchNotiz(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]" />
          <button
            disabled={!buchMitarb || buchen.isPending}
            onClick={() => buchModal && buchen.mutate({ artikelId: buchModal.id, menge: buchMenge, typ: buchTyp, mitarbeiter: buchMitarb, notiz: buchNotiz || undefined })}
            className="w-full py-2.5 bg-[#0064d2] text-white font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50">
            {buchen.isPending ? "..." : "Buchen"}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!delTarget} onClose={() => setDelTarget(null)}
        onConfirm={() => delTarget && loeschen.mutate({ id: delTarget.id })}
        title="Artikel löschen"
        message={<>Artikel <strong>{delTarget?.bezeichnung}</strong> wirklich löschen?</>}
        confirmText="Löschen" danger
        loading={loeschen.isPending}
      />
    </div>
  );
}

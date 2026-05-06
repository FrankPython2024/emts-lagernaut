"use client";
import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { PageLoader } from "@/components/ui/LoadingSpinner";

export default function ArtikelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const artikelId = Number(id);
  const router = useRouter();
  const { show } = useToast();
  const { data: session } = useSession();
  const kuerzel = (session?.user as { kuerzel?: string })?.kuerzel ?? "ADMIN";

  const { data: artikel, isLoading, refetch } = api.lager.getByIdAdmin.useQuery({ id: artikelId });
  const buchungen  = api.buchungen.getByArtikel.useQuery({ artikelId, limit: 20, offset: 0 });
  const kategorien = api.lager.getKategorien.useQuery();
  const alleLPs    = api.lagerplaetze.getAll.useQuery();

  const [form, setForm]               = useState({ bezeichnung: "", kategorie: "", lagerplatz: "" });
  const [delOpen, setDelOpen]         = useState(false);
  const [lpModalOpen, setLpModalOpen] = useState(false);
  const [nachLpId, setNachLpId]       = useState<number | null>(null);

  const verschiebe = api.lagerplaetze.verschiebeArtikel.useMutation({
    onSuccess: (r) => {
      show(`✅ Verschoben: ${r.von} → ${r.nach}`, "success");
      setLpModalOpen(false); setNachLpId(null);
      refetch();
    },
    onError: (e) => show(e.message, "error"),
  });

  useEffect(() => {
    if (artikel) setForm({ bezeichnung: artikel.bezeichnung, kategorie: artikel.kategorie, lagerplatz: artikel.lagerplatz ?? "" });
  }, [artikel]);

  const update = api.lager.update.useMutation({
    onSuccess: () => { show("✅ Gespeichert", "success"); refetch(); },
    onError:   (e) => show(e.message, "error"),
  });

  const del = api.lager.delete.useMutation({
    onSuccess: () => { show("Artikel gelöscht", "success"); router.push("/admin/artikel"); },
    onError:   (e) => show(e.message, "error"),
  });

  if (isLoading) return <PageLoader />;
  if (!artikel)  return <div className="text-[#fa3e3e]">Artikel nicht gefunden.</div>;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => router.back()} className="text-[#65676b] hover:text-[#0064d2] text-sm">← Zurück</button>
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb] flex-1">Artikel #{artikel.id}</h1>
        <div className={`text-3xl font-black ${artikel.bestand > 0 ? "text-[#00a400]" : "text-[#fa3e3e]"}`}>
          Bestand: {artikel.bestand}
        </div>
      </div>

      {/* Edit Form */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-6 shadow-sm space-y-4">
        <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] border-b border-[#ced4da] dark:border-[#3e4042] pb-3">Stammdaten</h2>

        <div>
          <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase">Bezeichnung</label>
          <input value={form.bezeichnung} onChange={(e) => setForm((f) => ({ ...f, bezeichnung: e.target.value }))}
            className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]" />
        </div>

        <div>
          <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase">Kategorie</label>
          <select value={form.kategorie} onChange={(e) => setForm((f) => ({ ...f, kategorie: e.target.value }))}
            className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]">
            {kategorien.data?.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase">Lagerplatz</label>
          <input value={form.lagerplatz} onChange={(e) => setForm((f) => ({ ...f, lagerplatz: e.target.value }))}
            placeholder="z.B. R1-F3"
            className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]" />
        </div>

        <div className="flex gap-3 pt-2 flex-wrap">
          <button onClick={() => update.mutate({ id: artikelId, ...form, lagerplatz: form.lagerplatz || null })}
            disabled={update.isPending}
            className="px-6 py-2.5 bg-[#0064d2] text-white font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50">
            {update.isPending ? "..." : "Speichern"}
          </button>
          <button
            onClick={() => setLpModalOpen(true)}
            className="px-4 py-2.5 bg-[#f7b928]/10 text-[#f7b928] font-bold rounded-xl hover:bg-[#f7b928]/20 border border-[#f7b928]/30"
          >
            🗄️ Lagerplatz ändern
          </button>
          {artikel.bestand === 0 && (
            <button onClick={() => setDelOpen(true)} className="px-4 py-2.5 bg-[#fa3e3e]/10 text-[#fa3e3e] font-bold rounded-xl hover:bg-[#fa3e3e]/20">
              🗑️ Löschen
            </button>
          )}
        </div>
      </div>

      {/* Buchungshistorie */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-6 shadow-sm">
        <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] border-b border-[#ced4da] dark:border-[#3e4042] pb-3 mb-4">Buchungshistorie</h2>
        <div className="space-y-2">
          {buchungen.data?.buchungen.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-3 py-2 border-b border-[#ced4da] dark:border-[#3e4042] last:border-0 text-sm">
              <span className="text-[#65676b] dark:text-[#b0b3b8] w-24 flex-shrink-0">
                {new Date(b.datum).toLocaleDateString("de-DE")}
              </span>
              <span className="flex-1 font-medium text-[#1a1a1a] dark:text-[#e4e6eb]">{b.mitarbeiter}</span>
              <span className={`px-2 py-0.5 rounded text-xs font-bold ${b.typ === "EINGANG" ? "bg-green-100 text-green-700" : b.typ === "AUSGANG" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>
                {b.typ}
              </span>
              <span className="font-black w-12 text-right">{b.typ === "EINGANG" ? "+" : b.typ === "AUSGANG" ? "-" : "±"}{b.menge}</span>
            </div>
          ))}
          {!buchungen.data?.buchungen.length && <p className="text-[#65676b] dark:text-[#b0b3b8] text-sm text-center py-4">Keine Buchungen</p>}
        </div>
      </div>

      <ConfirmDialog
        open={delOpen} onClose={() => setDelOpen(false)}
        onConfirm={() => del.mutate({ id: artikelId })}
        title="Artikel löschen" danger loading={del.isPending}
        message={<>Artikel <strong>{artikel.bezeichnung}</strong> endgültig löschen?</>}
        confirmText="Löschen"
      />

      {/* Lagerplatz-Verschieben Modal */}
      <Modal open={lpModalOpen} onClose={() => setLpModalOpen(false)} title="Lagerplatz ändern">
        <div className="space-y-4">
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
            Aktuell:{" "}
            <span className="font-mono font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
              {artikel.lagerplatz ?? "Kein Lagerplatz"}
            </span>
          </p>
          <div>
            <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase">Neuer Lagerplatz</label>
            <select
              value={nachLpId ?? ""}
              onChange={(e) => setNachLpId(Number(e.target.value) || null)}
              className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]"
            >
              <option value="">-- Lagerplatz wählen --</option>
              {(alleLPs.data ?? []).filter((l) => l.aktiv).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code}{l.beschreibung ? ` — ${l.beschreibung}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setLpModalOpen(false)}
              className="flex-1 py-2.5 rounded-xl bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-semibold">
              Abbrechen
            </button>
            <button
              disabled={!nachLpId || verschiebe.isPending}
              onClick={() => {
                if (!nachLpId || !artikel.lagerplatzId) return;
                verschiebe.mutate({ artikelId, vonLagerplatzId: artikel.lagerplatzId, nachLagerplatzId: nachLpId, mitarbeiter: kuerzel });
              }}
              className="flex-1 py-2.5 rounded-xl bg-[#f7b928] text-black font-bold hover:bg-yellow-500 disabled:opacity-50"
            >
              {verschiebe.isPending ? "..." : "Verschieben"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

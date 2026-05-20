"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/trpc/react";
import { PageHeader } from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";

type StandortForm = {
  name:     string;
  kurzname: string;
  adresse:  string;
};

const EMPTY_FORM: StandortForm = { name: "", kurzname: "", adresse: "" };

const INPUT = "w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-cyan-400 transition";

// ── Modal ─────────────────────────────────────────────────────────────────────

function StandortModal({
  editId,
  initial,
  onClose,
  onSaved,
}: {
  editId:   number | null;
  initial:  StandortForm;
  onClose:  () => void;
  onSaved:  () => void;
}) {
  const { show } = useToast();
  const [form, setForm] = useState<StandortForm>(initial);

  const create = api.standort.create.useMutation({
    onSuccess: () => { show("✅ Standort angelegt", "success"); onSaved(); },
    onError:   (e) => show(`❌ ${e.message}`, "error"),
  });
  const update = api.standort.update.useMutation({
    onSuccess: () => { show("✅ Gespeichert", "success"); onSaved(); },
    onError:   (e) => show(`❌ ${e.message}`, "error"),
  });

  const isPending = create.isPending || update.isPending;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.kurzname.trim()) return;
    if (editId) {
      update.mutate({ id: editId, name: form.name.trim(), kurzname: form.kurzname.trim().toUpperCase(), adresse: form.adresse.trim() || undefined });
    } else {
      create.mutate({ name: form.name.trim(), kurzname: form.kurzname.trim().toUpperCase(), adresse: form.adresse.trim() || undefined });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="font-black text-lg text-gray-900 dark:text-white">
            {editId ? "Standort bearbeiten" : "Neuer Standort"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-red-500 text-xl font-bold w-11 h-11 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition">×</button>
        </div>

        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
              Name *
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="AfB Sömmerda"
              maxLength={100}
              required
              className={INPUT}
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
              Kurzname * (2–10 Zeichen)
            </label>
            <input
              value={form.kurzname}
              onChange={(e) => setForm(f => ({ ...f, kurzname: e.target.value.toUpperCase() }))}
              placeholder="ETL"
              minLength={2}
              maxLength={10}
              required
              className={INPUT}
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
              Adresse
            </label>
            <input
              value={form.adresse}
              onChange={(e) => setForm(f => ({ ...f, adresse: e.target.value }))}
              placeholder="Musterstraße 1, 99610 Sömmerda"
              maxLength={500}
              className={INPUT}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-lg text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition min-h-[44px]"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="px-4 py-2.5 rounded-lg text-sm font-semibold bg-cyan-500 hover:bg-cyan-600 text-white disabled:opacity-50 transition min-h-[44px]"
            >
              {isPending ? "Speichert…" : editId ? "Speichern" : "Anlegen"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StandortePage() {
  const { show } = useToast();
  const utils = api.useUtils();

  const { data, isLoading } = api.standort.list.useQuery();
  const updateAktiv = api.standort.update.useMutation({
    onSuccess: () => { void utils.standort.list.invalidate(); },
    onError:   (e) => show(`❌ ${e.message}`, "error"),
  });

  const [modal, setModal] = useState<{ editId: number | null; form: StandortForm } | null>(null);

  function openCreate() {
    setModal({ editId: null, form: EMPTY_FORM });
  }

  function openEdit(s: { id: number; name: string; kurzname: string; adresse?: string | null }) {
    setModal({ editId: s.id, form: { name: s.name, kurzname: s.kurzname, adresse: s.adresse ?? "" } });
  }

  function closeModal() {
    void utils.standort.list.invalidate();
    setModal(null);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Standorte"
        subtitle="Verwaltung der AfB-Standorte"
        action={
          <button
            onClick={openCreate}
            className="px-4 py-2.5 rounded-lg text-sm font-semibold bg-cyan-500 hover:bg-cyan-600 text-white transition min-h-[44px]"
          >
            + Neuer Standort
          </button>
        }
      />

      {isLoading && (
        <div className="text-gray-400 text-sm p-6">Lädt…</div>
      )}

      {!isLoading && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Name</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Kurzname</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Adresse</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Aktiv</th>
                <th className="text-right px-4 py-3 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {(data ?? []).map((s) => (
                <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition">
                  <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white">{s.name}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded bg-cyan-50 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-300 text-xs font-bold font-mono">
                      {s.kurzname}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                    {(s as { adresse?: string | null }).adresse ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => updateAktiv.mutate({ id: s.id, aktiv: !s.aktiv })}
                      className={`w-10 h-5 rounded-full transition-colors ${s.aktiv ? "bg-green-500" : "bg-gray-300 dark:bg-gray-700"} relative`}
                      title={s.aktiv ? "Deaktivieren" : "Aktivieren"}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${s.aktiv ? "left-5" : "left-0.5"}`} />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                    <Link
                      href={`/admin/standorte/${s.id}`}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-50 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-100 dark:hover:bg-cyan-900/40 transition min-h-[36px] inline-flex items-center"
                    >
                      Lagerstruktur
                    </Link>
                    <button
                      onClick={() => openEdit(s as { id: number; name: string; kurzname: string; adresse?: string | null })}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-cyan-50 dark:hover:bg-cyan-900/20 hover:text-cyan-700 dark:hover:text-cyan-300 transition min-h-[36px]"
                    >
                      Bearbeiten
                    </button>
                    </div>
                  </td>
                </tr>
              ))}

              {(data ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">
                    Noch keine Standorte angelegt.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <StandortModal
          editId={modal.editId}
          initial={modal.form}
          onClose={() => setModal(null)}
          onSaved={closeModal}
        />
      )}
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { PageLoader } from "@/components/ui/LoadingSpinner";
import { useSession } from "next-auth/react";

export default function LagerplatzDetailPage() {
  const { id }    = useParams<{ id: string }>();
  const lpId      = Number(id);
  const router    = useRouter();
  const { show }  = useToast();
  const { data: session } = useSession();
  const kuerzel   = (session?.user as { kuerzel?: string })?.kuerzel ?? "ADMIN";

  const { data: lp, isLoading, error, refetch } = api.lagerplaetze.getById.useQuery({ id: lpId });
  const alleLPs = api.lagerplaetze.getAll.useQuery();

  const [form, setForm] = useState({ beschreibung: "", bereich: "" });
  const [verschiebeOpen, setVerschiebeOpen] = useState(false);
  const [nachLpId, setNachLpId] = useState<number | null>(null);
  const [deactOpen, setDeactOpen] = useState(false);

  useEffect(() => {
    if (lp) setForm({ beschreibung: lp.beschreibung ?? "", bereich: lp.bereich ?? "" });
  }, [lp]);

  const update = api.lagerplaetze.update.useMutation({
    onSuccess: () => { show("✅ Gespeichert", "success"); refetch(); },
    onError:   (e) => show(e.message, "error"),
  });

  const verschiebeAlle = api.lagerplaetze.verschiebeAlle.useMutation({
    onSuccess: (r) => {
      show(`✅ ${r.verschoben} Artikel von ${r.von} nach ${r.nach} verschoben`, "success");
      setVerschiebeOpen(false); setNachLpId(null);
      refetch(); alleLPs.refetch();
    },
    onError: (e) => show(e.message, "error"),
  });

  const deactivate = api.lagerplaetze.deactivate.useMutation({
    onSuccess: () => { show("Lagerplatz deaktiviert", "warning"); router.push("/admin/lagerplaetze"); },
    onError:   (e) => show(e.message, "error"),
  });

  if (isLoading) return <PageLoader />;
  if (error || !lp) return (
    <div className="p-6 bg-[#fa3e3e]/10 border border-[#fa3e3e]/30 rounded-xl text-[#fa3e3e]">
      {error?.message ?? "Lagerplatz nicht gefunden."}
    </div>
  );

  const INPUT_CLS = "w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]";
  const zielOptionen = (alleLPs.data ?? []).filter((l) => l.id !== lpId && l.aktiv);

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => router.back()} className="text-[#65676b] hover:text-[#0064d2] text-sm">← Zurück</button>
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb] font-mono">{lp.code}</h1>
        <span className={`text-xs px-2 py-1 rounded-full font-bold ${lp.aktiv ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
          {lp.aktiv ? "Aktiv" : "Inaktiv"}
        </span>
        <span className="ml-auto text-sm text-[#65676b] dark:text-[#b0b3b8]">
          {lp.artikel.length} Artikel
        </span>
      </div>

      {/* Edit Form */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-6 shadow-sm space-y-4">
        <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] border-b border-[#ced4da] dark:border-[#3e4042] pb-3">Stammdaten</h2>
        <div>
          <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase">Code (unveränderlich)</label>
          <input disabled value={lp.code} className={`${INPUT_CLS} opacity-60 font-mono`} />
        </div>
        <div>
          <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase">Beschreibung</label>
          <input value={form.beschreibung} onChange={(e) => setForm((f) => ({ ...f, beschreibung: e.target.value }))}
            placeholder="z.B. Regal HP, Fach 1, Ebene 1" className={INPUT_CLS} />
        </div>
        <div>
          <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase">Bereich</label>
          <input value={form.bereich} onChange={(e) => setForm((f) => ({ ...f, bereich: e.target.value }))}
            placeholder="z.B. HP, Lenovo, Dell" className={INPUT_CLS} />
        </div>
        <button
          onClick={() => update.mutate({ id: lpId, beschreibung: form.beschreibung || null, bereich: form.bereich || null })}
          disabled={update.isPending}
          className="px-6 py-2.5 bg-[#0064d2] text-white font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50"
        >
          {update.isPending ? "..." : "Speichern"}
        </button>
      </div>

      {/* Artikel Liste */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#ced4da] dark:border-[#3e4042]">
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
            Artikel ({lp.artikel.length})
          </h2>
          {lp.artikel.length > 0 && (
            <button
              onClick={() => setVerschiebeOpen(true)}
              className="px-3 py-1.5 text-xs font-bold bg-[#f7b928]/10 text-[#f7b928] border border-[#f7b928]/30 rounded-lg hover:bg-[#f7b928]/20"
            >
              📦 Alle verschieben
            </button>
          )}
        </div>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {lp.artikel.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-3 py-2 border-b border-[#ced4da] dark:border-[#3e4042] last:border-0 text-sm">
              <div>
                <span className="font-medium text-[#1a1a1a] dark:text-[#e4e6eb]">{a.bezeichnung}</span>
                <span className="ml-2 text-xs text-[#65676b] dark:text-[#b0b3b8]">{a.kategorie}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className={`font-black ${a.bestand > 0 ? "text-[#00a400]" : "text-[#fa3e3e]"}`}>{a.bestand}</span>
                <Link href={`/admin/artikel/${a.id}`}
                  className="text-xs text-[#0064d2] dark:text-[#45bdff] hover:underline">Details</Link>
              </div>
            </div>
          ))}
          {!lp.artikel.length && (
            <p className="text-center py-6 text-[#65676b] dark:text-[#b0b3b8] text-sm">Keine Artikel in diesem Lagerplatz</p>
          )}
        </div>
      </div>

      {/* Deaktivieren */}
      {lp.aktiv && lp.artikel.length === 0 && (
        <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#fa3e3e]/30 p-6 shadow-sm">
          <h2 className="font-bold text-[#fa3e3e] mb-2">Lagerplatz deaktivieren</h2>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mb-4">Lagerplatz ist leer und kann deaktiviert werden.</p>
          <button onClick={() => setDeactOpen(true)}
            className="px-6 py-2.5 bg-[#fa3e3e] text-white font-bold rounded-xl hover:bg-red-600">
            Deaktivieren
          </button>
        </div>
      )}

      {/* Alle verschieben Modal */}
      <Modal open={verschiebeOpen} onClose={() => setVerschiebeOpen(false)} title="Alle Artikel verschieben">
        <div className="space-y-4">
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
            <strong className="text-[#1a1a1a] dark:text-[#e4e6eb]">{lp.artikel.length} Artikel</strong> von{" "}
            <span className="font-mono text-[#0064d2] dark:text-[#45bdff]">{lp.code}</span> verschieben nach:
          </p>
          <select
            value={nachLpId ?? ""}
            onChange={(e) => setNachLpId(Number(e.target.value) || null)}
            className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]"
          >
            <option value="">-- Ziel-Lagerplatz wählen --</option>
            {zielOptionen.map((l) => (
              <option key={l.id} value={l.id}>{l.code}{l.beschreibung ? ` — ${l.beschreibung}` : ""}</option>
            ))}
          </select>
          <div className="flex gap-3">
            <button onClick={() => setVerschiebeOpen(false)}
              className="flex-1 py-2.5 rounded-xl bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-semibold">
              Abbrechen
            </button>
            <button
              disabled={!nachLpId || verschiebeAlle.isPending}
              onClick={() => nachLpId && verschiebeAlle.mutate({ vonLagerplatzId: lpId, nachLagerplatzId: nachLpId, mitarbeiter: kuerzel })}
              className="flex-1 py-2.5 rounded-xl bg-[#f7b928] text-black font-bold hover:bg-yellow-500 disabled:opacity-50"
            >
              {verschiebeAlle.isPending ? "..." : "Verschieben"}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deactOpen} onClose={() => setDeactOpen(false)}
        onConfirm={() => deactivate.mutate({ id: lpId })}
        title="Lagerplatz deaktivieren" danger loading={deactivate.isPending}
        message={<>Lagerplatz <strong className="font-mono">{lp.code}</strong> deaktivieren?</>}
        confirmText="Deaktivieren"
      />
    </div>
  );
}

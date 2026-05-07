"use client";
import { useState } from "react";
import { BuchungsTyp, type Buchung } from "@prisma/client";
import { useDebounce } from "use-debounce";
import { useSession } from "next-auth/react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { PageLoader } from "@/components/ui/LoadingSpinner";
import { BelegModal } from "@/components/ui/BelegModal";
import { EinlagerBelegPreview, printEinlagerBeleg, type EinlagerBelegData } from "@/components/ui/EinlagerBeleg";
import type { SessionUser } from "@/core/types";

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

const TYP_FARBE: Record<BuchungsTyp, string> = {
  EINGANG: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  AUSGANG: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  DIREKT:  "bg-gray-100 text-gray-600 dark:bg-gray-800/30 dark:text-gray-400",
};

function formatDatum(d: Date | string) {
  return new Date(d).toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── Bearbeiten Modal ──────────────────────────────────────────────────────────

function EditModal({
  buchung,
  onSave,
  onClose,
  isPending,
}: {
  buchung:   Buchung & { artikel?: { bezeichnung: string } };
  onSave:    (menge: number, notiz: string) => void;
  onClose:   () => void;
  isPending: boolean;
}) {
  const [menge, setMenge] = useState(buchung.menge);
  const [notiz, setNotiz] = useState(buchung.notiz ?? "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-[#242526] rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#ced4da] dark:border-[#3e4042]">
          <h2 className="font-black text-lg text-[#1a1a1a] dark:text-[#e4e6eb]">✏️ Buchung bearbeiten</h2>
          <button onClick={onClose} className="text-[#65676b] hover:text-[#fa3e3e] text-xl font-bold">×</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Artikel (read-only) */}
          <div>
            <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase tracking-wider">Artikel</label>
            <div className="px-3 py-2 rounded-lg bg-[#f0f2f5] dark:bg-[#18191a] text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
              {buchung.bezeichnung}
            </div>
          </div>

          {/* Typ (read-only) */}
          <div>
            <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase tracking-wider">Typ (nicht änderbar)</label>
            <span className={`inline-block px-3 py-1 rounded text-xs font-bold ${TYP_FARBE[buchung.typ]}`}>
              {buchung.typ}
            </span>
          </div>

          {/* Menge */}
          <div>
            <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase tracking-wider">Menge</label>
            <input
              type="number" min={1} value={menge}
              onChange={(e) => setMenge(Math.max(1, Number(e.target.value)))}
              className="w-full px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]"
            />
          </div>

          {/* Notiz */}
          <div>
            <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase tracking-wider">Notiz</label>
            <input
              value={notiz} onChange={(e) => setNotiz(e.target.value)}
              placeholder="Notiz (optional)"
              className="w-full px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]"
            />
          </div>

          {/* Warnung */}
          <div className="flex items-start gap-2 px-3 py-2.5 bg-[#f7b928]/10 border border-[#f7b928]/30 rounded-lg">
            <span className="text-[#f7b928] flex-shrink-0">⚠️</span>
            <span className="text-xs text-[#1a1a1a] dark:text-[#e4e6eb]">
              Lagerbestand wird nach dem Speichern automatisch neu berechnet.
            </span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#ced4da] dark:border-[#3e4042]">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[#65676b] hover:text-[#fa3e3e] transition-colors">
            Abbrechen
          </button>
          <button
            onClick={() => onSave(menge, notiz)}
            disabled={isPending}
            className="px-5 py-2 bg-[#0064d2] text-white text-sm font-bold rounded-lg hover:bg-[#0056b3] disabled:opacity-50 transition-colors"
          >
            {isPending ? "Speichere…" : "Speichern"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Löschen-Bestätigung ───────────────────────────────────────────────────────

function DeleteModal({
  buchung,
  onConfirm,
  onClose,
  isPending,
}: {
  buchung:   Buchung;
  onConfirm: () => void;
  onClose:   () => void;
  isPending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-[#242526] rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="px-6 py-6 text-center space-y-3">
          <div className="text-4xl">🗑️</div>
          <h2 className="font-black text-lg text-[#1a1a1a] dark:text-[#e4e6eb]">Buchung wirklich löschen?</h2>
          <div className="px-4 py-3 bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl text-sm space-y-1">
            <div>
              <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold mr-2 ${TYP_FARBE[buchung.typ]}`}>{buchung.typ}</span>
              <strong>{buchung.menge}×</strong> {buchung.bezeichnung}
            </div>
            {buchung.notiz && <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">{buchung.notiz}</div>}
            <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">{formatDatum(buchung.datum)}</div>
          </div>
          <div className="flex items-start gap-2 px-3 py-2.5 bg-[#fa3e3e]/10 border border-[#fa3e3e]/30 rounded-lg text-left">
            <span className="text-[#fa3e3e] flex-shrink-0">⚠️</span>
            <span className="text-xs text-[#1a1a1a] dark:text-[#e4e6eb]">
              Lagerbestand wird nach dem Löschen automatisch neu berechnet!
            </span>
          </div>
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <button onClick={onClose} className="flex-1 py-2 text-sm text-[#65676b] font-semibold border border-[#ced4da] dark:border-[#3e4042] rounded-lg hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors">
            Abbrechen
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1 py-2 bg-[#fa3e3e] text-white text-sm font-bold rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors"
          >
            {isPending ? "Lösche…" : "Löschen"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Haupt-Seite ───────────────────────────────────────────────────────────────

export default function BuchungenPage() {
  const { show }  = useToast();
  const { data: session } = useSession();
  const user = session?.user as SessionUser | undefined;

  // Liste-Filter
  const [typFilter,    setTypFilter]    = useState<BuchungsTyp | "">("");

  // Buchungs-Formular
  const [suchArtikel,   setSuchArtikel]   = useState("");
  const [debArtikel]                      = useDebounce(suchArtikel, 300);
  const [selArtikelId,  setSelArtikelId]  = useState<number | null>(null);
  const [form, setForm] = useState<{ menge: number; typ: BuchungsTyp; notiz: string }>({ menge: 1, typ: BuchungsTyp.EINGANG, notiz: "" });

  // Modals
  const [editModal,    setEditModal]    = useState<(Buchung & { artikel?: { bezeichnung: string } }) | null>(null);
  const [deleteModal,  setDeleteModal]  = useState<Buchung | null>(null);
  const [belegModal,   setBelegModal]   = useState<EinlagerBelegData | null>(null);

  // Queries
  const { data, isLoading, refetch } = api.buchungen.getAll.useQuery({
    ...(typFilter ? { typ: typFilter as BuchungsTyp } : {}),
    limit: 200, offset: 0,
  });

  const suche = api.lager.searchAdmin.useQuery(
    { query: debArtikel },
    { enabled: debArtikel.length >= 2 },
  );

  // Mutations
  const buchen = api.buchungen.create.useMutation({
    onSuccess: (b) => {
      show(`✅ ${b.bezeichnung}: ${b.typ} ×${b.menge} | Bestand: ${b.neuerBestand}`, "success");
      setForm({ menge: 1, typ: BuchungsTyp.EINGANG, notiz: "" });
      setSuchArtikel("");
      setSelArtikelId(null);
      refetch();
      if (b.typ === BuchungsTyp.EINGANG && b.belegNr) {
        setBelegModal({
          belegNr:            b.belegNr,
          artikelBezeichnung: b.artikel.bezeichnung,
          lagerplatz:         b.artikel.lagerplatz,
          kategorie:          b.artikel.kategorie,
          menge:              b.menge,
          neuerBestand:       b.neuerBestand,
          notiz:              b.notiz ?? undefined,
          ersteller:          user?.kuerzel ?? b.mitarbeiter,
          datum:              new Date(b.datum),
        });
      }
    },
    onError: (e) => show(e.message, "error"),
  });

  const aktualisieren = api.buchungen.update.useMutation({
    onSuccess: (r) => {
      show(`✅ Gespeichert · Neuer Bestand: ${r.neuerBestand}`, "success");
      setEditModal(null);
      refetch();
    },
    onError: (e) => show(e.message, "error"),
  });

  const loeschen = api.buchungen.delete.useMutation({
    onSuccess: (r) => {
      show(`🗑️ Buchung gelöscht · Neuer Bestand: ${r.neuerBestand}`, "success");
      setDeleteModal(null);
      refetch();
    },
    onError: (e) => show(e.message, "error"),
  });

  const selBezeichnung = suche.data?.find((a) => a.id === selArtikelId)?.bezeichnung ?? "";

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Buchungen</h1>

      {/* Buchungs-Formular */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm">
        <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-4">Manuelle Buchung</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Artikel-Suche */}
          <div className="relative col-span-1 md:col-span-2">
            <input
              type="text"
              placeholder="Artikel suchen…"
              value={selArtikelId ? selBezeichnung : suchArtikel}
              onChange={(e) => { setSelArtikelId(null); setSuchArtikel(e.target.value); }}
              className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]"
            />
            {!selArtikelId && suche.data && suche.data.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-20 bg-white dark:bg-[#242526] border border-[#ced4da] dark:border-[#3e4042] rounded-xl shadow-xl mt-1 max-h-48 overflow-y-auto">
                {suche.data.map((a) => (
                  <button key={a.id} onClick={() => { setSelArtikelId(a.id); setSuchArtikel(a.bezeichnung); }}
                    className="w-full text-left px-4 py-2.5 hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] text-sm border-b border-[#ced4da] dark:border-[#3e4042] last:border-0">
                    <span className="font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">{a.bezeichnung}</span>
                    <span className={`ml-2 text-xs font-bold ${a.bestand > 0 ? "text-[#00a400]" : "text-[#fa3e3e]"}`}>
                      Bestand: {a.bestand}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Typ: nur Ein/Aus */}
          <div className="flex gap-2">
            {([BuchungsTyp.EINGANG, BuchungsTyp.AUSGANG] as BuchungsTyp[]).map((t) => (
              <button key={t} onClick={() => setForm((f) => ({ ...f, typ: t }))}
                className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-colors ${
                  form.typ === t
                    ? "bg-[#0064d2] text-white"
                    : "bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8]"
                }`}>
                {t === BuchungsTyp.EINGANG ? "📥 Ein" : "📤 Aus"}
              </button>
            ))}
          </div>

          {/* Menge */}
          <input type="number" min={1} value={form.menge}
            onChange={(e) => setForm((f) => ({ ...f, menge: Math.max(1, Number(e.target.value)) }))}
            className="px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]" />

          {/* Notiz */}
          <input placeholder="Notiz (optional)" value={form.notiz}
            onChange={(e) => setForm((f) => ({ ...f, notiz: e.target.value }))}
            className="col-span-1 md:col-span-2 px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]" />

          <button
            disabled={!selArtikelId || form.menge < 1 || buchen.isPending}
            onClick={() => selArtikelId && buchen.mutate({
              artikelId:   selArtikelId,
              menge:       form.menge,
              typ:         form.typ,
              mitarbeiter: user?.kuerzel ?? "ADMIN",
              notiz:       form.notiz || undefined,
            })}
            className="py-2.5 bg-[#0064d2] text-white font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50 shadow-sm transition-colors">
            {buchen.isPending ? "Buche…" : "Buchen"}
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-3 flex-wrap items-center">
        <select value={typFilter} onChange={(e) => setTypFilter(e.target.value as BuchungsTyp | "")}
          className="px-4 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] text-sm">
          <option value="">Alle Typen</option>
          <option value="EINGANG">Eingang</option>
          <option value="AUSGANG">Ausgang</option>
          <option value="DIREKT">Direkt</option>
        </select>
        <span className="text-sm text-[#65676b] dark:text-[#b0b3b8]">{data?.total ?? 0} Buchungen</span>
      </div>

      {/* Tabelle */}
      {isLoading ? <PageLoader /> : (
        <div className="overflow-x-auto bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="bg-[#f0f2f5] dark:bg-[#18191a] text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] border-b border-[#ced4da] dark:border-[#3e4042]">
                <th className="px-4 py-3 text-left">Datum</th>
                <th className="px-4 py-3 text-left">Mitarbeiter</th>
                <th className="px-4 py-3 text-left">Artikel</th>
                <th className="px-4 py-3 text-center">Typ</th>
                <th className="px-4 py-3 text-center">Menge</th>
                <th className="px-4 py-3 text-left">Notiz</th>
                <th className="px-4 py-3 text-center">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {data?.buchungen.map((b) => (
                <tr key={b.id} className="border-b border-[#ced4da] dark:border-[#3e4042] hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] text-sm">
                  <td className="px-4 py-3 text-[#65676b] dark:text-[#b0b3b8] whitespace-nowrap">
                    {formatDatum(b.datum)}
                  </td>
                  <td className="px-4 py-3 font-medium text-[#1a1a1a] dark:text-[#e4e6eb]">{b.mitarbeiter}</td>
                  <td className="px-4 py-3 text-[#1a1a1a] dark:text-[#e4e6eb]">{b.bezeichnung}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${TYP_FARBE[b.typ]}`}>{b.typ}</span>
                  </td>
                  <td className="px-4 py-3 text-center font-black">{b.menge}</td>
                  <td className="px-4 py-3 text-[#65676b] dark:text-[#b0b3b8] text-xs">{b.notiz ?? "–"}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => setEditModal(b)}
                        className="p-1.5 text-[#65676b] hover:text-[#0064d2] hover:bg-[#0064d2]/10 rounded transition-colors"
                        title="Bearbeiten"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => setDeleteModal(b)}
                        className="p-1.5 text-[#65676b] hover:text-[#fa3e3e] hover:bg-[#fa3e3e]/10 rounded transition-colors"
                        title="Löschen"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!data?.buchungen.length && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-[#65676b] dark:text-[#b0b3b8]">
                    Keine Buchungen
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Bearbeiten Modal */}
      {editModal && (
        <EditModal
          buchung={editModal}
          isPending={aktualisieren.isPending}
          onClose={() => setEditModal(null)}
          onSave={(menge, notiz) => aktualisieren.mutate({ id: editModal.id, menge, notiz: notiz || null })}
        />
      )}

      {/* Löschen-Bestätigung */}
      {deleteModal && (
        <DeleteModal
          buchung={deleteModal}
          isPending={loeschen.isPending}
          onClose={() => setDeleteModal(null)}
          onConfirm={() => loeschen.mutate({ id: deleteModal.id })}
        />
      )}

      {/* Einlagerbeleg Modal (nach EINGANG) */}
      {belegModal && (
        <BelegModal
          titel="📥 Einlagerbeleg drucken"
          beleg={<EinlagerBelegPreview data={belegModal} scale={2.5} />}
          onDrucken={() => printEinlagerBeleg(belegModal)}
          onSchliessen={() => setBelegModal(null)}
        />
      )}
    </div>
  );
}

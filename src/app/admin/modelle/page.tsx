"use client";
import { useState, useCallback } from "react";
import Link from "next/link";
import { useDebounce } from "use-debounce";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { PageLoader } from "@/components/ui/LoadingSpinner";

const STANDARD_TEILE = [
  "Displaymodul", "Tastatur", "Touchpad", "Füße vorne", "Füße hinten",
  "D Cover", "USB Board", "Power Button", "Lautsprecher", "Lüfter",
  "Thermalmodul", "BIOS Batterie", "Akku",
] as const;

const INPUT_CLS = "px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] text-sm";

// ──────────────────────────────────────────────────────────────────────────────
// Verknüpfungs-Modal
// ──────────────────────────────────────────────────────────────────────────────
function VerknuepfungsModal({
  modellId, onClose, onSaved,
}: { modellId: number; onClose: () => void; onSaved: () => void }) {
  const { show } = useToast();

  const { data, isLoading } = api.kompatibilitaet.getModalData.useQuery({ modellId });
  const [auswahl, setAuswahl] = useState<Record<string, number | null>>({});
  const [initialized, setInitialized] = useState(false);

  // Initialisierung wenn Daten geladen
  if (data && !initialized) {
    const init: Record<string, number | null> = {};
    for (const teil of STANDARD_TEILE) {
      init[teil] = data.currentMap[teil] ?? data.vorschlaege[teil] ?? null;
    }
    setAuswahl(init);
    setInitialized(true);
  }

  const setVerknuepfung = api.kompatibilitaet.setVerknuepfung.useMutation({
    onSuccess: (r) => {
      show(`✅ ${r.gespeichert} Verknüpfungen gespeichert`, "success");
      onSaved();
      onClose();
    },
    onError: (e) => show(e.message, "error"),
  });

  const autoVerknuepfung = api.kompatibilitaet.autoVerknuepfung.useMutation({
    onSuccess: (r) => {
      show(`💡 ${r.neu} Vorschläge auto-verknüpft`, "success");
      onSaved();
      onClose();
    },
    onError: (e) => show(e.message, "error"),
  });

  function handleSave() {
    setVerknuepfung.mutate({
      modellId,
      verknuepfungen: STANDARD_TEILE.map((t) => ({ teiltyp: t, artikelId: auswahl[t] ?? null })),
    });
  }

  if (isLoading || !data) return (
    <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-[#0064d2]/20 border-t-[#0064d2] rounded-full animate-spin" /></div>
  );

  return (
    <div className="space-y-4">
      {/* Info-Zeile */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
          Gerät: <strong className="text-[#1a1a1a] dark:text-[#e4e6eb]">{data.geraetVoll}</strong>
        </p>
        <button
          onClick={() => autoVerknuepfung.mutate({ modellId })}
          disabled={autoVerknuepfung.isPending}
          className="px-3 py-1.5 text-xs font-bold bg-[#f7b928]/10 text-[#f7b928] border border-[#f7b928]/30 rounded-lg hover:bg-[#f7b928]/20 disabled:opacity-50"
        >
          {autoVerknuepfung.isPending ? "..." : "💡 Auto-Vorschlag"}
        </button>
      </div>

      {/* 13 Kategorie-Zeilen */}
      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
        {STANDARD_TEILE.map((teil) => {
          const artikel   = data.artikelPerKategorie[teil] ?? [];
          const istVorschlag = data.vorschlaege[teil] !== null && !data.currentMap[teil] && auswahl[teil] === data.vorschlaege[teil];
          const gewaehlt  = auswahl[teil];

          return (
            <div key={teil} className="flex items-center gap-3">
              <div className="w-32 text-sm font-medium text-[#1a1a1a] dark:text-[#e4e6eb] flex-shrink-0">
                {teil}
              </div>
              <div className="flex-1 relative">
                <select
                  value={gewaehlt ?? ""}
                  onChange={(e) => setAuswahl((a) => ({ ...a, [teil]: Number(e.target.value) || null }))}
                  className={`w-full ${INPUT_CLS} ${istVorschlag ? "border-[#f7b928]" : ""}`}
                >
                  <option value="">— Keine Verknüpfung —</option>
                  {artikel.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.bezeichnung} (Bestand: {a.bestand})
                    </option>
                  ))}
                </select>
                {istVorschlag && (
                  <span className="absolute right-8 top-1/2 -translate-y-1/2 text-xs text-[#f7b928] font-bold pointer-events-none">💡</span>
                )}
              </div>
              {gewaehlt && (
                <button onClick={() => setAuswahl((a) => ({ ...a, [teil]: null }))}
                  className="text-[#65676b] hover:text-[#fa3e3e] flex-shrink-0 text-lg leading-none">×</button>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex gap-3 pt-2 border-t border-[#ced4da] dark:border-[#3e4042]">
        <button onClick={onClose}
          className="flex-1 py-2.5 rounded-xl bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-semibold">
          Abbrechen
        </button>
        <button onClick={handleSave} disabled={setVerknuepfung.isPending}
          className="flex-1 py-2.5 rounded-xl bg-[#0064d2] text-white font-bold hover:bg-blue-700 disabled:opacity-50">
          {setVerknuepfung.isPending ? "..." : "Alle speichern"}
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Haupt-Seite
// ──────────────────────────────────────────────────────────────────────────────
export default function ModelleListePage() {
  const { show } = useToast();

  const [search,    setSearch]    = useState("");
  const [hersteller, setHersteller] = useState("");
  const [ohneKomp,  setOhneKomp]  = useState(false);
  const [page,      setPage]      = useState(1);
  const [modalId,   setModalId]   = useState<number | null>(null);
  const [debouncedSearch] = useDebounce(search, 300);

  const { data, isLoading, error, refetch } = api.geraete.getAllWithKompCount.useQuery(
    { search: debouncedSearch || undefined, hersteller: hersteller || undefined, ohneKomp, page, limit: 50 },
    { refetchOnMount: "always", staleTime: 0 },
  );
  const herstellerOpts = api.geraete.getHersteller.useQuery();

  const setAktiv = api.geraete.setAktiv.useMutation({
    onSuccess: () => { refetch(); show("Status aktualisiert", "success"); },
    onError:   (e) => show(e.message, "error"),
  });

  const massAuto = api.kompatibilitaet.massAutoVerknuepfung.useMutation({
    onSuccess: (r) => {
      show(`✅ ${r.totalNeu} Verknüpfungen für ${r.verarbeitet} Modelle erstellt`, "success");
      refetch();
    },
    onError: (e) => show(e.message, "error"),
  });

  const selectedModell = data?.modelle.find((m) => m.id === modalId);

  if (isLoading) return <PageLoader />;
  if (error) return <div className="p-6 bg-[#fa3e3e]/10 border border-[#fa3e3e]/30 rounded-xl text-[#fa3e3e]">Fehler: {error.message}</div>;

  const { modelle = [], total = 0, pages = 1 } = data ?? {};

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Gerätemodelle</h1>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-0.5">{total} Modelle</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => massAuto.mutate()}
            disabled={massAuto.isPending}
            className="px-4 py-2 bg-[#f7b928]/10 text-[#f7b928] border border-[#f7b928]/30 font-bold rounded-xl hover:bg-[#f7b928]/20 disabled:opacity-50 text-sm"
          >
            {massAuto.isPending ? "⏳ Läuft..." : "⚡ Auto-Verknüpfung"}
          </button>
          <Link href="/admin/modelle/neu" className="px-4 py-2 bg-[#0064d2] text-white font-bold rounded-xl hover:bg-blue-700 shadow-sm text-sm">
            + Neues Modell
          </Link>
        </div>
      </div>

      {/* Filter */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-4 shadow-sm flex gap-3 flex-wrap items-center">
        <input type="text" placeholder="Hersteller oder Modell suchen..."
          value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className={`${INPUT_CLS} flex-1 min-w-[200px]`} />
        <select value={hersteller} onChange={(e) => { setHersteller(e.target.value); setPage(1); }} className={INPUT_CLS}>
          <option value="">Alle Hersteller</option>
          {herstellerOpts.data?.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm font-medium text-[#65676b] dark:text-[#b0b3b8] cursor-pointer">
          <input type="checkbox" checked={ohneKomp} onChange={(e) => { setOhneKomp(e.target.checked); setPage(1); }}
            className="w-4 h-4 accent-[#fa3e3e]" />
          Ohne Kompatibilität
        </label>
      </div>

      {/* Tabelle */}
      <div className="overflow-x-auto bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#f0f2f5] dark:bg-[#18191a] text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] border-b border-[#ced4da] dark:border-[#3e4042]">
              <th className="px-4 py-3 text-left">Hersteller</th>
              <th className="px-4 py-3 text-left">Modell</th>
              <th className="px-4 py-3 text-center">Verknüpfte Teile</th>
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 text-right">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {modelle.map((m) => (
              <tr key={m.id} className={`border-b border-[#ced4da] dark:border-[#3e4042] hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] ${!m.aktiv ? "opacity-50" : ""}`}>
                <td className="px-4 py-3 text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase">{m.hersteller}</td>
                <td className="px-4 py-3 font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">{m.modell}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`font-black text-lg ${m.kompAnzahl > 0 ? "text-[#00a400]" : "text-[#fa3e3e]"}`}>
                    {m.kompAnzahl}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${m.aktiv ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {m.aktiv ? "Aktiv" : "Inaktiv"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-1 justify-end">
                    <button
                      onClick={() => setModalId(m.id)}
                      className="px-3 py-1 text-xs font-bold rounded-lg bg-[#0064d2]/10 text-[#0064d2] dark:text-[#45bdff] border border-[#0064d2]/20 hover:bg-[#0064d2]/20"
                    >
                      🔗 Verknüpfen
                    </button>
                    <button
                      onClick={() => setAktiv.mutate({ id: m.id, aktiv: !m.aktiv })}
                      disabled={setAktiv.isPending}
                      className="px-3 py-1 text-xs font-semibold rounded-lg bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#ced4da] dark:hover:bg-[#555] disabled:opacity-50"
                    >
                      {m.aktiv ? "Deakt." : "Aktiv."}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!modelle.length && (
              <tr><td colSpan={5} className="text-center py-12 text-[#65676b] dark:text-[#b0b3b8]">
                {ohneKomp ? "Alle Modelle haben Kompatibilitäts-Einträge ✅" : "Keine Modelle gefunden"}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between gap-3 bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] px-4 py-3 shadow-sm">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#f0f2f5] dark:bg-[#3e4042] text-[#1a1a1a] dark:text-[#e4e6eb] hover:bg-[#ced4da] disabled:opacity-40">
            ← Zurück
          </button>
          <span className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Seite {page} / {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#f0f2f5] dark:bg-[#3e4042] text-[#1a1a1a] dark:text-[#e4e6eb] hover:bg-[#ced4da] disabled:opacity-40">
            Weiter →
          </button>
        </div>
      )}

      {/* Verknüpfungs-Modal */}
      <Modal
        open={modalId !== null}
        onClose={() => setModalId(null)}
        title={selectedModell ? `Kompatibilität: ${selectedModell.hersteller} ${selectedModell.modell}` : "Kompatibilität"}
        width="max-w-2xl"
      >
        {modalId !== null && (
          <VerknuepfungsModal
            modellId={modalId}
            onClose={() => setModalId(null)}
            onSaved={() => refetch()}
          />
        )}
      </Modal>
    </div>
  );
}

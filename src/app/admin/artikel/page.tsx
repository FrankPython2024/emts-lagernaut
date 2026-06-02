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
import { printMehrereLabels } from "@/components/ui/ArtikelLabel";
import { useStandortFilter } from "@/lib/standort/standortContext";
import { usePermissions } from "@/hooks/usePermissions";
import { ModellPoolModal } from "@/components/admin/ModellPoolModal";

type Artikel = {
  id: number; bezeichnung: string; kategorie: string;
  lagerplatz: string | null; bestand: number;
};

type BestandFilter = "alle" | "vorhanden" | "leer" | "kritisch";
type SortBy        = "bezeichnung" | "bestand" | "kategorie" | "updatedAt";
type SortOrder     = "asc" | "desc";

const LIMIT = 50;

const INPUT_CLS = "px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] text-sm";

export default function ArtikelPage() {
  const { show } = useToast();
  const { has } = usePermissions();
  const canEdit = has("ARTIKEL_EDIT"); // Schreib-UI nur mit Permission (Server erzwingt zusätzlich)
  const { activeStandortId } = useStandortFilter();

  // Filter State
  const [search,     setSearch]     = useState("");
  const [kategorie,  setKategorie]  = useState("");
  const [lagerplatz, setLagerplatz] = useState("");
  const [bestand,    setBestand]    = useState<BestandFilter>("alle");
  const [sortBy,     setSortBy]     = useState<SortBy>("bezeichnung");
  const [sortOrder,  setSortOrder]  = useState<SortOrder>("asc");
  const [page,       setPage]       = useState(1);
  const [selected,   setSelected]   = useState<Set<number>>(new Set());

  const [debouncedSearch] = useDebounce(search, 300);

  // Modal State
  const [buchModal,  setBuchModal]  = useState<Artikel | null>(null);
  const [poolModal,  setPoolModal]  = useState<Artikel | null>(null);
  const [delTarget,  setDelTarget]  = useState<Artikel | null>(null);
  const [buchMenge,  setBuchMenge]  = useState(1);
  const [buchTyp,    setBuchTyp]    = useState<BuchungsTyp>(BuchungsTyp.EINGANG);
  const [buchNotiz,  setBuchNotiz]  = useState("");
  const [buchMitarb, setBuchMitarb] = useState("");

  // Queries
  const liste = api.lager.getAll.useQuery(
    {
      search:     debouncedSearch || undefined,
      kategorie:  kategorie  || undefined,
      lagerplatz: lagerplatz || undefined,
      bestand:    bestand !== "alle" ? bestand : undefined,
      sortBy,
      sortOrder,
      page,
      limit:      LIMIT,
      standortId: activeStandortId,
    },
    { refetchOnMount: "always", staleTime: 0 },
  );

  const kategorien   = api.lager.getKategorien.useQuery();
  const lagerplaetze = api.lager.getLagerplaetze.useQuery();

  // Mutations
  const buchen = api.buchungen.create.useMutation({
    onSuccess: (b) => {
      show(`✅ ${b.bezeichnung}: ${b.typ} ${b.menge}x | Bestand: ${b.neuerBestand}`, "success");
      setBuchModal(null); setBuchMenge(1); setBuchNotiz(""); setBuchMitarb("");
      liste.refetch();
    },
    onError: (e) => show(e.message, "error"),
  });

  const loeschen = api.lager.delete.useMutation({
    onSuccess: () => {
      show("Artikel gelöscht.", "success");
      setDelTarget(null);
      liste.refetch();
    },
    onError: (e) => show(e.message, "error"),
  });

  // Filter zurücksetzen
  function resetFilter() {
    setSearch(""); setKategorie(""); setLagerplatz("");
    setBestand("alle"); setSortBy("bezeichnung"); setSortOrder("asc");
    setPage(1);
  }

  const aktiveFilter = [
    search, kategorie, lagerplatz,
    bestand !== "alle" ? bestand : "",
    sortBy  !== "bezeichnung" ? sortBy : "",
    sortOrder !== "asc" ? sortOrder : "",
  ].filter(Boolean).length;

  const { artikel = [], total = 0, pages = 1 } = liste.data ?? {};
  const startItem = (page - 1) * LIMIT + 1;
  const endItem   = Math.min(page * LIMIT, total);

  function toggleSelect(id: number) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleAll() {
    if (selected.size === artikel.length) { setSelected(new Set()); }
    else { setSelected(new Set(artikel.map((a) => a.id))); }
  }

  const columns: Column<Artikel>[] = [
    {
      key: "sel", header: "",
      width: "w-8",
      render: (a) => (
        <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleSelect(a.id)}
          className="w-4 h-4 accent-[#0064d2] cursor-pointer" />
      ),
    },
    {
      key: "id", header: "ID",
      render: (a) => <span className="font-mono text-xs text-[#65676b] dark:text-[#b0b3b8]">#{a.id}</span>,
      width: "w-14",
    },
    {
      key: "bezeichnung", header: "Bezeichnung",
      render: (a) => <span className="font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">{a.bezeichnung}</span>,
    },
    {
      key: "kategorie", header: "Kategorie",
      render: (a) => (
        <button
          onClick={() => { setKategorie(a.kategorie); setPage(1); }}
          className="px-2 py-0.5 bg-[#f0f2f5] dark:bg-[#3e4042] rounded text-xs hover:bg-[#0064d2]/10 hover:text-[#0064d2] dark:hover:text-[#45bdff] transition-colors"
        >
          {a.kategorie}
        </button>
      ),
    },
    {
      key: "lagerplatz", header: "Lagerplatz",
      render: (a) => (
        <button
          onClick={() => { if (a.lagerplatz) { setLagerplatz(a.lagerplatz); setPage(1); } }}
          className="font-mono text-sm text-[#65676b] dark:text-[#b0b3b8] hover:text-[#0064d2] dark:hover:text-[#45bdff]"
        >
          {a.lagerplatz ?? "–"}
        </button>
      ),
    },
    {
      key: "bestand", header: "Bestand",
      render: (a) => (
        <span className={`font-black text-lg ${a.bestand > 2 ? "text-[#00a400]" : a.bestand > 0 ? "text-[#f7b928]" : "text-[#fa3e3e]"}`}>
          {a.bestand}
        </span>
      ),
    },
    {
      key: "aktionen", header: "Aktionen",
      render: (a) => (
        <div className="flex gap-1">
          <Link href={`/admin/artikel/${a.id}`}
            className="px-2 py-2 text-xs rounded min-h-[36px] bg-[#f0f2f5] dark:bg-[#3e4042] hover:bg-[#ced4da] dark:hover:bg-[#555] font-semibold">
            ✏️
          </Link>
          <button onClick={() => setBuchModal(a)}
            className="px-2 py-2 text-xs rounded min-h-[36px] bg-[#0064d2]/10 text-[#0064d2] dark:text-[#45bdff] hover:bg-[#0064d2]/20 font-semibold">
            📥
          </button>
          <button onClick={() => setPoolModal(a)} title="Modelle verknüpfen"
            className="px-2 py-2 text-xs rounded min-h-[36px] bg-[#008bd2]/10 text-[#008bd2] hover:bg-[#008bd2]/20 font-semibold">
            🔗
          </button>
          {a.bestand === 0 && (
            <button onClick={() => setDelTarget(a)}
              className="px-2 py-2 text-xs rounded min-h-[36px] bg-[#fa3e3e]/10 text-[#fa3e3e] hover:bg-[#fa3e3e]/20 font-semibold">
              🗑️
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Artikel</h1>
          {total > 0 && (
            <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
              {total > 0 ? `Zeige ${startItem}–${endItem} von ${total} Artikeln` : "Keine Artikel"}
            </p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {selected.size > 0 && (
            <button
              onClick={() => {
                const sel = artikel.filter((a) => selected.has(a.id));
                printMehrereLabels(sel.map((a) => ({ id: a.id, bezeichnung: a.bezeichnung, lagerplatz: a.lagerplatz, kategorie: a.kategorie })));
              }}
              className="px-4 py-2 bg-[#8e44ad] text-white font-bold rounded-xl hover:bg-purple-700 shadow-sm text-sm"
            >
              🖨️ Labels drucken ({selected.size})
            </button>
          )}
          {artikel.length > 0 && (
            <button onClick={toggleAll}
              className="px-3 py-2 text-xs font-semibold rounded-xl bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#ced4da] dark:hover:bg-[#555]">
              {selected.size === artikel.length ? "Keine" : "Alle"} auswählen
            </button>
          )}
        </div>
        {canEdit && (
          <Link href="/admin/artikel/neu"
            className="px-4 py-2 bg-[#0064d2] text-white font-bold rounded-xl hover:bg-blue-700 shadow-sm text-sm">
            + Neuer Artikel
          </Link>
        )}
      </div>

      {/* Filter Bar */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-4 shadow-sm space-y-3">
        <div className="flex gap-2 flex-wrap items-center">
          {/* Suche */}
          <div className="relative flex-1 min-w-[200px]">
            <input
              type="text" placeholder="Bezeichnung oder Lagerplatz..."
              value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className={`${INPUT_CLS} w-full pr-7`}
            />
            {search && (
              <button onClick={() => { setSearch(""); setPage(1); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#65676b] hover:text-[#fa3e3e] font-bold text-sm">
                ✕
              </button>
            )}
          </div>

          {/* Kategorie */}
          <select value={kategorie} onChange={(e) => { setKategorie(e.target.value); setPage(1); }}
            className={INPUT_CLS}>
            <option value="">Alle Kategorien</option>
            {kategorien.data?.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>

          {/* Bestand */}
          <select value={bestand} onChange={(e) => { setBestand(e.target.value as BestandFilter); setPage(1); }}
            className={INPUT_CLS}>
            <option value="alle">Alle Bestände</option>
            <option value="vorhanden">Auf Lager ({">"} 0)</option>
            <option value="kritisch">Kritisch (1–2)</option>
            <option value="leer">Kein Bestand (= 0)</option>
          </select>

          {/* Lagerplatz */}
          <select value={lagerplatz} onChange={(e) => { setLagerplatz(e.target.value); setPage(1); }}
            className={INPUT_CLS}>
            <option value="">Alle Lagerplätze</option>
            {lagerplaetze.data?.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>

        <div className="flex gap-2 flex-wrap items-center">
          {/* Sortierung */}
          <select value={sortBy} onChange={(e) => { setSortBy(e.target.value as SortBy); setPage(1); }}
            className={INPUT_CLS}>
            <option value="bezeichnung">Bezeichnung A–Z</option>
            <option value="kategorie">Kategorie A–Z</option>
            <option value="bestand">Bestand</option>
            <option value="updatedAt">Zuletzt aktualisiert</option>
          </select>

          <select value={sortOrder} onChange={(e) => { setSortOrder(e.target.value as SortOrder); setPage(1); }}
            className={INPUT_CLS}>
            <option value="asc">↑ Aufsteigend</option>
            <option value="desc">↓ Absteigend</option>
          </select>

          {/* Filter Badge + Reset */}
          {aktiveFilter > 0 && (
            <button onClick={resetFilter} aria-label="Alle Filter zurücksetzen"
              className="flex items-center gap-1.5 px-3 py-2 bg-[#f7b928]/10 text-[#f7b928] border border-[#f7b928]/30 rounded-lg text-xs font-bold hover:bg-[#f7b928]/20 transition-colors">
              <span>{aktiveFilter} Filter aktiv</span>
              <span className="text-base leading-none">✕</span>
            </button>
          )}

          <span className="ml-auto text-xs text-[#65676b] dark:text-[#b0b3b8]">
            {liste.isLoading ? "Lädt..." : `${total} Artikel`}
          </span>
        </div>
      </div>

      {/* Tabelle */}
      <DataTable
        columns={columns}
        data={artikel as Artikel[]}
        keyFn={(a) => a.id}
        loading={liste.isLoading}
        emptyText="Keine Artikel gefunden"
      />

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between gap-3 bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] px-4 py-3 shadow-sm">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#f0f2f5] dark:bg-[#3e4042] text-[#1a1a1a] dark:text-[#e4e6eb] hover:bg-[#ced4da] dark:hover:bg-[#555] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← Zurück
          </button>

          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(pages, 7) }, (_, i) => {
              const p = pages <= 7 ? i + 1 : page <= 4 ? i + 1 : page >= pages - 3 ? pages - 6 + i : page - 3 + i;
              return (
                <button key={p} onClick={() => setPage(p)}
                  className={`w-9 h-9 rounded-lg text-sm font-bold transition-colors ${
                    p === page
                      ? "bg-[#0064d2] text-white"
                      : "bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#ced4da] dark:hover:bg-[#555]"
                  }`}>
                  {p}
                </button>
              );
            })}
          </div>

          <button
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#f0f2f5] dark:bg-[#3e4042] text-[#1a1a1a] dark:text-[#e4e6eb] hover:bg-[#ced4da] dark:hover:bg-[#555] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Weiter →
          </button>
        </div>
      )}

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
            className={`w-full ${INPUT_CLS}`} />
          <input type="number" min={1} value={buchMenge} onChange={(e) => setBuchMenge(Number(e.target.value))}
            className={`w-full ${INPUT_CLS}`} />
          <input type="text" placeholder="Notiz (optional)" value={buchNotiz} onChange={(e) => setBuchNotiz(e.target.value)}
            className={`w-full ${INPUT_CLS}`} />
          <button
            disabled={!buchMitarb || buchen.isPending}
            onClick={() => buchModal && buchen.mutate({ artikelId: buchModal.id, menge: buchMenge, typ: buchTyp, mitarbeiter: buchMitarb, notiz: buchNotiz || undefined })}
            className="w-full py-2.5 bg-[#0064d2] text-white font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50">
            {buchen.isPending ? "..." : "Buchen"}
          </button>
        </div>
      </Modal>

      {/* Pool-Verknüpfung Modal */}
      {poolModal && (
        <ModellPoolModal
          artikelId={poolModal.id}
          teiltyp={poolModal.kategorie}
          artikelBezeichnung={poolModal.bezeichnung}
          onClose={() => setPoolModal(null)}
          onSaved={() => liste.refetch()}
        />
      )}

      <ConfirmDialog
        open={!!delTarget} onClose={() => setDelTarget(null)}
        onConfirm={() => delTarget && loeschen.mutate({ id: delTarget.id })}
        title="Artikel löschen"
        message={<>Artikel <strong>{delTarget?.bezeichnung}</strong> wirklich löschen?</>}
        confirmText="Löschen" danger loading={loeschen.isPending}
      />
    </div>
  );
}

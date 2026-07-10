"use client";
import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useDebounce } from "@/hooks/useDebounce";
import { Check } from "lucide-react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { useStandortFilter } from "@/lib/standort/standortContext";
import { PageLoader } from "@/components/ui/LoadingSpinner";
import { getLucideIcon } from "@/lib/icons/getLucideIcon";
import { usePermissions } from "@/hooks/usePermissions";

// ── Konstanten ────────────────────────────────────────────────────────────────

const INPUT_CLS = "px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] text-sm";

// ══════════════════════════════════════════════════════════════════════════════
// Zusätzliche Teile für Modell (modell-spezifische Custom-Teiltypen)
// ══════════════════════════════════════════════════════════════════════════════
// HINWEIS: Die Zuordnung von Ersatzteil-ARTIKELN zu Modellen erfolgt ausschließlich
// über die Artikel-Seite („Modelle verknüpfen"). Die frühere Modell→Artikel-
// Verknüpfung wurde hier entfernt. Diese Sektion betrifft NUR die Custom-Teiltypen
// (welche zusätzlichen Teiltypen für ein Modell gelten) — nicht die Artikel.

function ZusaetzlicheTeileForModell({ modellId }: { modellId: number }) {
  const { show } = useToast();
  const alleTeiltypen = api.teiltypen.list.useQuery({ nurAktive: true });
  const modellIds     = api.teiltypen.modellTeiltypIds.useQuery({ modellId });

  const setzen = api.teiltypen.setzeFuerModell.useMutation({
    onSuccess: () => {
      modellIds.refetch();
      show("Zusätzliche Teile gespeichert", "success");
    },
    onError: (e) => show(e.message, "error"),
  });

  if (alleTeiltypen.isLoading || modellIds.isLoading) {
    return (
      <div className="flex justify-center py-4">
        <div className="w-5 h-5 border-2 border-[#0064d2]/20 border-t-[#0064d2] rounded-full animate-spin" />
      </div>
    );
  }

  const customTeiltypen = (alleTeiltypen.data ?? []).filter(t => !t.istStandard);
  const selected = new Set(modellIds.data ?? []);

  function toggle(id: number) {
    const neu = new Set(selected);
    if (neu.has(id)) neu.delete(id); else neu.add(id);
    setzen.mutate({ modellId, teiltypIds: Array.from(neu) });
  }

  return (
    <div className="space-y-3">
      <div>
        <h4 className="font-semibold text-lg text-[#1a1a1a] dark:text-[#e4e6eb]">
          Zusätzliche Teile für dieses Modell
        </h4>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
          Die Standard-Teile sind immer verfügbar. Hier wählst du zusätzlich modell-spezifische Teiltypen.
        </p>
      </div>

      {customTeiltypen.length === 0 ? (
        <div className="px-4 py-4 rounded-lg bg-[#f0f2f5] dark:bg-[#18191a] text-sm text-[#65676b] dark:text-[#b0b3b8]">
          Noch keine Custom-Teiltypen angelegt. In{" "}
          <Link href="/admin/teiltypen" className="text-[#0064d2] hover:underline font-semibold">
            Teiltypen-Verwaltung
          </Link>{" "}
          kannst du neue anlegen.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
          {customTeiltypen.map(t => {
            const Icon     = getLucideIcon(t.icon);
            const isActive = selected.has(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggle(t.id)}
                disabled={setzen.isPending}
                aria-pressed={isActive}
                className={`
                  flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all
                  ${isActive
                    ? "border-[#008bd2] bg-[#008bd2]/10 dark:bg-[#008bd2]/20"
                    : "border-[#ced4da] dark:border-[#3e4042] hover:border-[#008bd2]/50 bg-white dark:bg-[#242526]"}
                  disabled:opacity-50
                `}
                style={{ minHeight: 56 }}
              >
                <Icon size={20} className={isActive ? "text-[#008bd2]" : "text-[#65676b] dark:text-[#b0b3b8]"} />
                <span className="flex-1 text-sm font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">
                  {t.name}
                </span>
                {isActive && <Check size={16} className="text-[#008bd2] flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Haupt-Seite — reine Modell-Übersicht (Liste, Suche, Anlegen, Aktiv/Inaktiv)
// ══════════════════════════════════════════════════════════════════════════════

function ModelleListePageInner() {
  const { show } = useToast();
  const { has } = usePermissions();
  const canEdit = has("MODELL_EDIT"); // Schreib-UI nur mit Permission (Server erzwingt zusätzlich)
  const { activeStandortId } = useStandortFilter();

  const searchParams = useSearchParams();
  const initialQ    = searchParams?.get("q")         ?? "";
  const highlightId = searchParams?.get("highlight") ?? null;

  const [search,     setSearch]     = useState(initialQ);
  const [hersteller, setHersteller] = useState("");
  const [ohneKomp,   setOhneKomp]   = useState(false);
  const [page,       setPage]       = useState(1);
  const debouncedSearch = useDebounce(search, 300);

  const [detailId, setDetailId] = useState<number | null>(null);

  const { data, isLoading, error, refetch } = api.geraete.getAllWithKompCount.useQuery(
    { search: debouncedSearch || undefined, hersteller: hersteller || undefined, ohneKomp, page, limit: 50, standortId: activeStandortId },
    { refetchOnMount: "always", staleTime: 0 },
  );
  const herstellerOpts = api.geraete.getHersteller.useQuery();

  const setAktiv = api.geraete.setAktiv.useMutation({
    onSuccess: () => { refetch(); show("Status aktualisiert", "success"); },
    onError:   (e) => show(e.message, "error"),
  });

  const selectedModell = data?.modelle.find((m) => m.id === detailId);

  // Aus GlobalSearch: ?highlight=<id> → Detail-Modal öffnen + zur Zeile scrollen
  useEffect(() => {
    if (!highlightId || !data) return;
    const n = Number(highlightId);
    if (isNaN(n)) return;
    setDetailId(n);
    const el = document.getElementById(`row-${n}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("row-highlight");
      setTimeout(() => el.classList.remove("row-highlight"), 3000);
    }
  }, [highlightId, data]);

  if (isLoading) return <PageLoader />;
  if (error)     return <div className="p-6 bg-[#fa3e3e]/10 border border-[#fa3e3e]/30 rounded-xl text-[#fa3e3e]">Fehler: {error.message}</div>;

  const { modelle = [], total = 0, pages = 1 } = data ?? {};

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Gerätemodelle</h1>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-0.5">{total} Modelle</p>
        </div>
        {canEdit && (
          <Link href="/admin/modelle/neu" className="px-4 py-2 bg-[#0064d2] text-white font-bold rounded-xl hover:bg-blue-700 shadow-sm text-sm">
            + Neues Modell
          </Link>
        )}
      </div>

      {/* Hinweis: Verknüpfung läuft über den Artikel */}
      <div className="rounded-xl border border-[#0064d2]/30 bg-[#0064d2]/5 px-4 py-3 text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
        ℹ️ Die Zuordnung von Ersatzteilen erfolgt über die{" "}
        <Link href="/admin/artikel" className="text-[#0064d2] hover:underline font-semibold">Artikel-Seite</Link>{" "}
        („Modelle verknüpfen" am jeweiligen Artikel). Diese Seite dient der Modell-Verwaltung.
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
          Ohne verknüpfte Teile
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
              <tr key={m.id} id={`row-${m.id}`} className={`border-b border-[#ced4da] dark:border-[#3e4042] hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] ${!m.aktiv ? "opacity-50" : ""}`}>
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
                  <div className="flex gap-1 justify-end flex-wrap">
                    {/* 📋 Details (modell-spezifische Zusatz-Teiltypen) */}
                    <button
                      onClick={() => setDetailId(m.id)}
                      className="px-2.5 py-2 text-xs font-bold rounded-lg min-h-[36px] bg-[#f0f2f5] dark:bg-[#3e4042] text-[#1a1a1a] dark:text-[#e4e6eb] border border-[#ced4da] dark:border-[#555] hover:bg-[#ced4da] dark:hover:bg-[#555] transition-colors"
                      title="Details anzeigen"
                    >
                      📋 Details
                    </button>
                    {/* Aktiv/Inaktiv */}
                    <button
                      onClick={() => setAktiv.mutate({ id: m.id, aktiv: !m.aktiv })}
                      disabled={setAktiv.isPending}
                      className="px-2.5 py-2 text-xs font-semibold rounded-lg min-h-[36px] bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#ced4da] dark:hover:bg-[#555] disabled:opacity-50 transition-colors"
                    >
                      {m.aktiv ? "Deakt." : "Aktiv."}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!modelle.length && (
              <tr><td colSpan={5} className="text-center py-12 text-[#65676b] dark:text-[#b0b3b8]">
                {ohneKomp ? "Alle Modelle haben verknüpfte Teile ✅" : "Keine Modelle gefunden"}
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

      {/* Detail-Modal — modell-spezifische Zusatz-Teiltypen */}
      <Modal
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        title={selectedModell ? `${selectedModell.hersteller} ${selectedModell.modell}` : "Details"}
        width="max-w-2xl"
      >
        {detailId !== null && <ZusaetzlicheTeileForModell modellId={detailId} />}
      </Modal>
    </div>
  );
}

export default function ModelleListePage() {
  return (
    <Suspense fallback={<div className="p-6 text-[#65676b] dark:text-[#b0b3b8]">Lade…</div>}>
      <ModelleListePageInner />
    </Suspense>
  );
}

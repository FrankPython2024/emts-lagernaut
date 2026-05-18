"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useDebounce } from "use-debounce";
import FocusTrap from "focus-trap-react";
import { api } from "@/trpc/react";
import type { SessionUser } from "@/core/types";

// ── Domain types (narrowed from Meilisearch hits) ─────────────────────────────
type ArtikelHit  = { id: number; bezeichnung: string; kategorie: string; bestand: number; lagerplatz?: string | null; modell?: string; bestandStatus?: string };
type ModellHit   = { id: number; modell: string; hersteller: string; lagerplatz?: string | null; anzahlLogIds?: number };
type AnfrageHit  = { id: number; gruppenNr?: string | null; teiltyp: string; geraet: string; techniker: string; status: string; erstelltAm?: number };
type BuchungHit  = { id: number; typ: string; artikelBezeichnung: string; menge: number; ausgefuehrtVon: string; datum?: number };
type AnyHit      = { _type: string; id: number; [k: string]: unknown };

// ── Search history ─────────────────────────────────────────────────────────────
const HIST_KEY = "lagernaut_search_history";

function loadHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) ?? "[]"); }
  catch { return []; }
}

function saveToHistory(q: string) {
  const next = [q, ...loadHistory().filter(h => h !== q)].slice(0, 5);
  localStorage.setItem(HIST_KEY, JSON.stringify(next));
}

// ── Badge ─────────────────────────────────────────────────────────────────────
const BADGE_CLS: Record<string, string> = {
  NEU:            "bg-green-100  text-green-800  dark:bg-green-900/30  dark:text-green-300",
  BEDARF:         "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  IN_BEARBEITUNG: "bg-blue-100   text-blue-800   dark:bg-blue-900/30   dark:text-blue-300",
  ABGESCHLOSSEN:  "bg-gray-100   text-gray-600   dark:bg-gray-800      dark:text-gray-400",
  STORNIERT:      "bg-red-100    text-red-700    dark:bg-red-900/30    dark:text-red-400",
  EINGANG:        "bg-green-100  text-green-800  dark:bg-green-900/30  dark:text-green-300",
  AUSGANG:        "bg-red-100    text-red-700    dark:bg-red-900/30    dark:text-red-400",
  DIREKT:         "bg-gray-100   text-gray-600   dark:bg-gray-800      dark:text-gray-400",
};

function Badge({ label }: { label: string }) {
  const cls = BADGE_CLS[label] ?? "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase leading-none ${cls}`}>
      {label}
    </span>
  );
}

// ── Hit-Rows ──────────────────────────────────────────────────────────────────
function ArtikelRow({ h, isAdmin }: { h: ArtikelHit; isAdmin: boolean }) {
  const ok = (h.bestand ?? 0) > 0;
  return (
    <div>
      <div className="flex items-center gap-2 min-w-0">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ok ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"}`} />
        <span className="font-semibold text-[#1a1a1a] dark:text-[#e4e6eb] truncate">{h.bezeichnung}</span>
        <span className="ml-auto text-xs text-[#65676b] dark:text-[#b0b3b8] whitespace-nowrap flex-shrink-0">
          Bestand: {h.bestand}
        </span>
      </div>
      <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-0.5 pl-4 truncate">
        {h.kategorie}{isAdmin && h.lagerplatz ? ` · ${h.lagerplatz}` : ""}
      </div>
    </div>
  );
}

function ModellRow({ h, isAdmin }: { h: ModellHit; isAdmin: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-semibold text-[#1a1a1a] dark:text-[#e4e6eb] truncate">
          {h.hersteller} · {h.modell}
        </span>
        <span className="ml-auto text-xs text-[#65676b] dark:text-[#b0b3b8] whitespace-nowrap flex-shrink-0">
          {h.anzahlLogIds ?? 0} Geräte
        </span>
      </div>
      {isAdmin && h.lagerplatz && (
        <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-0.5">{h.lagerplatz}</div>
      )}
    </div>
  );
}

function AnfrageRow({ h }: { h: AnfrageHit }) {
  const datum = h.erstelltAm ? new Date(h.erstelltAm).toLocaleDateString("de-DE") : "";
  return (
    <div>
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-semibold text-[#1a1a1a] dark:text-[#e4e6eb] truncate">
          #{h.id} · {h.teiltyp}
        </span>
        <span className="flex-shrink-0"><Badge label={h.status} /></span>
      </div>
      <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-0.5 truncate">
        {h.techniker} · {h.geraet}{datum ? ` · ${datum}` : ""}
      </div>
    </div>
  );
}

function BuchungRow({ h }: { h: BuchungHit }) {
  const datum = h.datum ? new Date(h.datum).toLocaleDateString("de-DE") : "";
  return (
    <div>
      <div className="flex items-center gap-2 min-w-0">
        <span className="flex-shrink-0"><Badge label={h.typ} /></span>
        <span className="font-semibold text-[#1a1a1a] dark:text-[#e4e6eb] truncate">{h.artikelBezeichnung}</span>
        <span className="ml-auto text-xs text-[#65676b] dark:text-[#b0b3b8] whitespace-nowrap flex-shrink-0">
          ×{h.menge}
        </span>
      </div>
      <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-0.5 truncate">
        {h.ausgefuehrtVon}{datum ? ` · ${datum}` : ""}
      </div>
    </div>
  );
}

// ── GlobalSearch ──────────────────────────────────────────────────────────────
interface GlobalSearchProps {
  open:    boolean;
  onClose: () => void;
}

export function GlobalSearch({ open, onClose }: GlobalSearchProps) {
  const { data: session }         = useSession();
  const isAdmin                   = (session?.user as SessionUser | undefined)?.rolle === "ADMIN";
  const [query, setQuery]         = useState("");
  const [activeIdx, setActiveIdx] = useState(-1);
  const [history, setHistory]     = useState<string[]>([]);
  const inputRef                  = useRef<HTMLInputElement>(null);
  const listRef                   = useRef<HTMLDivElement>(null);
  const router                    = useRouter();

  const [debouncedQuery] = useDebounce(query, 200);

  const { data, isLoading, isError } = api.search.global.useQuery(
    { query: debouncedQuery, limit: 5 },
    { enabled: debouncedQuery.length >= 2, staleTime: 30_000 },
  );

  // Reset + focus on open
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIdx(-1);
    setHistory(loadHistory());
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [open]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);

  // Build groups — Techniker sehen nur Artikel + Modelle
  const groups = [
    { type: "artikel",  label: "Artikel",   emoji: "📦", hits: (data?.artikel.hits  ?? []) as ArtikelHit[],  total: data?.artikel.estimatedTotalHits  ?? 0 },
    { type: "modell",   label: "Modelle",   emoji: "🖥️", hits: (data?.modelle.hits  ?? []) as ModellHit[],   total: data?.modelle.estimatedTotalHits  ?? 0 },
    ...(isAdmin ? [
      { type: "anfrage", label: "Anfragen",  emoji: "📋", hits: (data?.anfragen.hits ?? []) as AnfrageHit[], total: data?.anfragen.estimatedTotalHits ?? 0 },
      { type: "buchung", label: "Buchungen", emoji: "📑", hits: (data?.buchungen.hits ?? []) as BuchungHit[], total: data?.buchungen.estimatedTotalHits ?? 0 },
    ] : []),
  ];

  // Build flat indexed list for keyboard nav
  const indexedGroups = (() => {
    if (debouncedQuery.length < 2 || !data) return [];
    let n = 0;
    return groups
      .filter(g => g.hits.length > 0)
      .map(g => ({
        ...g,
        indexedHits: g.hits.map(h => ({ h, idx: n++ })),
        extra: g.total - g.hits.length,
      }));
  })();

  const allHits: AnyHit[] = indexedGroups.flatMap(g =>
    g.indexedHits.map(({ h }) => ({ ...h, _type: g.type }) as AnyHit),
  );
  const hasResults = allHits.length > 0;
  const showHistory = debouncedQuery.length < 2 && history.length > 0;

  // Navigate to destination on hit
  function handleHit(hit: AnyHit) {
    const q = query.trim();
    if (q) saveToHistory(q);
    const hl     = `highlight=${hit.id}`;
    const qAndHl = q ? `?q=${encodeURIComponent(q)}&${hl}` : `?${hl}`;
    switch (hit._type) {
      // Artikel: direkt zur Detail-Seite
      case "artikel":  router.push(isAdmin ? `/admin/artikel/${hit.id}` : "/techniker"); break;
      // Listenseiten: Filter + Scroll-Hervorhebung via URL-Params
      case "modell":   router.push(`/admin/modelle${qAndHl}`);  break;
      case "anfrage":  router.push(`/admin/anfragen${qAndHl}`); break;
      case "buchung":  router.push(`/admin/buchungen${qAndHl}`); break;
    }
    onClose();
  }

  // Arrow-key + Enter navigation (on the wrapping div)
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, allHits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIdx >= 0 && allHits[activeIdx]) {
      e.preventDefault();
      handleHit(allHits[activeIdx]!);
    }
  }

  // Scroll active item into view
  useEffect(() => {
    if (activeIdx < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  // Reset active idx when query changes
  useEffect(() => { setActiveIdx(-1); }, [debouncedQuery]);

  if (!open) return null;

  return (
    <FocusTrap focusTrapOptions={{ escapeDeactivates: false, clickOutsideDeactivates: false, returnFocusOnDeactivate: true }}>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[9999] flex items-start justify-center bg-black/60 backdrop-blur-sm pt-16 px-4"
        onClick={onClose}
        role="presentation"
      >
        {/* Modal */}
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Globale Suche"
          className="relative w-full max-w-[600px] bg-white dark:bg-[#242526] rounded-2xl shadow-2xl border border-[#ced4da] dark:border-[#3e4042] overflow-hidden"
          onClick={e => e.stopPropagation()}
          onKeyDown={handleKeyDown}
        >
          {/* ── Input ── */}
          <div className="flex items-center gap-3 px-4 py-4 border-b border-[#ced4da] dark:border-[#3e4042]">
            <span className="text-xl text-[#65676b] dark:text-[#b0b3b8] flex-shrink-0" aria-hidden>🔍</span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => { setQuery(e.target.value); }}
              placeholder="Suchen… Artikel, Modelle, Anfragen, Buchungen"
              className="flex-1 bg-transparent outline-none text-lg text-[#1a1a1a] dark:text-[#e4e6eb] placeholder:text-[#b0b3b8] dark:placeholder:text-[#65676b] min-w-0"
              autoComplete="off"
              spellCheck={false}
              aria-label="Suchbegriff eingeben"
            />
            {isLoading && debouncedQuery.length >= 2 && (
              <span className="text-sm text-[#65676b] dark:text-[#b0b3b8] animate-pulse flex-shrink-0" aria-live="polite">…</span>
            )}
            <button
              onClick={onClose}
              aria-label="Suche schließen"
              className="text-[#65676b] hover:text-[#fa3e3e] dark:text-[#b0b3b8] text-2xl w-9 h-9 flex items-center justify-center rounded-lg hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors flex-shrink-0"
            >
              ×
            </button>
          </div>

          {/* ── Results ── */}
          <div ref={listRef} className="overflow-y-auto max-h-[420px]" role="listbox" aria-label="Suchergebnisse">

            {/* Search history */}
            {showHistory && (
              <div className="px-4 py-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#b0b3b8] dark:text-[#65676b] mb-2">
                  Zuletzt gesucht
                </div>
                {history.map(h => (
                  <button
                    key={h}
                    onClick={() => setQuery(h)}
                    className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors text-left min-h-[40px]"
                  >
                    <span aria-hidden>🕐</span>
                    {h}
                  </button>
                ))}
              </div>
            )}

            {/* Loading */}
            {debouncedQuery.length >= 2 && isLoading && !data && (
              <div className="px-4 py-10 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]" aria-live="polite">
                Suche läuft…
              </div>
            )}

            {/* Error */}
            {debouncedQuery.length >= 2 && isError && (
              <div className="px-4 py-10 text-center" aria-live="assertive">
                <p className="text-sm text-[#fa3e3e] mb-2">Suche temporär nicht verfügbar</p>
              </div>
            )}

            {/* No results */}
            {debouncedQuery.length >= 2 && !isLoading && !isError && data && !hasResults && (
              <div className="px-4 py-10 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]" aria-live="polite">
                Keine Treffer für <strong className="text-[#1a1a1a] dark:text-[#e4e6eb]">„{query}"</strong>
              </div>
            )}

            {/* Result groups */}
            {indexedGroups.map(group => (
              <div
                key={group.type}
                className="border-b border-[#f0f2f5] dark:border-[#3e4042] last:border-0"
                role="group"
                aria-label={group.label}
              >
                {/* Group header */}
                <div className="flex items-center gap-2 px-4 py-2 bg-[#f7f8fa] dark:bg-[#18191a] sticky top-0">
                  <span className="text-sm" aria-hidden>{group.emoji}</span>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8]">
                    {group.label}
                  </span>
                  <span className="ml-auto text-[10px] text-[#b0b3b8] dark:text-[#65676b]">
                    {group.total} Treffer
                  </span>
                </div>

                {/* Hits */}
                {group.indexedHits.map(({ h, idx }) => {
                  const hit = { ...h, _type: group.type } as AnyHit;
                  const isActive = idx === activeIdx;
                  return (
                    <button
                      key={(h as { id: number }).id}
                      data-idx={idx}
                      role="option"
                      aria-selected={isActive}
                      onClick={() => { setActiveIdx(idx); handleHit(hit); }}
                      onMouseEnter={() => setActiveIdx(idx)}
                      className={`w-full px-4 py-3 text-left transition-colors border-b border-[#f0f2f5]/60 dark:border-[#3e4042]/60 last:border-0 min-h-[56px] flex items-center ${
                        isActive
                          ? "bg-[#e7f3ff] dark:bg-[#263141]"
                          : "hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"
                      }`}
                      style={isActive ? { outline: "2px solid #008BD2", outlineOffset: -2 } : undefined}
                    >
                      <div className="w-full">
                        {group.type === "artikel"  && <ArtikelRow  h={h as ArtikelHit}  isAdmin={isAdmin} />}
                        {group.type === "modell"   && <ModellRow   h={h as ModellHit}   isAdmin={isAdmin} />}
                        {group.type === "anfrage"  && <AnfrageRow  h={h as AnfrageHit} />}
                        {group.type === "buchung"  && <BuchungRow  h={h as BuchungHit} />}
                      </div>
                    </button>
                  );
                })}

                {/* "X weitere" footer */}
                {group.extra > 0 && (
                  <div className="px-4 py-2 text-[11px] text-[#b0b3b8] dark:text-[#65676b] text-center italic">
                    +{group.extra} weitere {group.label}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* ── Footer Keyboard Hints ── */}
          {(hasResults || (debouncedQuery.length >= 2 && !isLoading)) && (
            <div className="px-4 py-2.5 border-t border-[#ced4da] dark:border-[#3e4042] bg-[#f7f8fa] dark:bg-[#18191a]">
              <span className="text-[11px] text-[#b0b3b8] dark:text-[#65676b]" aria-hidden>
                ↑↓ navigieren · Enter öffnen · Esc schließen
              </span>
            </div>
          )}
        </div>
      </div>
    </FocusTrap>
  );
}

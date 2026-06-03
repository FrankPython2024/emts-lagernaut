"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { api } from "@/trpc/react";
import type { AppRouter } from "@/server/routers";
import { PageLoader } from "@/components/ui/LoadingSpinner";

type RouterOutputs = inferRouterOutputs<AppRouter>;

/**
 * Datenbank-Explorer — Schritt 1: Passwort-Gate + leeres Gerüst.
 *
 * Nur für Rolle ADMIN (Sidebar-Gate SYSTEM_ADMIN + serverseitig adminProcedure)
 * und zusätzlich durch ein eigenes Passwort gesichert. Inhalte (Tabellen,
 * Relationen, Zeilen) folgen in den Schritten 2–4.
 */
export default function DatenbankPage() {
  const statusQuery = api.datenbank.status.useQuery(undefined, { staleTime: 30_000 });

  const [passwort, setPasswort] = useState("");
  const [fehler,   setFehler]   = useState<string | null>(null);

  const unlock = api.datenbank.unlock.useMutation({
    onSuccess: () => {
      setPasswort("");
      setFehler(null);
      statusQuery.refetch();
    },
    onError: (e) => setFehler(e.message || "Freischalten fehlgeschlagen."),
  });

  const lock = api.datenbank.lock.useMutation({
    onSuccess: () => statusQuery.refetch(),
  });

  function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (!passwort.trim() || unlock.isPending) return;
    unlock.mutate({ passwort });
  }

  if (statusQuery.isLoading) return <PageLoader />;

  const unlocked = statusQuery.data?.unlocked ?? false;

  return (
    <div className={`mx-auto space-y-6 ${unlocked ? "max-w-5xl" : "max-w-3xl"}`}>
      {/* ── Kopf ── */}
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex items-center justify-center w-11 h-11 rounded-xl text-white text-xl flex-shrink-0"
          style={{ background: "#202F61" }}
        >
          🛢️
        </span>
        <div>
          <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Datenbank-Explorer</h1>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
            Read-only Einblick in die Datenbank — nur für Administratoren, separat passwortgeschützt.
          </p>
        </div>
      </div>

      {!unlocked ? (
        /* ── Passwort-Gate ── */
        <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-6 sm:p-8">
          <div className="flex items-start gap-3 mb-5">
            <span aria-hidden className="text-2xl">🔒</span>
            <div>
              <h2 className="font-black text-lg text-[#1a1a1a] dark:text-[#e4e6eb]">Gesperrt</h2>
              <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
                Bitte das Datenbank-Explorer-Passwort eingeben. Die Freischaltung gilt für 2&nbsp;Stunden.
              </p>
            </div>
          </div>

          <form onSubmit={handleUnlock} className="space-y-4">
            <div>
              <label htmlFor="db-explorer-pw" className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1.5 uppercase tracking-wider">
                Passwort
              </label>
              <input
                id="db-explorer-pw"
                type="password"
                autoComplete="off"
                autoFocus
                value={passwort}
                onChange={(e) => { setPasswort(e.target.value); setFehler(null); }}
                aria-invalid={!!fehler}
                aria-describedby={fehler ? "db-explorer-error" : undefined}
                className="w-full min-h-[56px] px-4 rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] text-base outline-none focus:border-[#008BD2] focus:ring-2 focus:ring-[#008BD2]/40 transition-colors"
                placeholder="••••••••"
              />
            </div>

            {fehler && (
              <div
                id="db-explorer-error"
                role="alert"
                className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[#fa3e3e]/10 border border-[#fa3e3e]/30 text-[#b91c1c] dark:text-[#fca5a5] text-sm font-semibold"
              >
                <span aria-hidden>⚠️</span> {fehler}
              </div>
            )}

            <button
              type="submit"
              disabled={!passwort.trim() || unlock.isPending}
              className="w-full min-h-[56px] px-6 rounded-xl text-white font-bold text-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#008BD2] dark:focus:ring-offset-[#242526]"
              style={{ background: "#008BD2" }}
            >
              {unlock.isPending ? "Wird geprüft…" : "🔓 Freischalten"}
            </button>
          </form>
        </div>
      ) : (
        /* ── Freigeschaltet: Übersicht + Verknüpfungen ── */
        <DatenbankInhalt onLock={() => lock.mutate()} lockPending={lock.isPending} />
      )}
    </div>
  );
}

// ── Freigeschalteter Inhalt: Kopf + Tab-Navigation ───────────────────────────

type Tab = "uebersicht" | "verknuepfungen";

function DatenbankInhalt({ onLock, lockPending }: { onLock: () => void; lockPending: boolean }) {
  const overview = api.datenbank.overview.useQuery(undefined, { staleTime: 30_000 });
  const [tab, setTab] = useState<Tab>("uebersicht");

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "uebersicht",     label: "Übersicht",     icon: "📋" },
    { id: "verknuepfungen", label: "Verknüpfungen", icon: "🔗" },
  ];

  return (
    <div className="space-y-5">
      {/* ── Kopf: DB-Name + Sperren ── */}
      <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <span aria-hidden className="text-2xl">🛢️</span>
            <div>
              <h2 className="font-black text-lg text-[#1a1a1a] dark:text-[#e4e6eb] break-all">
                Datenbank: {overview.isLoading ? "…" : overview.data?.dbName ?? "—"}
              </h2>
              <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
                {overview.isLoading
                  ? "Tabellen werden gezählt…"
                  : overview.data
                  ? `${nf.format(overview.data.totalTables)} Tabellen, ${nf.format(overview.data.totalRows)} Zeilen gesamt`
                  : "—"}
              </p>
            </div>
          </div>
          <button
            onClick={onLock}
            disabled={lockPending}
            className="min-h-[44px] px-4 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-sm font-semibold text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#008BD2]"
          >
            🔒 Sperren
          </button>
        </div>
      </div>

      {/* ── Tab-Navigation ── */}
      <div role="tablist" aria-label="Datenbank-Ansicht" className="flex gap-1 p-1 rounded-xl bg-[#f0f2f5] dark:bg-[#18191a] border border-[#ced4da] dark:border-[#3e4042]">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              id={`db-tab-${t.id}`}
              aria-selected={active}
              aria-controls={`db-panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-2 min-h-[56px] px-4 rounded-lg text-sm font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-[#008BD2] ${
                active
                  ? "text-white shadow-sm"
                  : "text-[#65676b] dark:text-[#b0b3b8] hover:bg-white/60 dark:hover:bg-[#242526]/60"
              }`}
              style={active ? { background: "#202F61" } : undefined}
            >
              <span aria-hidden>{t.icon}</span> {t.label}
            </button>
          );
        })}
      </div>

      {/* ── Tab-Inhalt ── */}
      {tab === "uebersicht" ? (
        <div role="tabpanel" id="db-panel-uebersicht" aria-labelledby="db-tab-uebersicht">
          <UebersichtTab />
        </div>
      ) : (
        <div role="tabpanel" id="db-panel-verknuepfungen" aria-labelledby="db-tab-verknuepfungen">
          <VerknuepfungenTab />
        </div>
      )}
    </div>
  );
}

// ── Übersicht: DB-Name + sortierbare Tabellenliste mit exakten Zeilenzahlen ──

type SortKey   = "name" | "rows";
type SortOrder = "asc" | "desc";

const nf = new Intl.NumberFormat("de-DE");

function UebersichtTab() {
  // Teilt sich den React-Query-Cache mit dem Kopf im Container (gleicher Key).
  const overview = api.datenbank.overview.useQuery(undefined, { staleTime: 30_000 });

  const [sortKey,   setSortKey]   = useState<SortKey>("rows");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortOrder(key === "name" ? "asc" : "desc");
    }
  }

  const sorted = useMemo(() => {
    const rows = [...(overview.data?.tables ?? [])];
    rows.sort((a, b) => {
      const cmp =
        sortKey === "name"
          ? a.name.localeCompare(b.name, "de", { sensitivity: "base" })
          : a.rows - b.rows;
      return sortOrder === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [overview.data, sortKey, sortOrder]);

  return (
    <div className="space-y-5">
      {/* ── Zustände ── */}
      {overview.isLoading ? (
        <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-10 flex flex-col items-center gap-3 text-[#65676b] dark:text-[#b0b3b8]">
          <span aria-hidden className="text-3xl animate-pulse">⏳</span>
          <p className="text-sm font-semibold">Tabellen werden geladen…</p>
        </div>
      ) : overview.isError ? (
        <div
          role="alert"
          className="bg-white dark:bg-[#242526] rounded-2xl border border-[#fa3e3e]/30 shadow-sm p-6 sm:p-8"
        >
          <div className="flex items-start gap-3">
            <span aria-hidden className="text-2xl">⚠️</span>
            <div className="space-y-3">
              <div>
                <h3 className="font-black text-[#b91c1c] dark:text-[#fca5a5]">Übersicht konnte nicht geladen werden</h3>
                <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
                  {overview.error.message || "Unbekannter Fehler."}
                </p>
              </div>
              <button
                onClick={() => overview.refetch()}
                className="min-h-[44px] px-4 rounded-lg text-white text-sm font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#008BD2] dark:focus:ring-offset-[#242526]"
                style={{ background: "#008BD2" }}
              >
                Erneut versuchen
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* ── Tabellenliste ── */
        <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm overflow-hidden">
          <table className="w-full text-left border-collapse">
            <caption className="sr-only">Alle Tabellen der Datenbank mit exakter Zeilenzahl</caption>
            <thead>
              <tr className="border-b border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a]">
                <SortHeader label="Name"   col="name" sortKey={sortKey} sortOrder={sortOrder} onSort={toggleSort} align="left" />
                <SortHeader label="Zeilen" col="rows" sortKey={sortKey} sortOrder={sortOrder} onSort={toggleSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-4 py-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">
                    Keine Tabellen gefunden.
                  </td>
                </tr>
              ) : (
                sorted.map((t) => (
                  <tr
                    key={t.name}
                    className="border-b border-[#ced4da]/60 dark:border-[#3e4042]/60 last:border-0 hover:bg-[#f0f2f5]/60 dark:hover:bg-[#18191a]/60 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-sm text-[#1a1a1a] dark:text-[#e4e6eb] break-all">
                      {t.name}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-sm font-semibold text-[#1a1a1a] dark:text-[#e4e6eb] whitespace-nowrap">
                      {nf.format(t.rows)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SortHeader({
  label, col, sortKey, sortOrder, onSort, align,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortOrder: SortOrder;
  onSort: (k: SortKey) => void;
  align: "left" | "right";
}) {
  const active = sortKey === col;
  return (
    <th
      scope="col"
      aria-sort={active ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
      className={align === "right" ? "text-right" : "text-left"}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`flex items-center gap-1.5 w-full min-h-[56px] px-4 text-xs font-bold uppercase tracking-wider transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#008BD2] ${
          align === "right" ? "justify-end" : "justify-start"
        } ${active ? "text-[#202F61] dark:text-[#008BD2]" : "text-[#65676b] dark:text-[#b0b3b8] hover:text-[#202F61] dark:hover:text-[#008BD2]"}`}
      >
        {label}
        <span aria-hidden className="text-[10px]">
          {active ? (sortOrder === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

// ── Tab "Verknüpfungen": Relations-Liste + Kompatibilitäts-Fokus-Diagramm ─────

type RelData     = RouterOutputs["datenbank"]["relations"];
type Relation    = RelData["relations"][number];
type Cardinality = Relation["cardinality"];

const CLUSTER_CENTER = "Kompatibilitaet";

/** Lesbare linke/rechte Seite einer Relation: "Tabelle.feld" bzw. nur "Tabelle". */
function relSeiten(r: Relation): { left: string; right: string } {
  return {
    left:  r.fromFields.length ? `${r.from}.${r.fromFields.join(", ")}` : r.from,
    right: r.toFields.length   ? `${r.to}.${r.toFields.join(", ")}`     : r.to,
  };
}

/**
 * Kompatibilitäts-Cluster: Kompatibilitaet + alle direkt (1 Hop) per DMMF
 * verbundenen Tabellen, plus die Endpunkte der logischen Soft-Verknüpfung.
 * Kanten = alle (DMMF- + Soft-)Relationen, deren beide Enden im Cluster liegen.
 * Es wird nur das verwendet, was die relations-Daten tatsächlich liefern.
 */
function baueCluster(relations: Relation[]): { nodes: string[]; edges: Relation[] } {
  const nodes = new Set<string>([CLUSTER_CENTER]);
  for (const r of relations) {
    if (r.soft) continue;
    if (r.from === CLUSTER_CENTER) nodes.add(r.to);
    if (r.to === CLUSTER_CENTER)   nodes.add(r.from);
  }
  for (const r of relations) {
    if (r.soft) { nodes.add(r.from); nodes.add(r.to); }
  }
  const edges = relations.filter((r) => nodes.has(r.from) && nodes.has(r.to));
  return { nodes: [...nodes], edges };
}

/** Mermaid-Symbol für eine Kardinalität (gestrichelt `..` für Soft-Links). */
function mermaidSymbol(card: Cardinality, soft: boolean): string {
  const l = soft ? ".." : "--";
  switch (card) {
    case "1:n": return `||${l}o{`;
    case "n:1": return `}o${l}||`;
    case "1:1": return `||${l}||`;
    case "n:m": return `}o${l}o{`;
  }
}

/** Erzeugt den Mermaid-erDiagram-String aus den Cluster-Kanten. */
function baueMermaid(edges: Relation[]): string {
  const zeilen = ["erDiagram"];
  for (const e of edges) {
    const sym   = mermaidSymbol(e.cardinality, !!e.soft);
    const label = e.soft ? "String-Match (kein FK)" : (e.toFields[0] ?? e.relationName);
    zeilen.push(`  ${e.from} ${sym} ${e.to} : "${label}"`);
  }
  return zeilen.join("\n");
}

function VerknuepfungenTab() {
  const rel = api.datenbank.relations.useQuery(undefined, { staleTime: 60_000 });

  // Relationen je Quell-Tabelle gruppieren (für die Text-Liste).
  const gruppen = useMemo(() => {
    const map = new Map<string, Relation[]>();
    for (const r of rel.data?.relations ?? []) {
      const arr = map.get(r.from) ?? [];
      arr.push(r);
      map.set(r.from, arr);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rel.data]);

  const mermaidCode = useMemo(() => {
    if (!rel.data) return "";
    return baueMermaid(baueCluster(rel.data.relations).edges);
  }, [rel.data]);

  if (rel.isLoading) {
    return (
      <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-10 flex flex-col items-center gap-3 text-[#65676b] dark:text-[#b0b3b8]">
        <span aria-hidden className="text-3xl animate-pulse">⏳</span>
        <p className="text-sm font-semibold">Verknüpfungen werden geladen…</p>
      </div>
    );
  }

  if (rel.isError) {
    return (
      <div role="alert" className="bg-white dark:bg-[#242526] rounded-2xl border border-[#fa3e3e]/30 shadow-sm p-6 sm:p-8">
        <div className="flex items-start gap-3">
          <span aria-hidden className="text-2xl">⚠️</span>
          <div className="space-y-3">
            <div>
              <h3 className="font-black text-[#b91c1c] dark:text-[#fca5a5]">Verknüpfungen konnten nicht geladen werden</h3>
              <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">{rel.error.message || "Unbekannter Fehler."}</p>
            </div>
            <button
              onClick={() => rel.refetch()}
              className="min-h-[44px] px-4 rounded-lg text-white text-sm font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#008BD2] dark:focus:ring-offset-[#242526]"
              style={{ background: "#008BD2" }}
            >
              Erneut versuchen
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Relations-Liste (Text-Alternative zum Diagramm) ── */}
      <section className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-5 sm:p-6">
        <h3 className="font-black text-base text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Verknüpfungen</h3>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mb-4">
          Aus dem Prisma-Datenmodell abgeleitet, gruppiert je Tabelle. Gestrichelt = logische
          Verknüpfung ohne Fremdschlüssel.
        </p>

        <ul className="space-y-5">
          {gruppen.map(([tabelle, rels]) => (
            <li key={tabelle}>
              <h4 className="font-mono text-sm font-bold text-[#202F61] dark:text-[#008BD2] mb-2 break-all">{tabelle}</h4>
              <ul className="space-y-1.5">
                {rels.map((r) => {
                  const { left, right } = relSeiten(r);
                  return (
                    <li
                      key={r.relationName}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[#1a1a1a] dark:text-[#e4e6eb] leading-relaxed"
                    >
                      <span className="font-mono break-all">{left}</span>
                      <span
                        className={`font-mono font-bold whitespace-nowrap ${
                          r.soft ? "text-[#f7b928]" : "text-[#008BD2]"
                        }`}
                        aria-label={r.soft ? `logisch ${r.cardinality} zu` : `${r.cardinality} zu`}
                      >
                        {r.soft ? "╌╌" : "──"}{r.cardinality}{r.soft ? "╌╌▷" : "──▶"}
                      </span>
                      <span className="font-mono break-all">{right}</span>
                      {r.soft && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#f7b928]/15 text-[#9a7b0a] dark:text-[#f7b928] border border-[#f7b928]/30">
                          ⚠ logisch · kein FK
                        </span>
                      )}
                      {r.soft && r.note && (
                        <span className="sr-only">{r.note}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Fokus-Diagramm: Kompatibilität ── */}
      <figure className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-5 sm:p-6 m-0">
        <figcaption className="mb-4">
          <h3 className="font-black text-base text-[#1a1a1a] dark:text-[#e4e6eb]">Fokus-Diagramm: Kompatibilität</h3>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
            Der Kompatibilitäts-Cluster und die direkt verbundenen Tabellen. Die gestrichelte
            Kante ist eine logische Verknüpfung (String-Match, kein Fremdschlüssel). Eine
            barrierefreie Text-Fassung steht oben in der Liste.
          </p>
        </figcaption>
        <MermaidDiagram code={mermaidCode} />
      </figure>
    </div>
  );
}

/**
 * Rendert einen Mermaid-erDiagram-String clientseitig. mermaid wird dynamisch
 * (browser-only) importiert, das Theme folgt dem Light/Dark-Modus (class auf
 * <html>) und wird per MutationObserver live aktualisiert.
 */
function MermaidDiagram({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [dark,  setDark]  = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  // Theme erkennen + auf Klassenwechsel an <html> reagieren.
  useEffect(() => {
    const lies = () => setDark(document.documentElement.classList.contains("dark"));
    lies();
    const obs = new MutationObserver(lies);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  // Bei Code- oder Theme-Wechsel neu rendern.
  useEffect(() => {
    if (!code) return;
    let abgebrochen = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad:   false,
          securityLevel: "strict",
          theme:         dark ? "dark" : "default",
          fontFamily:    "Ubuntu, sans-serif",
        });
        const id = "db-er-" + Math.random().toString(36).slice(2);
        const { svg } = await mermaid.render(id, code);
        if (!abgebrochen && ref.current) {
          ref.current.innerHTML = svg;
          setFehler(null);
        }
      } catch (e) {
        if (!abgebrochen) setFehler(e instanceof Error ? e.message : "Diagramm konnte nicht gerendert werden.");
      }
    })();
    return () => { abgebrochen = true; };
  }, [code, dark]);

  if (fehler) {
    return (
      <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
        Diagramm konnte nicht gerendert werden ({fehler}). Die Verknüpfungen stehen oben als Liste.
      </p>
    );
  }

  return (
    <div
      ref={ref}
      role="img"
      aria-label="Entity-Relationship-Diagramm des Kompatibilitäts-Clusters. Die vollständige Beschreibung steht in der Verknüpfungs-Liste darüber."
      className="overflow-x-auto flex justify-center [&_svg]:max-w-full [&_svg]:h-auto"
    />
  );
}

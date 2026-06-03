"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import { keepPreviousData } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { api } from "@/trpc/react";
import type { AppRouter } from "@/server/routers";
import { PageLoader } from "@/components/ui/LoadingSpinner";
import { Modal } from "@/components/ui/Modal";
import { useNow } from "@/hooks/useNow";

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

type Tab = "uebersicht" | "verknuepfungen" | "inhalt";

function DatenbankInhalt({ onLock, lockPending }: { onLock: () => void; lockPending: boolean }) {
  const overview = api.datenbank.overview.useQuery(undefined, { staleTime: 30_000 });
  const [tab, setTab]           = useState<Tab>("uebersicht");
  const [tabelle, setTabelle]   = useState<string | null>(null);

  // Tabellenname in der Übersicht angeklickt → Inhalt-Tab vorausgewählt öffnen.
  function oeffneTabelle(name: string) {
    setTabelle(name);
    setTab("inhalt");
  }

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "uebersicht",     label: "Übersicht",      icon: "📋" },
    { id: "verknuepfungen", label: "Verknüpfungen",  icon: "🔗" },
    { id: "inhalt",         label: "Tabellen-Inhalt", icon: "🗂️" },
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
      {tab === "uebersicht" && (
        <div role="tabpanel" id="db-panel-uebersicht" aria-labelledby="db-tab-uebersicht">
          <UebersichtTab onOpenTable={oeffneTabelle} />
        </div>
      )}
      {tab === "verknuepfungen" && (
        <div role="tabpanel" id="db-panel-verknuepfungen" aria-labelledby="db-tab-verknuepfungen">
          <VerknuepfungenTab />
        </div>
      )}
      {tab === "inhalt" && (
        <div role="tabpanel" id="db-panel-inhalt" aria-labelledby="db-tab-inhalt">
          <InhaltTab table={tabelle} onTableChange={setTabelle} />
        </div>
      )}
    </div>
  );
}

// ── Übersicht: DB-Name + sortierbare Tabellenliste mit exakten Zeilenzahlen ──

type SortKey   = "name" | "rows";
type SortOrder = "asc" | "desc";

const nf = new Intl.NumberFormat("de-DE");

function UebersichtTab({ onOpenTable }: { onOpenTable: (name: string) => void }) {
  // Teilt sich den React-Query-Cache mit dem Kopf im Container (gleicher Key).
  const overview = api.datenbank.overview.useQuery(undefined, { staleTime: 30_000 });

  const [sortKey,   setSortKey]   = useState<SortKey>("rows");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  function toggleSort(key: string) {
    if (key === sortKey) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key as SortKey);
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
                    <td className="px-2 py-1">
                      <button
                        type="button"
                        onClick={() => onOpenTable(t.name)}
                        title={`Inhalt von „${t.name}" anzeigen`}
                        className="flex items-center gap-2 w-full min-h-[44px] px-2 rounded-lg font-mono text-sm text-left text-[#008BD2] hover:underline hover:bg-[#008BD2]/10 break-all transition-colors focus:outline-none focus:ring-2 focus:ring-[#008BD2]"
                      >
                        <span aria-hidden className="text-xs opacity-70">🗂️</span>
                        {t.name}
                      </button>
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
  label, col, sortKey, sortOrder, onSort, align, sub, badge, sticky, preserveCase,
}: {
  label: string;
  col: string;
  sortKey: string | null;
  sortOrder: SortOrder;
  onSort: (k: string) => void;
  align: "left" | "right";
  sub?: string;                 // z.B. Spaltentyp (klein, unter dem Namen)
  badge?: React.ReactNode;      // z.B. PK-Markierung
  sticky?: boolean;             // klebender Header (Daten-Grid)
  preserveCase?: boolean;       // Spaltennamen sind case-sensitive → nicht großschreiben
}) {
  const active = sortKey === col;
  return (
    <th
      scope="col"
      aria-sort={active ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
      className={`${align === "right" ? "text-right" : "text-left"} ${
        sticky ? "sticky top-0 z-10 bg-[#f0f2f5] dark:bg-[#18191a] border-b border-[#ced4da] dark:border-[#3e4042]" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`flex flex-col justify-center w-full min-h-[56px] py-2 px-4 text-xs font-bold tracking-wider transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#008BD2] ${
          preserveCase ? "" : "uppercase"
        } ${align === "right" ? "items-end" : "items-start"} ${
          active ? "text-[#202F61] dark:text-[#008BD2]" : "text-[#65676b] dark:text-[#b0b3b8] hover:text-[#202F61] dark:hover:text-[#008BD2]"
        }`}
      >
        <span className="flex items-center gap-1.5">
          {badge}
          <span className="break-all">{label}</span>
          <span aria-hidden className="text-[10px]">
            {active ? (sortOrder === "asc" ? "▲" : "▼") : "↕"}
          </span>
        </span>
        {sub && <span className="text-[10px] font-medium normal-case tracking-normal opacity-60 mt-0.5">{sub}</span>}
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

/**
 * Erklär-Panel in einfacher Sprache für Nicht-Techniker. Standardmäßig
 * aufgeklappt, per Button einklappbar (aria-expanded steuert den Inhalt).
 */
function ErklaerPanel() {
  const [offen, setOffen] = useState(true);

  return (
    <section className="rounded-2xl border-2 border-[#008BD2]/40 bg-[#008BD2]/[0.06] dark:bg-[#008BD2]/[0.08] shadow-sm overflow-hidden">
      {/* Kopf / Einklapp-Button (56px Touch-Target) */}
      <h3 className="m-0">
        <button
          type="button"
          onClick={() => setOffen((o) => !o)}
          aria-expanded={offen}
          aria-controls="db-erklaer-inhalt"
          className="flex items-center gap-3 w-full min-h-[56px] px-5 sm:px-6 text-left transition-colors hover:bg-[#008BD2]/10 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#008BD2]"
        >
          <span
            aria-hidden
            className="flex items-center justify-center w-9 h-9 rounded-lg text-white text-lg flex-shrink-0"
            style={{ background: "#008BD2" }}
          >
            💡
          </span>
          <span className="flex-1 font-black text-base sm:text-lg text-[#202F61] dark:text-[#e4e6eb]">
            Was bedeuten diese Verknüpfungen?
          </span>
          <span
            aria-hidden
            className={`text-[#008BD2] text-xl flex-shrink-0 transition-transform duration-200 ${offen ? "rotate-180" : ""}`}
          >
            ⌄
          </span>
        </button>
      </h3>

      {offen && (
        <div
          id="db-erklaer-inhalt"
          className="px-5 sm:px-6 pb-6 pt-1 max-w-[68ch] space-y-6 text-[15px] leading-relaxed text-[#1a1a1a] dark:text-[#e4e6eb]"
        >
          <div className="space-y-3">
            <p>Diese Seite zeigt, wie die Daten im System zusammenhängen.</p>
            <p>Eine Tabelle ist wie ein Blatt in einer Excel-Datei. Jede Tabelle speichert eine Art von Information.</p>
            <p>Eine Verknüpfung (die Pfeile) zeigt: Diese zwei Tabellen gehören zusammen.</p>
          </div>

          <div className="space-y-3">
            <h4 className="font-black text-base text-[#202F61] dark:text-[#008BD2]">Das Wichtigste: die Kompatibilität</h4>
            <p>Kompatibilität bedeutet: Welches Ersatzteil passt zu welchem Gerät?</p>
            <p>Ein Beispiel:</p>
            <ol className="list-decimal pl-6 space-y-1.5 marker:font-bold marker:text-[#008BD2]">
              <li>Ein Gerät ist zum Beispiel der Laptop „HP EliteBook 840".</li>
              <li>Dieser Laptop braucht Ersatzteile: einen Akku, ein Display, eine Tastatur.</li>
              <li>Die Tabelle Kompatibilitaet speichert: Dieser Akku passt zu diesem Laptop.</li>
            </ol>
            <p>So weiß das System immer, welches Teil zu welchem Gerät gehört.</p>
          </div>

          <div className="space-y-3">
            <h4 className="font-black text-base text-[#202F61] dark:text-[#008BD2]">Die Tabellen einfach erklärt</h4>
            <ul className="space-y-2">
              <li className="flex gap-2"><span aria-hidden className="text-[#008BD2] font-bold">•</span><span><span className="font-mono font-semibold">GeraeteModell</span> — die Geräte-Modelle. Zum Beispiel ein bestimmter Laptop-Typ.</span></li>
              <li className="flex gap-2"><span aria-hidden className="text-[#008BD2] font-bold">•</span><span><span className="font-mono font-semibold">Artikel</span> — die einzelnen Ersatzteile im Lager.</span></li>
              <li className="flex gap-2"><span aria-hidden className="text-[#008BD2] font-bold">•</span><span><span className="font-mono font-semibold">Kompatibilitaet</span> — die Verbindung: Welches Ersatzteil passt zu welchem Modell.</span></li>
              <li className="flex gap-2"><span aria-hidden className="text-[#008BD2] font-bold">•</span><span><span className="font-mono font-semibold">lagerplatz / LagerplatzBelegung</span> — der Ort: Wo liegt ein Teil im Lager?</span></li>
              <li className="flex gap-2"><span aria-hidden className="text-[#008BD2] font-bold">•</span><span><span className="font-mono font-semibold">Anfrage</span> — die Anfrage von einem Techniker: „Ich brauche ein Teil für dieses Gerät."</span></li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="font-black text-base text-[#202F61] dark:text-[#008BD2]">Was bedeuten die Pfeile?</h4>
            <ul className="space-y-2">
              <li className="flex gap-2"><span aria-hidden className="text-[#008BD2] font-bold">•</span><span><span className="font-mono font-semibold">1:n</span> — Eins zu viele. Ein Gerät kann viele Ersatzteile haben.</span></li>
              <li className="flex gap-2"><span aria-hidden className="text-[#008BD2] font-bold">•</span><span><span className="font-mono font-semibold">n:m</span> — Viele zu viele. Viele Geräte und viele Teile passen zusammen.</span></li>
              <li className="flex gap-2"><span aria-hidden className="text-[#008BD2] font-bold">•</span><span><span className="font-mono font-semibold">1:1</span> — Eins zu eins. Genau ein Teil gehört zu genau einer Sache.</span></li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="font-black text-base text-[#202F61] dark:text-[#008BD2]">Die gestrichelte Linie (wichtig!)</h4>
            <p>Die Anfrage ist mit dem Gerät nur über den Namen verbunden — nicht über eine feste Nummer.</p>
            <p>Das heißt: Wenn ein Name anders geschrieben ist, findet das System die Verbindung vielleicht nicht.</p>
            <p>Eine feste Verbindung über eine Nummer wäre sicherer.</p>
          </div>
        </div>
      )}
    </section>
  );
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
      {/* ── Erklär-Panel für Nicht-Techniker ── */}
      <ErklaerPanel />

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

// ── Tab "Tabellen-Inhalt": read-only Datensätze, paginiert, mit Suche ─────────

type PageSize = 25 | 50 | 100;
const PAGE_SIZES: PageSize[] = [25, 50, 100];

const LIVE_INTERVALS: { ms: number; label: string }[] = [
  { ms: 5_000,  label: "5s"  },
  { ms: 10_000, label: "10s" },
  { ms: 30_000, label: "30s" },
];

/** "vor X Sek." / "vor Y Min. Z Sek." aus Sekunden. */
function relativeZeit(sek: number): string {
  if (sek < 60) return `vor ${sek} Sek.`;
  const min = Math.floor(sek / 60);
  const rest = sek % 60;
  return `vor ${min} Min. ${rest} Sek.`;
}

/**
 * "Zuletzt aktualisiert vor X Sek." — tickt jede Sekunde über useNow. Eigene
 * Komponente, damit nur dieser Text neu rendert (nicht das ganze Grid). Bewusst
 * KEINE aria-live-Region (sonst Screenreader-Spam).
 */
function LiveStatus({ updatedAt, isFetching }: { updatedAt: number; isFetching: boolean }) {
  const now = useNow(1_000);
  if (!updatedAt) return null;
  const sek = Math.max(0, Math.round((now - updatedAt) / 1000));
  return (
    <span className="text-xs text-[#65676b] dark:text-[#b0b3b8] tabular-nums">
      {isFetching ? "Aktualisiere…" : `Zuletzt aktualisiert ${relativeZeit(sek)}`}
    </span>
  );
}

/** Eine Zelle: NULL abgesetzt; lange Werte gekürzt mit Titel + Klick zum Aufklappen. */
function DatenZelle({ value }: { value: string | null }) {
  const [offen, setOffen] = useState(false);

  if (value === null) {
    return <span className="italic text-[#9ca3af] dark:text-[#6b7280] select-none">NULL</span>;
  }
  if (value === "") {
    return <span className="italic text-[#9ca3af] dark:text-[#6b7280] select-none">(leer)</span>;
  }

  const lang = value.length > 80;
  if (!lang) return <span className="whitespace-pre-wrap break-words">{value}</span>;

  return (
    <button
      type="button"
      onClick={() => setOffen((o) => !o)}
      title={offen ? "Einklappen" : value}
      aria-expanded={offen}
      className="text-left align-top text-[#1a1a1a] dark:text-[#e4e6eb] hover:text-[#008BD2] transition-colors focus:outline-none focus:ring-2 focus:ring-[#008BD2] rounded"
    >
      <span className={offen ? "whitespace-pre-wrap break-words" : "block max-w-[26rem] truncate"}>
        {value}
      </span>
      <span aria-hidden className="text-[10px] text-[#008BD2] font-bold">{offen ? " ▲ weniger" : " … mehr"}</span>
    </button>
  );
}

function InhaltTab({ table, onTableChange }: { table: string | null; onTableChange: (t: string | null) => void }) {
  // Tabellen-Dropdown teilt sich den Cache mit der Übersicht.
  const overview = api.datenbank.overview.useQuery(undefined, { staleTime: 30_000 });
  const tabellen = useMemo(
    () => [...(overview.data?.tables ?? [])].map((t) => t.name).sort((a, b) => a.localeCompare(b)),
    [overview.data],
  );

  const [search, setSearch]         = useState("");
  const [debounced]                 = useDebounce(search, 300);
  const [page, setPage]             = useState(1);
  const [pageSize, setPageSize]     = useState<PageSize>(50);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDir, setSortDir]       = useState<SortOrder>("asc");

  // Live-Aktualisierung — Default AN, bleibt über Tabellenwechsel hinweg erhalten.
  const [live, setLive]             = useState(true);
  const [intervalMs, setIntervalMs] = useState(5_000);

  // Artikel-Kompatibilität: geöffnete Artikel-id (nur Tabelle "Artikel").
  const [kompatId, setKompatId] = useState<number | null>(null);

  const istArtikel = table === "Artikel";

  // Tabellenwechsel → Such-/Sortier-/Seitenzustand + offenes Kompat-Modal zurücksetzen.
  useEffect(() => {
    setSearch("");
    setSortColumn(null);
    setSortDir("asc");
    setPage(1);
    setKompatId(null);
  }, [table]);

  // Suche/Seitengröße/Sortierung ändern → zurück auf Seite 1.
  useEffect(() => { setPage(1); }, [debounced, pageSize, sortColumn, sortDir]);

  const q = api.datenbank.tableRows.useQuery(
    {
      table:      table ?? "",
      page,
      pageSize,
      search:     debounced.trim() || undefined,
      sortColumn: sortColumn ?? undefined,
      sortDir,
    },
    {
      enabled:                     !!table,
      staleTime:                   10_000,
      placeholderData:             keepPreviousData,
      // Polling nur bei gewählter Tabelle & Live AN; pausiert im Hintergrund.
      refetchInterval:             live && !!table ? intervalMs : false,
      refetchIntervalInBackground: false,
    },
  );

  function onSort(colName: string) {
    if (sortColumn === colName) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(colName);
      setSortDir("asc");
    }
  }

  const data       = q.data;
  const total      = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const sucheAktiv = debounced.trim().length > 0;

  // ── Live-Flash: geänderte/neue Zeilen ~1s aufblitzen ──────────────────────
  // Baseline = vorheriger Datenstand des SELBEN Views, je PK serialisiert.
  const baselineRef = useRef<Map<string, string> | null>(null);
  const [flashPks, setFlashPks] = useState<Set<string>>(new Set());
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // View-Wechsel (Tabelle/Seite/Größe/Suche/Sortierung) → Baseline verwerfen.
  // Der nächste Datenstand wird zur neuen Baseline (blitzt NICHT).
  useEffect(() => {
    baselineRef.current = null;
    setFlashPks(new Set());
  }, [table, page, pageSize, debounced, sortColumn, sortDir]);

  // Bei jeder erfolgreichen (Re-)Abfrage gegen die Baseline diffen.
  useEffect(() => {
    const d = q.data;
    if (!d) return;
    const pk = d.primaryKey;

    // Ohne Primärschlüssel kein verlässlicher Diff → stilles Update.
    if (!pk) { baselineRef.current = null; return; }

    const aktuell = new Map<string, string>();
    for (const row of d.rows) {
      const id = row[pk];
      if (id === null || id === undefined) continue;
      aktuell.set(id, JSON.stringify(row));
    }

    const baseline = baselineRef.current;
    baselineRef.current = aktuell;

    // Erster Stand nach einem Reset = Baseline, nichts blitzt.
    if (!baseline) return;

    const geaendert = new Set<string>();
    for (const [id, ser] of aktuell) {
      const alt = baseline.get(id);
      if (alt === undefined || alt !== ser) geaendert.add(id); // neu ODER inhaltlich verändert
    }

    if (geaendert.size > 0) {
      setFlashPks(geaendert);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashPks(new Set()), 1_100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.dataUpdatedAt]);

  // Timer beim Unmount aufräumen.
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  return (
    <div className="space-y-4">
      {/* ── Steuerleiste: Tabellen-Auswahl + Suche ── */}
      <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-5 sm:p-6 space-y-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          {/* Tabelle */}
          <div>
            <label htmlFor="db-tabelle" className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1.5 uppercase tracking-wider">
              Tabelle
            </label>
            <select
              id="db-tabelle"
              value={table ?? ""}
              onChange={(e) => onTableChange(e.target.value || null)}
              className="w-full min-h-[56px] px-4 rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] text-base outline-none focus:border-[#008BD2] focus:ring-2 focus:ring-[#008BD2]/40 transition-colors"
            >
              <option value="">{overview.isLoading ? "Tabellen werden geladen…" : "— Tabelle wählen —"}</option>
              {tabellen.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>

          {/* Suche */}
          <div>
            <label htmlFor="db-suche" className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1.5 uppercase tracking-wider">
              Suche (alle Spalten)
            </label>
            <div className="relative">
              <span aria-hidden className="absolute left-4 top-1/2 -translate-y-1/2 text-[#65676b] dark:text-[#b0b3b8]">🔍</span>
              <input
                id="db-suche"
                type="text"
                value={search}
                disabled={!table}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={table ? "Werte durchsuchen…" : "Erst eine Tabelle wählen"}
                className="w-full min-h-[56px] pl-11 pr-4 rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] text-base outline-none focus:border-[#008BD2] focus:ring-2 focus:ring-[#008BD2]/40 transition-colors disabled:opacity-50"
              />
            </div>
          </div>
        </div>

        {table && data && (
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]" aria-live="polite">
            {sucheAktiv
              ? `${nf.format(total)} Treffer für „${debounced.trim()}" in `
              : `${nf.format(total)} Zeilen in `}
            <span className="font-mono font-semibold text-[#202F61] dark:text-[#008BD2]">{table}</span>
            {data.columns.length > 0 && <> · {data.columns.length} Spalten</>}
          </p>
        )}

        {/* ── Live-Aktualisierung ── */}
        {table && (
          <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t border-[#ced4da]/60 dark:border-[#3e4042]/60">
            <div className="flex items-center gap-3 flex-wrap">
              {/* Live-Schalter */}
              <button
                type="button"
                role="switch"
                aria-checked={live}
                onClick={() => setLive((l) => !l)}
                className="inline-flex items-center gap-2.5 min-h-[56px] px-2 rounded-lg transition-colors hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] focus:outline-none focus:ring-2 focus:ring-[#008BD2]"
              >
                <span
                  aria-hidden
                  className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${live ? "bg-[#008BD2]" : "bg-[#ced4da] dark:bg-[#3e4042]"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${live ? "translate-x-5" : ""}`} />
                </span>
                <span className="text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
                  Live {live ? "AN" : "AUS"}
                </span>
              </button>

              {/* Intervall-Auswahl (nur bei Live AN) */}
              {live && (
                <div role="group" aria-label="Aktualisierungs-Intervall" className="flex items-center gap-1 p-1 rounded-lg bg-[#f0f2f5] dark:bg-[#18191a] border border-[#ced4da] dark:border-[#3e4042]">
                  {LIVE_INTERVALS.map((opt) => {
                    const aktiv = intervalMs === opt.ms;
                    return (
                      <button
                        key={opt.ms}
                        type="button"
                        aria-pressed={aktiv}
                        onClick={() => setIntervalMs(opt.ms)}
                        className={`min-h-[44px] px-3 rounded-md text-sm font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-[#008BD2] ${
                          aktiv ? "text-white shadow-sm" : "text-[#65676b] dark:text-[#b0b3b8] hover:text-[#202F61] dark:hover:text-[#008BD2]"
                        }`}
                        style={aktiv ? { background: "#008BD2" } : undefined}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <LiveStatus updatedAt={q.dataUpdatedAt} isFetching={q.isFetching} />
              <button
                type="button"
                onClick={() => q.refetch()}
                disabled={q.isFetching}
                className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-sm font-bold text-[#202F61] dark:text-[#e4e6eb] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#008BD2]"
              >
                <span aria-hidden className={q.isFetching ? "animate-spin" : ""}>🔄</span> Aktualisieren
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Zustände + Daten-Grid ── */}
      {!table ? (
        <div className="bg-white dark:bg-[#242526] rounded-2xl border border-dashed border-[#ced4da] dark:border-[#3e4042] p-10 flex flex-col items-center gap-3 text-center text-[#65676b] dark:text-[#b0b3b8]">
          <span aria-hidden className="text-3xl">🗂️</span>
          <p className="text-sm font-semibold">Bitte oben eine Tabelle wählen, um ihren Inhalt anzuzeigen.</p>
        </div>
      ) : q.isLoading ? (
        <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-10 flex flex-col items-center gap-3 text-[#65676b] dark:text-[#b0b3b8]">
          <span aria-hidden className="text-3xl animate-pulse">⏳</span>
          <p className="text-sm font-semibold">Daten werden geladen…</p>
        </div>
      ) : q.isError ? (
        <div role="alert" className="bg-white dark:bg-[#242526] rounded-2xl border border-[#fa3e3e]/30 shadow-sm p-6 sm:p-8">
          <div className="flex items-start gap-3">
            <span aria-hidden className="text-2xl">⚠️</span>
            <div className="space-y-3">
              <div>
                <h3 className="font-black text-[#b91c1c] dark:text-[#fca5a5]">Daten konnten nicht geladen werden</h3>
                <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">{q.error.message || "Unbekannter Fehler."}</p>
              </div>
              <button
                onClick={() => q.refetch()}
                className="min-h-[44px] px-4 rounded-lg text-white text-sm font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#008BD2] dark:focus:ring-offset-[#242526]"
                style={{ background: "#008BD2" }}
              >
                Erneut versuchen
              </button>
            </div>
          </div>
        </div>
      ) : data && data.rows.length === 0 ? (
        <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-10 flex flex-col items-center gap-3 text-center text-[#65676b] dark:text-[#b0b3b8]">
          <span aria-hidden className="text-3xl">{sucheAktiv ? "🔍" : "📭"}</span>
          <p className="text-sm font-semibold">
            {sucheAktiv ? "Keine Treffer für die Suche." : "Diese Tabelle enthält keine Zeilen."}
          </p>
        </div>
      ) : data ? (
        <>
          {/* Daten-Grid */}
          <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm overflow-auto max-h-[70vh] relative">
            <table className="min-w-full text-left border-collapse">
              <caption className="sr-only">
                Inhalt der Tabelle {table}, Seite {page} von {totalPages}
              </caption>
              <thead>
                <tr>
                  {istArtikel && (
                    <th
                      scope="col"
                      className="sticky top-0 z-10 bg-[#f0f2f5] dark:bg-[#18191a] border-b border-[#ced4da] dark:border-[#3e4042] px-4 text-left text-xs font-bold uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8] whitespace-nowrap"
                    >
                      Kompatibilität
                    </th>
                  )}
                  {data.columns.map((c) => (
                    <SortHeader
                      key={c.name}
                      label={c.name}
                      col={c.name}
                      sortKey={sortColumn}
                      sortOrder={sortDir}
                      onSort={onSort}
                      align="left"
                      sticky
                      preserveCase
                      sub={c.type + (c.nullable ? "" : " · not null")}
                      badge={
                        c.isPrimaryKey ? (
                          <span
                            title="Primärschlüssel"
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-black text-white"
                            style={{ background: "#202F61" }}
                          >
                            PK
                          </span>
                        ) : undefined
                      }
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => {
                  const pkWert  = data.primaryKey ? row[data.primaryKey] : null;
                  const blitzen = pkWert != null && flashPks.has(pkWert);
                  const artikelId = istArtikel && pkWert != null ? Number(pkWert) : null;
                  return (
                  <tr
                    key={pkWert ?? i}
                    className={`transition-colors ${blitzen ? "db-row-flash" : "hover:bg-[#f0f2f5]/60 dark:hover:bg-[#18191a]/60"}`}
                  >
                    {istArtikel && (
                      <td className="px-2 py-1 align-top border-b border-[#ced4da]/50 dark:border-[#3e4042]/50">
                        {artikelId != null && Number.isFinite(artikelId) ? (
                          <button
                            type="button"
                            onClick={() => setKompatId(artikelId)}
                            aria-label={`Kompatibilität für Artikel ${pkWert} anzeigen`}
                            title="Kompatible Geräte anzeigen"
                            className="inline-flex items-center justify-center gap-1.5 min-h-[56px] min-w-[44px] px-3 rounded-lg text-sm font-bold text-[#008BD2] hover:bg-[#008BD2]/10 transition-colors focus:outline-none focus:ring-2 focus:ring-[#008BD2]"
                          >
                            <span aria-hidden>🔌</span>
                            <span className="hidden sm:inline">Geräte</span>
                          </button>
                        ) : (
                          <span className="text-xs text-[#9ca3af] dark:text-[#6b7280]">—</span>
                        )}
                      </td>
                    )}
                    {data.columns.map((c) => (
                      <td
                        key={c.name}
                        className="px-4 py-2.5 align-top font-mono text-sm text-[#1a1a1a] dark:text-[#e4e6eb] border-b border-[#ced4da]/50 dark:border-[#3e4042]/50"
                      >
                        <DatenZelle value={row[c.name] ?? null} />
                      </td>
                    ))}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between flex-wrap gap-3 bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-4">
            <div className="flex items-center gap-2 text-sm text-[#65676b] dark:text-[#b0b3b8]">
              <label htmlFor="db-pagesize" className="font-semibold">Pro Seite:</label>
              <select
                id="db-pagesize"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
                className="min-h-[44px] px-3 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#008BD2] focus:ring-2 focus:ring-[#008BD2]/40"
              >
                {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <p className="text-sm font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]" aria-live="polite">
              Seite {nf.format(page)} von {nf.format(totalPages)}
              <span className="text-[#65676b] dark:text-[#b0b3b8] font-normal"> · {nf.format(total)} Treffer</span>
            </p>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || q.isFetching}
                className="min-h-[44px] px-4 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-sm font-bold text-[#202F61] dark:text-[#e4e6eb] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#008BD2]"
              >
                ← Zurück
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || q.isFetching}
                className="min-h-[44px] px-4 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-sm font-bold text-[#202F61] dark:text-[#e4e6eb] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#008BD2]"
              >
                Weiter →
              </button>
            </div>
          </div>
        </>
      ) : null}

      {/* Artikel-Kompatibilität (nur Tabelle "Artikel") */}
      {kompatId != null && (
        <KompatibilitaetModal artikelId={kompatId} onClose={() => setKompatId(null)} />
      )}
    </div>
  );
}

/** Modal: mit welchen Geräten ist ein Artikel kompatibel? Read-only. */
function KompatibilitaetModal({ artikelId, onClose }: { artikelId: number; onClose: () => void }) {
  const q = api.datenbank.artikelKompatibilitaet.useQuery({ artikelId }, { staleTime: 30_000 });
  const data = q.data;

  return (
    <Modal open onClose={onClose} title="Kompatibel mit">
      {/* Kopf: Artikel + Teiltyp + Anzahl */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-bold text-white" style={{ background: "#202F61" }}>
          🔌 Artikel #{artikelId}
        </span>
        {data?.teiltyp && (
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-sm font-semibold bg-[#008BD2]/10 text-[#008BD2] border border-[#008BD2]/30">
            {data.teiltyp}
          </span>
        )}
        {data && data.anzahl > 0 && (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-[#04B475]/15 text-[#04B475] border border-[#04B475]/30">
            passt in {data.anzahl} {data.anzahl === 1 ? "Gerät" : "Geräte"}
          </span>
        )}
      </div>

      {q.isLoading ? (
        <div className="py-8 flex flex-col items-center gap-3 text-[#65676b] dark:text-[#b0b3b8]">
          <span aria-hidden className="text-2xl animate-pulse">⏳</span>
          <p className="text-sm font-semibold">Geräte werden geladen…</p>
        </div>
      ) : q.isError ? (
        <div role="alert" className="py-6 text-center space-y-3">
          <p className="text-sm text-[#b91c1c] dark:text-[#fca5a5] font-semibold">
            {q.error.message || "Kompatibilität konnte nicht geladen werden."}
          </p>
          <button
            onClick={() => q.refetch()}
            className="min-h-[44px] px-4 rounded-lg text-white text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[#008BD2]"
            style={{ background: "#008BD2" }}
          >
            Erneut versuchen
          </button>
        </div>
      ) : data && data.geraete.length === 0 ? (
        <div className="py-8 flex flex-col items-center gap-3 text-center text-[#65676b] dark:text-[#b0b3b8]">
          <span aria-hidden className="text-2xl">📭</span>
          <p className="text-sm font-semibold">Für diesen Artikel ist keine Gerätezuordnung hinterlegt.</p>
        </div>
      ) : data ? (
        <ul className="space-y-1.5 max-h-[55vh] overflow-y-auto">
          {data.geraete.map((g, idx) => (
            <li
              key={idx}
              className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[#f0f2f5] dark:bg-[#18191a] text-sm text-[#1a1a1a] dark:text-[#e4e6eb]"
            >
              <span aria-hidden className="text-[#008BD2] flex-shrink-0">📱</span>
              <span className="font-mono break-all">{g}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Modal>
  );
}

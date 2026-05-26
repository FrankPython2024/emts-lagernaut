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
import { STANDARD_TEILNAMEN } from "@/lib/constants/teiltypen";
import { getLucideIcon } from "@/lib/icons/getLucideIcon";

// ── Konstanten ────────────────────────────────────────────────────────────────

const STANDARD_TEILE = STANDARD_TEILNAMEN;

const INPUT_CLS = "px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] text-sm";

// ── Bestand-Farbe ─────────────────────────────────────────────────────────────

function bestandFarbe(n: number): string {
  if (n > 3)  return "text-[#00a400] font-bold";
  if (n > 0)  return "text-[#f7b928] font-bold";
  return "text-[#fa3e3e] font-bold";
}

function bestandLabel(n: number): string {
  if (n > 3)  return `${n} 🟢`;
  if (n > 0)  return `${n} 🟡`;
  return "0 🔴";
}

// ── Keyword-Extraktion für Suchvorschlag ──────────────────────────────────────

function extractModellKeyword(modell: string): string {
  const words = modell.split(/\s+/);
  return words.find((w) => /\d/.test(w) || (w.length <= 6 && w.length > 1)) ?? words[0] ?? "";
}

// ══════════════════════════════════════════════════════════════════════════════
// TeilSucheSection — ein Abschnitt im Verknüpfungs-Modal
// ══════════════════════════════════════════════════════════════════════════════

function TeilSucheSection({
  teiltyp, gewaehlt, modellKeyword, onChange,
}: {
  teiltyp:       string;
  gewaehlt:      number | null;
  modellKeyword: string;
  onChange:      (artikelId: number | null) => void;
}) {
  const [open,     setOpen]     = useState(gewaehlt !== null);
  const [query,    setQuery]    = useState(gewaehlt === null ? modellKeyword : "");
  const debQuery = useDebounce(query, 300);

  const suche = api.kompatibilitaet.sucheArtikelFuerTeil.useQuery(
    { query: debQuery, teiltyp, limit: 10 },
    { enabled: open },
  );

  const results = suche.data ?? [];
  const hatVorschlag = !gewaehlt && modellKeyword && debQuery === modellKeyword;

  return (
    <div className="border border-[#ced4da] dark:border-[#3e4042] rounded-xl overflow-hidden">
      {/* Abschnitt-Header */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[#f0f2f5] dark:bg-[#18191a] hover:bg-[#ced4da]/30 dark:hover:bg-[#3e4042] transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{teiltyp}</span>
          {gewaehlt !== null ? (
            <span className="text-xs text-[#00a400] font-semibold">✓ Verknüpft</span>
          ) : (
            <span className="text-xs text-[#65676b] dark:text-[#b0b3b8]">— Keine</span>
          )}
        </div>
        <span className="text-[#65676b] text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {/* Abschnitt-Body */}
      {open && (
        <div className="px-4 py-3 space-y-2 bg-white dark:bg-[#242526]">
          {/* Suchfeld */}
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`🔍 Suche in "${teiltyp}"…`}
              className={`${INPUT_CLS} w-full pr-8`}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#65676b] hover:text-[#fa3e3e] text-lg leading-none"
              >
                ×
              </button>
            )}
          </div>

          {hatVorschlag && (
            <p className="text-[10px] text-[#f7b928] font-semibold">
              💡 Vorschlag basierend auf Modellname „{modellKeyword}"
            </p>
          )}

          {/* Ergebnisse */}
          <div className="space-y-1 max-h-44 overflow-y-auto pr-0.5">
            {/* Keine Verknüpfung */}
            <label className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] cursor-pointer">
              <input
                type="radio"
                name={`teil-${teiltyp}`}
                checked={gewaehlt === null}
                onChange={() => onChange(null)}
                className="accent-[#0064d2]"
              />
              <span className="text-sm text-[#65676b] dark:text-[#b0b3b8] italic">— Keine Verknüpfung</span>
            </label>

            {suche.isLoading && (
              <div className="flex justify-center py-2">
                <div className="w-4 h-4 border-2 border-[#0064d2]/20 border-t-[#0064d2] rounded-full animate-spin" />
              </div>
            )}

            {!suche.isLoading && results.length === 0 && query && (
              <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] text-center py-2">
                Keine Artikel gefunden für „{query}"
              </p>
            )}

            {results.map((a) => (
              <label key={a.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${gewaehlt === a.id ? "bg-[#0064d2]/10 border border-[#0064d2]/30" : "hover:bg-[#f0f2f5] dark:hover:bg-[#18191a]"}`}>
                <input
                  type="radio"
                  name={`teil-${teiltyp}`}
                  checked={gewaehlt === a.id}
                  onChange={() => onChange(a.id)}
                  className="accent-[#0064d2] flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[#1a1a1a] dark:text-[#e4e6eb] truncate">{a.bezeichnung}</div>
                  <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">{a.lagerplatz ?? "—"}</div>
                </div>
                <span className={`text-xs flex-shrink-0 ${bestandFarbe(a.bestand)}`}>
                  {a.bestand}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Verknüpfungs-Modal (neu mit Suche)
// ══════════════════════════════════════════════════════════════════════════════

function VerknuepfungsModal({
  modellId, onClose, onSaved,
}: { modellId: number; onClose: () => void; onSaved: () => void }) {
  const { show } = useToast();

  const { data, isLoading, error } = api.kompatibilitaet.getModalData.useQuery({ modellId });
  const [auswahl, setAuswahl] = useState<Record<string, number | null>>({});
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (data && !initialized) {
      const init: Record<string, number | null> = {};
      for (const teil of STANDARD_TEILE) {
        // Nur bestehende Verknüpfungen vorauswählen — KEINE automatischen Vorschläge
        init[teil] = data.currentMap[teil] ?? null;
      }
      setAuswahl(init);
      setInitialized(true);
    }
  }, [data, initialized]);

  const setVerknuepfung = api.kompatibilitaet.setVerknuepfung.useMutation({
    onSuccess: (r) => {
      show(`✅ ${r.gespeichert} Verknüpfungen gespeichert`, "success");
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

  if (error) return (
    <div className="p-4 rounded-lg bg-[#fa3e3e]/10 border border-[#fa3e3e]/30 text-[#fa3e3e] text-sm">
      Kompatibilitätsdaten konnten nicht geladen werden: {error.message}
    </div>
  );

  if (isLoading || !data) return (
    <div className="flex justify-center py-8">
      <div className="w-6 h-6 border-2 border-[#0064d2]/20 border-t-[#0064d2] rounded-full animate-spin" />
    </div>
  );

  const modellKeyword = extractModellKeyword(data.geraetVoll.split(" ").slice(1).join(" "));

  return (
    <div className="space-y-4">
      {/* Info */}
      <div>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
          <strong className="text-[#1a1a1a] dark:text-[#e4e6eb]">{data.geraetVoll}</strong>
          {" · "}Suchfeld pro Teiltyp ·
          <span className="text-[#f7b928]"> 💡 = Suchvorschlag (nur Hinweis, kein Auto-Speichern)</span>
        </p>
      </div>

      {/* 13 Such-Sektionen */}
      <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
        {STANDARD_TEILE.map((teil) => (
          <TeilSucheSection
            key={teil}
            teiltyp={teil}
            gewaehlt={auswahl[teil] ?? null}
            modellKeyword={modellKeyword}
            onChange={(id) => setAuswahl((a) => ({ ...a, [teil]: id }))}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="flex gap-3 pt-2 border-t border-[#ced4da] dark:border-[#3e4042]">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 py-2.5 rounded-xl bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-semibold"
        >
          Abbrechen
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={setVerknuepfung.isPending}
          className="flex-1 py-2.5 rounded-xl bg-[#0064d2] text-white font-bold hover:bg-blue-700 disabled:opacity-50"
        >
          {setVerknuepfung.isPending ? "..." : "💾 Alle speichern"}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Zusätzliche Teile für Modell (Custom-Teiltyp-Verknüpfungen)
// ══════════════════════════════════════════════════════════════════════════════

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
          Die Standard-Teile sind immer verfügbar. Hier wählst du zusätzlich modell-spezifische Teile.
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
                <span className={`flex-1 text-sm font-semibold ${isActive ? "text-[#1a1a1a] dark:text-[#e4e6eb]" : "text-[#1a1a1a] dark:text-[#e4e6eb]"}`}>
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
// Detail-Modal
// ══════════════════════════════════════════════════════════════════════════════

function DetailModal({
  modellId,
  onClose,
  onVerknuepfen,
  onAlleEntfernen,
}: {
  modellId:        number;
  onClose:         () => void;
  onVerknuepfen:   () => void;
  onAlleEntfernen: () => void;
}) {
  const { data, isLoading, error } = api.kompatibilitaet.getDetailForModell.useQuery({ modellId });

  if (error) return (
    <div className="p-4 rounded-lg bg-[#fa3e3e]/10 border border-[#fa3e3e]/30 text-[#fa3e3e] text-sm">
      Details konnten nicht geladen werden: {error.message}
    </div>
  );

  if (isLoading || !data) return (
    <div className="flex justify-center py-8">
      <div className="w-6 h-6 border-2 border-[#0064d2]/20 border-t-[#0064d2] rounded-full animate-spin" />
    </div>
  );

  const { modell, eintraege, anzahl } = data;
  const kompMap = new Map(eintraege.map((e) => [e.teiltyp, e]));

  return (
    <div className="space-y-4">
      {/* Header-Info */}
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <h3 className="text-lg font-black text-[#1a1a1a] dark:text-[#e4e6eb]">{modell.modell}</h3>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-xs font-bold px-2 py-0.5 bg-[#0064d2]/10 text-[#0064d2] rounded-full uppercase">
              {modell.hersteller}
            </span>
            <span className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
              Verknüpfte Teile: <strong className={anzahl > 0 ? "text-[#00a400]" : "text-[#fa3e3e]"}>{anzahl}</strong>
            </span>
            <span className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
              Hinzugefügt: {new Date(modell.createdAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}
            </span>
          </div>
        </div>
      </div>

      {/* Tabelle */}
      <div className="overflow-x-auto border border-[#ced4da] dark:border-[#3e4042] rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#f0f2f5] dark:bg-[#18191a] text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] border-b border-[#ced4da] dark:border-[#3e4042]">
              <th className="px-4 py-2.5 text-left">Teiltyp</th>
              <th className="px-4 py-2.5 text-left">Artikel</th>
              <th className="px-4 py-2.5 text-center">Bestand</th>
              <th className="px-4 py-2.5 text-left">Lagerplatz</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#ced4da] dark:divide-[#3e4042]">
            {STANDARD_TEILE.map((teil) => {
              const eintrag = kompMap.get(teil);
              const artikel = eintrag?.artikel;
              return (
                <tr key={teil} className={`hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] ${!artikel ? "opacity-50" : ""}`}>
                  <td className="px-4 py-2.5 font-medium text-[#1a1a1a] dark:text-[#e4e6eb]">{teil}</td>
                  <td className="px-4 py-2.5 text-[#1a1a1a] dark:text-[#e4e6eb] whitespace-normal break-words">
                    {artikel ? artikel.bezeichnung : (
                      <span className="text-[#65676b] dark:text-[#b0b3b8] italic text-xs">— Nicht verknüpft</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {artikel ? (
                      <span className={bestandFarbe(artikel.bestand)}>{bestandLabel(artikel.bestand)}</span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[#65676b] dark:text-[#b0b3b8] font-mono">
                    {artikel?.lagerplatz ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modell-spezifische Custom-Teiltypen — klar abgesetzt */}
      <div className="border-t-2 border-[#ced4da] dark:border-[#3e4042] mt-8 pt-6">
        <ZusaetzlicheTeileForModell modellId={modellId} />
      </div>

      {/* Footer */}
      <div className="flex gap-3 pt-2 border-t border-[#ced4da] dark:border-[#3e4042] flex-wrap">
        <button
          type="button"
          onClick={onAlleEntfernen}
          disabled={anzahl === 0}
          className="px-4 py-2 text-sm font-bold rounded-xl bg-[#fa3e3e]/10 text-[#fa3e3e] border border-[#fa3e3e]/30 hover:bg-[#fa3e3e]/20 disabled:opacity-30 transition-colors"
        >
          🗑️ Alle entfernen
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onVerknuepfen}
          className="px-4 py-2 text-sm font-bold rounded-xl bg-[#0064d2]/10 text-[#0064d2] border border-[#0064d2]/30 hover:bg-[#0064d2]/20 transition-colors"
        >
          🔗 Verknüpfung bearbeiten
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm font-semibold rounded-xl bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#ced4da] transition-colors"
        >
          Schließen
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Alle-Entfernen Confirm Dialog
// ══════════════════════════════════════════════════════════════════════════════

function ConfirmRemoveAllDialog({
  geraet, anzahl, isPending, onConfirm, onCancel,
}: {
  geraet:    string;
  anzahl:    number;
  isPending: boolean;
  onConfirm: () => void;
  onCancel:  () => void;
}) {
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-[#242526] rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="text-center">
          <div className="text-5xl mb-3">🗑️</div>
          <h2 className="text-lg font-black text-[#1a1a1a] dark:text-[#e4e6eb]">
            Alle Kompatibilitäten entfernen?
          </h2>
        </div>
        <div className="bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl px-4 py-3 text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
          <strong>{geraet}</strong>
        </div>
        <p className="text-sm text-center text-[#65676b] dark:text-[#b0b3b8]">
          Das entfernt <strong className="text-[#fa3e3e]">{anzahl}</strong> Verknüpfung{anzahl !== 1 ? "en" : ""}.
          <br />Die Artikel selbst bleiben erhalten.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl bg-[#f0f2f5] dark:bg-[#3e4042] font-semibold text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#ced4da] transition-colors"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1 py-2.5 rounded-xl bg-[#fa3e3e] text-white font-bold hover:bg-red-600 disabled:opacity-50 transition-colors"
          >
            {isPending ? "Entferne…" : "Ja, alle entfernen"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Globaler Nuklear-Dialog (alle Kompatibilitäten löschen)
// ══════════════════════════════════════════════════════════════════════════════

function GlobalRemoveAllDialog({
  totalCount,
  isPending,
  onConfirm,
  onCancel,
}: {
  totalCount: number;
  isPending:  boolean;
  onConfirm:  () => void;
  onCancel:   () => void;
}) {
  const [eingabe, setEingabe] = useState("");
  const bestaetigt = eingabe === "LÖSCHEN";

  return (
    <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/70 p-4">
      <div className="bg-white dark:bg-[#242526] rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        {/* Header */}
        <div className="text-center">
          <div className="text-5xl mb-3">⚠️</div>
          <h2 className="text-xl font-black text-[#fa3e3e]">ALLE Kompatibilitäten löschen?</h2>
        </div>

        {/* Warnung */}
        <div className="bg-[#fa3e3e]/10 border border-[#fa3e3e]/30 rounded-xl px-4 py-3 space-y-1 text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
          <p>Das löscht <strong className="text-[#fa3e3e]">ALLE {totalCount.toLocaleString("de-DE")} Verknüpfungen</strong> aller Modelle im System.</p>
          <p className="text-xs text-[#65676b] dark:text-[#b0b3b8]">Modelle und Artikel bleiben erhalten. Diese Aktion kann nicht rückgängig gemacht werden!</p>
        </div>

        {/* Bestätigungs-Eingabe */}
        <div className="space-y-2">
          <label className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
            Zum Bestätigen <code className="bg-[#f0f2f5] dark:bg-[#3e4042] px-1.5 py-0.5 rounded font-mono text-[#fa3e3e]">LÖSCHEN</code> eingeben:
          </label>
          <input
            type="text"
            value={eingabe}
            onChange={(e) => setEingabe(e.target.value)}
            placeholder="LÖSCHEN"
            className="w-full px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#fa3e3e] font-mono text-center text-lg tracking-widest"
            autoFocus
          />
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl bg-[#f0f2f5] dark:bg-[#3e4042] font-semibold text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#ced4da] transition-colors"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!bestaetigt || isPending}
            className="flex-1 py-2.5 rounded-xl bg-[#fa3e3e] text-white font-black hover:bg-red-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? "Lösche…" : "Ja, alle löschen"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Haupt-Seite
// ══════════════════════════════════════════════════════════════════════════════

type Modell = { id: number; hersteller: string; modell: string; kompAnzahl: number; aktiv: boolean };

function ModelleListePageInner() {
  const { show } = useToast();
  const { activeStandortId } = useStandortFilter();

  const searchParams = useSearchParams();
  const initialQ    = searchParams?.get("q")         ?? "";
  const highlightId = searchParams?.get("highlight") ?? null;

  const [search,       setSearch]       = useState(initialQ);
  const [hersteller,   setHersteller]   = useState("");
  const [ohneKomp,     setOhneKomp]     = useState(false);
  const [page,         setPage]         = useState(1);
  const debouncedSearch = useDebounce(search, 300);

  // Modal-States
  const [verknuepfenId,    setVerknuepfenId]    = useState<number | null>(null);
  const [detailId,         setDetailId]         = useState<number | null>(null);
  const [removeAllTarget,  setRemoveAllTarget]  = useState<Modell | null>(null);
  const [globalRemoveOpen, setGlobalRemoveOpen] = useState(false);

  const { data, isLoading, error, refetch } = api.geraete.getAllWithKompCount.useQuery(
    { search: debouncedSearch || undefined, hersteller: hersteller || undefined, ohneKomp, page, limit: 50, standortId: activeStandortId },
    { refetchOnMount: "always", staleTime: 0 },
  );
  const herstellerOpts = api.geraete.getHersteller.useQuery();
  const globalCount    = api.kompatibilitaet.getCount.useQuery(undefined, { enabled: globalRemoveOpen });

  const setAktiv = api.geraete.setAktiv.useMutation({
    onSuccess: () => { refetch(); show("Status aktualisiert", "success"); },
    onError:   (e) => show(e.message, "error"),
  });

  const removeAll = api.kompatibilitaet.removeAllByModell.useMutation({
    onSuccess: (r) => {
      show(`🗑️ ${r.geloescht} Verknüpfungen entfernt`, "success");
      setRemoveAllTarget(null);
      setDetailId(null);
      refetch();
    },
    onError: (e) => show(e.message, "error"),
  });

  const removeAllGlobal = api.kompatibilitaet.removeAll.useMutation({
    onSuccess: (r) => {
      show(`🗑️ Alle ${r.geloescht} Verknüpfungen gelöscht`, "success");
      setGlobalRemoveOpen(false);
      refetch();
    },
    onError: (e) => show(e.message, "error"),
  });

  const selectedModell = data?.modelle.find((m) => m.id === (verknuepfenId ?? detailId));

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
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setGlobalRemoveOpen(true)}
            className="px-4 py-2 bg-[#fa3e3e]/10 text-[#fa3e3e] border border-[#fa3e3e]/30 font-bold rounded-xl hover:bg-[#fa3e3e]/20 text-sm transition-colors"
          >
            🗑️ Alle Verknüpfungen löschen
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
                    {/* 🔗 Verknüpfen */}
                    <button
                      onClick={() => setVerknuepfenId(m.id)}
                      className="px-2.5 py-2 text-xs font-bold rounded-lg min-h-[36px] bg-[#0064d2]/10 text-[#0064d2] dark:text-[#45bdff] border border-[#0064d2]/20 hover:bg-[#0064d2]/20 transition-colors"
                      title="Verknüpfungen bearbeiten"
                    >
                      🔗 Verknüpfen
                    </button>
                    {/* 📋 Details */}
                    <button
                      onClick={() => setDetailId(m.id)}
                      className="px-2.5 py-2 text-xs font-bold rounded-lg min-h-[36px] bg-[#f0f2f5] dark:bg-[#3e4042] text-[#1a1a1a] dark:text-[#e4e6eb] border border-[#ced4da] dark:border-[#555] hover:bg-[#ced4da] dark:hover:bg-[#555] transition-colors"
                      title="Details anzeigen"
                    >
                      📋 Details
                    </button>
                    {/* 🗑️ Alle entfernen */}
                    <button
                      onClick={() => setRemoveAllTarget(m)}
                      disabled={m.kompAnzahl === 0}
                      className="px-2.5 py-2 text-xs font-bold rounded-lg min-h-[36px] bg-[#fa3e3e]/10 text-[#fa3e3e] border border-[#fa3e3e]/20 hover:bg-[#fa3e3e]/20 disabled:opacity-30 disabled:cursor-default transition-colors"
                      title="Alle Verknüpfungen entfernen"
                    >
                      🗑️
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
        open={verknuepfenId !== null}
        onClose={() => setVerknuepfenId(null)}
        title={selectedModell ? `Kompatibilität: ${selectedModell.hersteller} ${selectedModell.modell}` : "Kompatibilität"}
        width="max-w-2xl"
      >
        {verknuepfenId !== null && (
          <VerknuepfungsModal
            modellId={verknuepfenId}
            onClose={() => setVerknuepfenId(null)}
            onSaved={() => refetch()}
          />
        )}
      </Modal>

      {/* Detail-Modal */}
      <Modal
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        title={selectedModell ? `${selectedModell.hersteller} ${selectedModell.modell}` : "Details"}
        width="max-w-6xl"
      >
        {detailId !== null && (
          <DetailModal
            modellId={detailId}
            onClose={() => setDetailId(null)}
            onVerknuepfen={() => {
              setVerknuepfenId(detailId);
              setDetailId(null);
            }}
            onAlleEntfernen={() => {
              const m = modelle.find((x) => x.id === detailId);
              if (m) setRemoveAllTarget(m);
            }}
          />
        )}
      </Modal>

      {/* Pro-Modell: Alle-Entfernen Bestätigung */}
      {removeAllTarget && (
        <ConfirmRemoveAllDialog
          geraet={`${removeAllTarget.hersteller} ${removeAllTarget.modell}`}
          anzahl={removeAllTarget.kompAnzahl}
          isPending={removeAll.isPending}
          onConfirm={() =>
            removeAll.mutate({
              geraet: `${removeAllTarget.hersteller} ${removeAllTarget.modell}`,
            })
          }
          onCancel={() => setRemoveAllTarget(null)}
        />
      )}

      {/* Global: Alle Kompatibilitäten löschen */}
      {globalRemoveOpen && (
        <GlobalRemoveAllDialog
          totalCount={globalCount.data ?? 0}
          isPending={removeAllGlobal.isPending}
          onConfirm={() => removeAllGlobal.mutate()}
          onCancel={() => setGlobalRemoveOpen(false)}
        />
      )}
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

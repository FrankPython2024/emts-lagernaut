"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import type { inferRouterOutputs } from "@trpc/server";
import { api } from "@/trpc/react";
import type { AppRouter } from "@/server/routers";
import { parseStellplatzSuche } from "@/modules/geraete-reise/filter";
import { GeraeteReiseTabs } from "../_tabs";
import { useGeraetModal } from "../_geraetModal";
import { useColliModal } from "../_colliModal";
import { formatEuro } from "../_format";

// Geräte-Reise — Stellplatz Analyse: intelligentes Freitextfeld (versteht auch
// „Lagernummer-Stellplatz"), Bereich-Chips, Stellplatz-Warenkorb (Mehrfach-
// auswahl) + CSV/Excel-Export. Reine Auswertung, kein Bestandseffekt.

// AfB-Farben
const NAVY  = "#202F61";
const BLAU  = "#008BD2";
const GRUEN = "#04B475";

const PRO_SEITE = 50;

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Zeile = RouterOutputs["geraeteReise"]["geraeteListe"]["zeilen"][number];

function nf(n: number): string {
  return n.toLocaleString("de-DE");
}

const cardCls = "bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm";

// Antippbarer Chip (Bereich / Stellplatz). Status nie nur über Farbe: aktiv
// zeigt zusätzlich ein ✓ + Klartext.
function Chip({
  label, anzahl, aktiv, onClick, farbe,
}: { label: string; anzahl: number; aktiv: boolean; onClick: () => void; farbe: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={aktiv}
      className="inline-flex items-center gap-2 px-4 rounded-xl border-2 font-bold text-base min-h-[56px] transition-colors"
      style={aktiv
        ? { background: farbe, borderColor: farbe, color: "white" }
        : { borderColor: "#ced4da", color: "inherit" }}
    >
      <span aria-hidden>{aktiv ? "✓" : "📦"}</span>
      <span className="truncate max-w-[180px]">{label}</span>
      <span
        className="text-sm font-black px-2 py-0.5 rounded-full"
        style={aktiv ? { background: "rgba(255,255,255,0.25)" } : { background: "rgba(0,0,0,0.06)" }}
      >
        {nf(anzahl)}
      </span>
    </button>
  );
}

export default function StellplatzAnalysePage() {
  const { oeffneGeraet } = useGeraetModal();
  const { oeffneColli } = useColliModal();
  const inputRef = useRef<HTMLInputElement>(null);

  const [input, setInput]           = useState("");
  const [debInput]                  = useDebounce(input, 300);
  const [lagernummer, setLagernr]   = useState("");           // Dropdown, "" = alle
  const [selBereich, setSelBereich] = useState<string | null>(null);
  const [korb, setKorb]             = useState<string[]>([]);  // exakte Stellplatz-Strings (Mehrfachauswahl)
  const [seite, setSeite]           = useState(1);

  // Intelligentes Freitext-Parsing: erkennt „120-ETL-0-0-0" usw.
  const parsed        = useMemo(() => parseStellplatzSuche(debInput), [debInput]);
  const sucheContains = parsed.stellplatzContains;             // "" wenn leer
  // Lagernummer aus dem Freitext hat Vorrang vor dem Dropdown.
  const effLager      = parsed.lagernummer ?? (lagernummer || undefined);

  // ── Datenquellen ─────────────────────────────────────────────────────────
  const bereicheQ = api.geraeteReise.stellplatzBereiche.useQuery(
    { suche: sucheContains || undefined, lagernummer: effLager },
    { staleTime: 30_000, placeholderData: (p) => p },
  );
  const lagernummernQ = api.geraeteReise.lagernummern.useQuery(undefined, { staleTime: 60_000 });
  const hatLagernummern = (lagernummernQ.data?.length ?? 0) > 0;

  // Scope der Ergebnis-Liste: Warenkorb > Bereich > Freitext.
  const scope: { stellplaetze?: string[]; bereich?: string; stellplatzContains?: string } | null =
    korb.length    ? { stellplaetze: korb }
    : selBereich   ? { bereich: selBereich }
    : sucheContains ? { stellplatzContains: sucheContains }
    : null;
  const hatScope = scope !== null;

  const listeQ = api.geraeteReise.geraeteListe.useQuery(
    { ...(scope ?? {}), lagernummer: effLager, seite, proSeite: PRO_SEITE },
    { enabled: hatScope, staleTime: 15_000, placeholderData: (p) => p },
  );

  // Filterwechsel → zurück auf Seite 1.
  useEffect(() => { setSeite(1); }, [korb, selBereich, sucheContains, effLager]);

  const bereiche = bereicheQ.data?.bereiche ?? [];
  // Beim Verfeinern der Suche eine ungültig gewordene Bereichsauswahl lösen
  // (der Warenkorb bleibt bewusst erhalten).
  useEffect(() => {
    if (selBereich && !bereiche.some((b) => b.bereich === selBereich)) setSelBereich(null);
  }, [bereiche, selBereich]);

  const aktiverBereich = useMemo(
    () => bereiche.find((b) => b.bereich === selBereich) ?? null,
    [bereiche, selBereich],
  );

  const gesamt   = listeQ.data?.gesamt ?? 0;
  const wert     = listeQ.data?.wertSumme ?? 0;
  const von      = gesamt === 0 ? 0 : (seite - 1) * PRO_SEITE + 1;
  const bis      = Math.min(seite * PRO_SEITE, gesamt);
  const maxSeite = Math.max(1, Math.ceil(gesamt / PRO_SEITE));

  const scopeLabel =
    korb.length    ? `${nf(korb.length)} ${korb.length === 1 ? "Stellplatz" : "Stellplätze"} (Warenkorb)`
    : selBereich   ? `Bereich ${selBereich}`
    : sucheContains ? `Suche „${sucheContains}"`
    : "";

  // ── Warenkorb-Helfer ───────────────────────────────────────────────────────
  function toggleKorb(stellplatz: string) {
    setKorb((prev) => prev.includes(stellplatz) ? prev.filter((s) => s !== stellplatz) : [...prev, stellplatz]);
  }
  function bereichHinzufuegen() {
    if (!aktiverBereich) return;
    const neu = aktiverBereich.stellplaetze.map((s) => s.stellplatz);
    setKorb((prev) => [...new Set([...prev, ...neu])]);
  }

  // ── Export (vorhandener Modul-Endpoint, gleicher Spaltensatz/Format) ────────
  const hatExportScope = korb.length > 0 || !!selBereich || !!sucheContains;
  function exportUrl(format: "csv" | "xlsx"): string {
    const p = new URLSearchParams();
    p.set("format", format);
    if (korb.length)         korb.forEach((s) => p.append("stellplaetze", s));
    else if (selBereich)     p.set("bereich", selBereich);
    else if (sucheContains)  p.set("stellplatzContains", sucheContains);
    if (effLager)            p.set("lagernummer", effLager);
    return `/api/geraete-reise/export?${p.toString()}`;
  }

  return (
    <div className="max-w-[1600px] space-y-6">
      <div>
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">🦊 Stellplatz Analyse</h1>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
          Geräte nach Stellplatz, Bereich oder mehreren Stellplätzen (Warenkorb) finden
        </p>
      </div>

      <GeraeteReiseTabs />

      {/* Suche + optionaler Lagernummer-Filter */}
      <div className={`${cardCls} p-5 space-y-3`}>
        <label htmlFor="stp-suche" className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
          Stellplatz suchen
        </label>
        <div className="relative">
          <input
            id="stp-suche"
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="z. B. ETL · HL-01 · Broker · 120-ETL-0-0-0"
            className="w-full px-4 text-lg font-bold rounded-xl border-2 border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#008BD2] dark:focus:border-[#45bdff] transition-colors min-h-[56px]"
          />
          {input && (
            <button
              onClick={() => { setInput(""); inputRef.current?.focus(); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#65676b] hover:text-[#fa3e3e] text-2xl font-bold min-h-[44px] min-w-[44px]"
              aria-label="Suche löschen"
            >
              ✕
            </button>
          )}
        </div>
        <p className="text-[11px] text-[#65676b] dark:text-[#b0b3b8]">
          Teil des Stellplatzes tippen (Groß-/Kleinschreibung egal). „Lagernummer-Stellplatz" wird automatisch erkannt
          {parsed.lagernummer && <>: <strong>Lager {parsed.lagernummer}</strong>, Stellplatz „{sucheContains}"</>}.
        </p>

        {/* Lagernummer-Filter — nur wenn Werte existieren */}
        {hatLagernummern ? (
          <div className="flex items-center gap-2 flex-wrap">
            <label htmlFor="lagernr" className="text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Lager</label>
            <select
              id="lagernr"
              value={lagernummer}
              onChange={(e) => setLagernr(e.target.value)}
              disabled={!!parsed.lagernummer}
              title={parsed.lagernummer ? "Lagernummer kommt aus dem Suchfeld" : undefined}
              className="px-3 rounded-xl border-2 border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] font-bold min-h-[56px] disabled:opacity-50"
            >
              <option value="">Alle Lager</option>
              {lagernummernQ.data!.map((l) => (
                <option key={l.lagernummer} value={l.lagernummer}>
                  {l.lagernummer} ({nf(l.anzahl)})
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="text-[11px] text-[#65676b] dark:text-[#b0b3b8] flex items-center gap-1.5">
            <span aria-hidden>ℹ️</span> Lagernummer-Filter füllt sich nach dem nächsten Import.
          </p>
        )}
      </div>

      {/* Warenkorb-Leiste */}
      {korb.length > 0 && (
        <div className={`${cardCls} p-4`} style={{ borderColor: GRUEN, borderWidth: 2 }}>
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] flex items-center gap-2">
              <span aria-hidden>🛒</span> Warenkorb
              <span aria-live="polite">
                <span className="text-[#65676b] dark:text-[#b0b3b8] font-normal">
                  {" "}· {nf(korb.length)} {korb.length === 1 ? "Stellplatz" : "Stellplätze"} · {nf(gesamt)} Geräte
                </span>
              </span>
            </h2>
            <button
              onClick={() => setKorb([])}
              className="text-sm font-bold text-[#65676b] dark:text-[#b0b3b8] hover:text-[#fa3e3e] min-h-[44px] px-2"
            >
              Warenkorb leeren
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {korb.map((s) => (
              <button
                key={s}
                onClick={() => toggleKorb(s)}
                aria-label={`${s} aus Warenkorb entfernen`}
                className="inline-flex items-center gap-2 px-4 rounded-xl border-2 font-bold text-base min-h-[56px] transition-colors"
                style={{ background: GRUEN, borderColor: GRUEN, color: "white" }}
              >
                <span className="truncate max-w-[180px]">{s}</span>
                <span aria-hidden className="text-lg leading-none">✕</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bereiche */}
      <div className={`${cardCls} p-4`}>
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
            Bereiche {bereicheQ.data && <span className="text-[#65676b] dark:text-[#b0b3b8] font-normal">({bereiche.length})</span>}
          </h2>
          {selBereich && (
            <button
              onClick={() => setSelBereich(null)}
              className="text-sm font-bold text-[#008BD2] dark:text-[#45bdff] hover:underline min-h-[44px] px-2"
            >
              ← Bereich schließen
            </button>
          )}
        </div>

        {bereicheQ.isLoading ? (
          <div className="flex items-center gap-3 py-4 text-[#65676b] dark:text-[#b0b3b8]">
            <div className="w-5 h-5 border-2 border-[#008BD2]/20 border-t-[#008BD2] rounded-full animate-spin" /> Lädt Bereiche…
          </div>
        ) : bereiche.length === 0 ? (
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] py-2">
            {sucheContains ? `Kein Bereich passt zu „${sucheContains}".` : "Keine Stellplätze vorhanden."}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {bereiche.map((b) => (
              <Chip
                key={b.bereich}
                label={b.bereich}
                anzahl={b.anzahl}
                aktiv={selBereich === b.bereich}
                farbe={NAVY}
                onClick={() => setSelBereich(selBereich === b.bereich ? null : b.bereich)}
              />
            ))}
          </div>
        )}

        {/* Zweite Ebene: konkrete Stellplätze des gewählten Bereichs → Warenkorb */}
        {aktiverBereich && (
          <div className="mt-4 pt-4 border-t border-[#ced4da] dark:border-[#3e4042]">
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <h3 className="text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
                Stellplätze in <span style={{ color: NAVY }}>{aktiverBereich.bereich}</span>
                <span className="text-[#65676b] dark:text-[#b0b3b8] font-normal"> ({aktiverBereich.stellplaetze.length})</span>
                <span className="block text-[11px] font-normal text-[#65676b] dark:text-[#b0b3b8]">Antippen = in den Warenkorb legen</span>
              </h3>
              <button
                onClick={bereichHinzufuegen}
                className="inline-flex items-center gap-1.5 px-4 rounded-xl text-white font-bold text-sm min-h-[56px]"
                style={{ background: GRUEN }}
              >
                <span aria-hidden>＋</span> Ganzen Bereich hinzufügen
              </button>
            </div>
            <div className="flex flex-wrap gap-2 max-h-[260px] overflow-y-auto">
              {aktiverBereich.stellplaetze.map((s) => (
                <Chip
                  key={s.stellplatz}
                  label={s.stellplatz}
                  anzahl={s.anzahl}
                  aktiv={korb.includes(s.stellplatz)}
                  farbe={GRUEN}
                  onClick={() => toggleKorb(s.stellplatz)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Ergebnis: Geräte-Liste */}
      <p aria-live="polite" className="sr-only">
        {hatScope ? `${nf(gesamt)} Geräte für ${scopeLabel}` : "Bitte Stellplatz oder Bereich wählen."}
      </p>

      {!hatScope ? (
        <div className={`${cardCls} p-8 text-center text-[#65676b] dark:text-[#b0b3b8]`}>
          <div className="text-3xl mb-2" aria-hidden>🔎</div>
          Suche oben einen Stellplatz, tippe einen Bereich an oder lege Stellplätze in den Warenkorb.
        </div>
      ) : (
        <div className={`${cardCls} overflow-hidden`}>
          <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042] flex items-center justify-between gap-3 flex-wrap">
            <h2 className="font-black text-[#1a1a1a] dark:text-[#e4e6eb]">
              {scopeLabel} <span style={{ color: BLAU }}>· {nf(gesamt)} Geräte</span>
              <span className="block text-sm font-bold mt-0.5" style={{ color: GRUEN }}>
                💶 Wert der Auswahl: {formatEuro(wert)}
              </span>
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { if (hatExportScope) window.location.href = exportUrl("csv"); }}
                disabled={!hatExportScope || gesamt === 0}
                className="inline-flex items-center gap-1.5 px-4 rounded-xl border-2 border-[#ced4da] dark:border-[#3e4042] text-[#1a1a1a] dark:text-[#e4e6eb] font-bold text-sm min-h-[56px] disabled:opacity-40 hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] transition-colors"
              >
                <span aria-hidden>⬇</span> CSV
              </button>
              <button
                onClick={() => { if (hatExportScope) window.location.href = exportUrl("xlsx"); }}
                disabled={!hatExportScope || gesamt === 0}
                className="inline-flex items-center gap-1.5 px-4 rounded-xl text-white font-bold text-sm min-h-[56px] disabled:opacity-40 transition-opacity hover:opacity-90"
                style={{ background: GRUEN }}
              >
                <span aria-hidden>⬇</span> Excel
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#f0f2f5] dark:bg-[#18191a] text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8]">
                <tr>
                  <th className="px-4 py-2.5 text-left">LogID</th>
                  <th className="px-4 py-2.5 text-left">Hersteller / Bezeichnung</th>
                  <th className="px-4 py-2.5 text-left">Stellplatz</th>
                  <th className="px-4 py-2.5 text-left">Colli</th>
                  <th className="px-4 py-2.5 text-left">Verbleib</th>
                  <th className="px-4 py-2.5 text-right">Verweildauer</th>
                </tr>
              </thead>
              <tbody>
                {listeQ.data && listeQ.data.zeilen.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-[#65676b] dark:text-[#b0b3b8]">Keine Geräte hier.</td></tr>
                )}
                {listeQ.data?.zeilen.map((g: Zeile) => (
                  <tr
                    key={g.logId}
                    onClick={() => oeffneGeraet(g.logId)}
                    className="border-t border-[#ced4da] dark:border-[#3e4042] cursor-pointer hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] transition-colors"
                    style={{ minHeight: 56 }}
                  >
                    <td className="px-4 py-3 font-mono font-bold text-[#008BD2] dark:text-[#45bdff] whitespace-nowrap">{g.logId}</td>
                    <td className="px-4 py-3 text-[#1a1a1a] dark:text-[#e4e6eb]">
                      <span className="block truncate max-w-[280px]">{[g.hersteller, g.bezeichnung].filter(Boolean).join(" ") || "—"}</span>
                    </td>
                    <td className="px-4 py-3 text-[#65676b] dark:text-[#b0b3b8]">{g.stellplatz || "—"}</td>
                    <td className="px-4 py-3">
                      {g.colli ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); oeffneColli(g.colli!); }}
                          className="inline-flex items-center gap-1 font-mono font-bold text-[#008BD2] dark:text-[#45bdff] hover:underline"
                          title={`Alle Geräte im Colli ${g.colli} anzeigen`}
                        >
                          <span aria-hidden>📦</span>{g.colli}
                        </button>
                      ) : (
                        <span className="text-[#65676b] dark:text-[#b0b3b8]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[#65676b] dark:text-[#b0b3b8]">{g.verbleib || "—"}</td>
                    <td className="px-4 py-3 text-right font-bold whitespace-nowrap" style={{ color: GRUEN }}>
                      {g.verweildauerTage != null ? `${nf(g.verweildauerTage)} T` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-[#ced4da] dark:border-[#3e4042] flex-wrap">
            <span className="text-sm text-[#65676b] dark:text-[#b0b3b8]">{nf(von)}–{nf(bis)} von {nf(gesamt)}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSeite((s) => Math.max(1, s - 1))}
                disabled={seite <= 1}
                className="px-4 text-sm font-bold rounded-xl border-2 border-[#ced4da] dark:border-[#3e4042] disabled:opacity-40 hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] transition-colors min-h-[56px]"
              >
                ← Zurück
              </button>
              <span className="text-sm text-[#65676b] dark:text-[#b0b3b8] tabular-nums">Seite {nf(seite)} / {nf(maxSeite)}</span>
              <button
                onClick={() => setSeite((s) => Math.min(maxSeite, s + 1))}
                disabled={seite >= maxSeite}
                className="px-4 text-sm font-bold rounded-xl border-2 border-[#ced4da] dark:border-[#3e4042] disabled:opacity-40 hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] transition-colors min-h-[56px]"
              >
                Vor →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

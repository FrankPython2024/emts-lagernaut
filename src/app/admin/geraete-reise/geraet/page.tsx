"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import { api } from "@/trpc/react";
import type { AppRouter } from "@/server/routers";

// Geräte-Reise — S2: ein Gerät verfolgen (Suche + aktueller Stand + Timeline).
// Reine Auswertung, kein Bestandseffekt.

type RouterOutputs = inferRouterOutputs<AppRouter>;
type GeraetGefunden = Extract<RouterOutputs["geraeteReise"]["geraet"], { kind: "found" }>;
type StandData      = GeraetGefunden["stand"];
type BewegungData   = GeraetGefunden["bewegungen"];

// ── Datum-Helfer ────────────────────────────────────────────────────────────────
function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Spaltenname → verständlicher Klartext (für Bewegungen)
const FELD_LABEL: Record<string, string> = {
  verbleib:         "Verbleib",
  stellplatz:       "Stellplatz",
  colli:            "Colli",
  lager:            "Lager",
  grading:          "Grading",
  aktuellerZustand: "Aktueller Zustand",
  refurbished:      "Refurbished",
  blockiert:        "Blockiert",
};

// ── Tab-Leiste (geteilt mit der Import-Seite) ───────────────────────────────────
function Tabs() {
  return (
    <div className="flex gap-1 border-b border-[#ced4da] dark:border-[#3e4042]">
      <Link
        href="/admin/geraete-reise"
        className="px-4 py-2 text-sm font-bold text-[#65676b] dark:text-[#b0b3b8] hover:text-[#0064d2] dark:hover:text-[#45bdff] border-b-2 border-transparent transition-colors"
      >
        Importe
      </Link>
      <span className="px-4 py-2 text-sm font-bold text-[#0064d2] dark:text-[#45bdff] border-b-2 border-[#0064d2] dark:border-[#45bdff]">
        Gerät verfolgen
      </span>
    </div>
  );
}

// ── Stand-Zeile (leere Werte ausblenden) ────────────────────────────────────────
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3 py-2 border-b border-[#f0f2f5] dark:border-[#3e4042] last:border-0">
      <span className="text-xs font-bold uppercase tracking-wide text-[#65676b] dark:text-[#b0b3b8] sm:w-44 flex-shrink-0">
        {label}
      </span>
      <span className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb] break-words">{value}</span>
    </div>
  );
}

type TimelineItem = {
  datum:      Date;
  icon:       string;
  titel:      string;
  detail?:    string | null;
  bearbeiter?: string | null;
  rot?:       boolean;
};

export default function GeraetVerfolgenPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput]         = useState("");
  const [submitted, setSubmitted] = useState("");

  const query = api.geraeteReise.geraet.useQuery(
    { query: submitted },
    { enabled: submitted.trim().length > 0 },
  );

  useEffect(() => { inputRef.current?.focus(); }, []);

  function suchen() {
    const v = input.trim();
    if (v) setSubmitted(v);
  }

  const data    = query.data;
  const loading = query.isFetching;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">🧭 Geräte-Reise</h1>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
          Ein Gerät über LogID oder Seriennummer verfolgen
        </p>
      </div>

      <Tabs />

      {/* Suchfeld */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm">
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") suchen(); }}
            placeholder="LogID oder Seriennummer eingeben → Enter"
            className="w-full px-4 py-4 text-lg font-bold font-mono rounded-xl border-2 border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] dark:focus:border-[#45bdff] transition-colors"
          />
          {input && (
            <button
              onClick={() => { setInput(""); inputRef.current?.focus(); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[#65676b] hover:text-[#fa3e3e] text-2xl font-bold transition-colors"
              aria-label="Eingabe löschen"
            >
              ✕
            </button>
          )}
        </div>
        <button
          onClick={suchen}
          disabled={!input.trim()}
          className="mt-3 w-full sm:w-auto px-6 py-2.5 rounded-xl bg-[#0064d2] dark:bg-[#45bdff] text-white font-bold disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          🔍 Gerät laden
        </button>
      </div>

      {/* Ergebnis */}
      {submitted && (
        <div className="space-y-6">
          {loading && (
            <div className="flex items-center gap-3 p-5 bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm">
              <div className="w-5 h-5 border-2 border-[#0064d2]/20 border-t-[#0064d2] rounded-full animate-spin flex-shrink-0" />
              <span className="text-[#65676b] dark:text-[#b0b3b8]">Suche läuft…</span>
            </div>
          )}

          {/* Nicht gefunden */}
          {!loading && data?.kind === "none" && (
            <div className="p-5 bg-white dark:bg-[#242526] rounded-xl border-2 border-[#f7b928]/40 shadow-sm flex items-center gap-3">
              <span className="text-2xl">⚠️</span>
              <div>
                <p className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Nicht gefunden</p>
                <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
                  Kein Gerät mit LogID oder Seriennummer <span className="font-mono">{submitted}</span>.
                </p>
              </div>
            </div>
          )}

          {/* Mehrere Seriennummer-Treffer → Auswahl */}
          {!loading && data?.kind === "treffer" && (
            <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042]">
                <p className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
                  {data.treffer.length} Treffer — bitte Gerät wählen
                </p>
              </div>
              <div className="divide-y divide-[#ced4da] dark:divide-[#3e4042]">
                {data.treffer.map((t) => (
                  <button
                    key={t.logId}
                    onClick={() => { setInput(t.logId); setSubmitted(t.logId); }}
                    className="w-full text-left px-5 py-3 hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] transition-colors flex items-center justify-between gap-3"
                  >
                    <span className="font-mono font-bold text-[#0064d2] dark:text-[#45bdff]">{t.logId}</span>
                    <span className="text-sm text-[#65676b] dark:text-[#b0b3b8] truncate">{t.bezeichnung ?? "—"}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Gefunden */}
          {!loading && data?.kind === "found" && (
            <GeraetDetail stand={data.stand} bewegungen={data.bewegungen} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Detail-Ansicht ──────────────────────────────────────────────────────────────
function GeraetDetail({
  stand,
  bewegungen,
}: {
  stand:      StandData;
  bewegungen: BewegungData;
}) {
  // Station: nur vorhandene Teile zusammensetzen
  const station = [
    stand.lager      && `${stand.lager}`,
    stand.filiale    && `Filiale ${stand.filiale}`,
    stand.stellplatz && `Platz ${stand.stellplatz}`,
    stand.colli      && `Colli ${stand.colli}`,
  ].filter(Boolean).join(" · ");

  const verbleibText = stand.verbleib
    ? [
        stand.verbleib,
        stand.inVerbleibSeit  ? `seit ${fmtDate(stand.inVerbleibSeit)}` : null,
        stand.inVerbleibDurch ? `durch ${stand.inVerbleibDurch}`        : null,
      ].filter(Boolean).join(" · ")
    : null;

  const gradingText = stand.grading
    ? stand.initialesGrading && stand.initialesGrading !== stand.grading
      ? `${stand.grading} (initial ${stand.initialesGrading})`
      : stand.grading
    : null;

  const refurbishedText = stand.refurbished
    ? (stand.refurbishDatum ? `Ja · ${fmtDate(stand.refurbishDatum)}` : "Ja")
    : null;

  // ── Timeline zusammenbauen (neueste zuerst) ──
  const items: TimelineItem[] = [];
  if (stand.aufLagerGebuchtAm) {
    items.push({ datum: new Date(stand.aufLagerGebuchtAm), icon: "📥", titel: "Auf Lager gebucht" });
  }
  if (stand.refurbishDatum) {
    items.push({ datum: new Date(stand.refurbishDatum), icon: "✨", titel: "Refurbished" });
  }
  if (stand.verbleib && stand.inVerbleibSeit) {
    items.push({
      datum:      new Date(stand.inVerbleibSeit),
      icon:       "📍",
      titel:      `In Verbleib: ${stand.verbleib}`,
      detail:     stand.inVerbleibDurch ? `durch ${stand.inVerbleibDurch}` : null,
    });
  }
  if (stand.blockiert && stand.blockiertAm) {
    items.push({
      datum:      new Date(stand.blockiertAm),
      icon:       "🚫",
      titel:      "Blockiert",
      detail:     [stand.blockiertVon && `von ${stand.blockiertVon}`, stand.begruendung].filter(Boolean).join(" · ") || null,
      rot:        true,
    });
  }
  for (const b of bewegungen) {
    items.push({
      datum:      new Date(b.zeitpunkt),
      icon:       "🔄",
      titel:      FELD_LABEL[b.feld] ?? b.feld,
      detail:     `${b.vonWert ?? "—"} → ${b.nachWert ?? "—"}`,
      bearbeiter: b.bearbeiter,
      rot:        b.feld === "blockiert" && (b.nachWert === "ja"),
    });
  }
  items.sort((a, b) => b.datum.getTime() - a.datum.getTime());

  return (
    <>
      {/* Kopf */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-2xl font-black font-mono text-[#0064d2] dark:text-[#45bdff]">{stand.logId}</div>
            <div className="text-lg font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mt-1">
              {[stand.hersteller, stand.bezeichnung].filter(Boolean).join(" ") || "—"}
            </div>
            {stand.geraeteart && (
              <div className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
                {stand.geraeteart}{stand.unterart ? ` · ${stand.unterart}` : ""}
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            {stand.verbleib && (
              <span className="text-xs font-black px-3 py-1 rounded-full bg-[#e7f0fd] text-[#0064d2] dark:bg-[#11243d] dark:text-[#45bdff]">
                {stand.verbleib}
              </span>
            )}
            {stand.blockiert && (
              <span className="text-xs font-black px-3 py-1 rounded-full bg-[#ffe0e0] text-[#b3261e] dark:bg-[#3a1414] dark:text-[#ff8a8a]">
                🚫 Blockiert
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Aktueller Stand */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042]">
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Aktueller Stand</h2>
        </div>
        <div className="px-5 py-2">
          <Row label="Station"          value={station || null} />
          <Row label="Verbleib"         value={verbleibText} />
          <Row label="Verweildauer"     value={stand.verweildauerTage != null ? `${stand.verweildauerTage} Tage` : null} />
          <Row label="Auf Lager seit"   value={fmtDate(stand.aufLagerGebuchtAm) || null} />
          <Row label="Grading"          value={gradingText} />
          <Row label="Aktueller Zustand" value={stand.aktuellerZustand} />
          <Row label="Refurbished"      value={refurbishedText} />
          <Row label="Letzte Änderung"  value={fmtDateTime(stand.letzteAenderungAm) || null} />
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042]">
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Reise</h2>
        </div>

        <div className="p-5">
          {bewegungen.length === 0 && (
            <div className="mb-5 text-sm text-[#65676b] dark:text-[#b0b3b8] bg-[#f0f2f5] dark:bg-[#18191a] rounded-lg px-4 py-3 flex items-start gap-2">
              <span>ℹ️</span>
              <span>Noch keine Bewegungen erfasst – ab dem nächsten Import.</span>
            </div>
          )}

          {items.length === 0 ? (
            <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] text-center py-4">
              Keine Zeitpunkte hinterlegt.
            </p>
          ) : (
            <ol className="relative border-l-2 border-[#ced4da] dark:border-[#3e4042] ml-3 space-y-5">
              {items.map((it, i) => (
                <li key={i} className="ml-6">
                  <span
                    className={`absolute -left-[13px] flex items-center justify-center w-6 h-6 rounded-full text-xs ${
                      it.rot
                        ? "bg-[#ffe0e0] dark:bg-[#3a1414]"
                        : "bg-[#e7f0fd] dark:bg-[#11243d]"
                    }`}
                    aria-hidden
                  >
                    {it.icon}
                  </span>
                  <div className={`font-bold ${it.rot ? "text-[#b3261e] dark:text-[#ff8a8a]" : "text-[#1a1a1a] dark:text-[#e4e6eb]"}`}>
                    {it.titel}
                  </div>
                  {it.detail && (
                    <div className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-0.5 break-words">{it.detail}</div>
                  )}
                  <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1">
                    {fmtDateTime(it.datum)}
                    {it.bearbeiter ? ` · ${it.bearbeiter}` : ""}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </>
  );
}

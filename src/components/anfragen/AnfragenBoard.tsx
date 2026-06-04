"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { AnfrageStatus } from "@prisma/client";
import { Printer, Trash2, ChevronDown, MessageCircle } from "lucide-react";
import type { AppRouter } from "@/server/routers";
import { istUeberfaellig, verstricheneZeit } from "@/lib/anfragen/ueberfaellig";
import { UeberfaelligBadge } from "@/components/anfragen/UeberfaelligBadge";
import { StatusBadge } from "@/components/ui/StatusBadge";

// Exakt dieselben Daten wie die Listen-Ansicht (api.anfragen.getGruppiert).
// Kein eigener Query — die Seite reicht das bereits geladene Array durch.
type RouterOutputs = inferRouterOutputs<AppRouter>;
export type AnfragenGruppe = RouterOutputs["anfragen"]["getGruppiert"][number];
export type BoardAnfrage   = AnfragenGruppe["anfragen"][number];

type SpaltenKey = "offen" | "bearbeitung" | "abgeschlossen";

// Mapping Spalte → enthaltene Status. STORNIERT (und NICHT_VERFUEGBAR) tauchen
// im Board bewusst nicht auf.
const SPALTEN: { key: SpaltenKey; titel: string; status: AnfrageStatus[] }[] = [
  { key: "offen",         titel: "Offen",          status: [AnfrageStatus.NEU, AnfrageStatus.BEDARF] },
  { key: "bearbeitung",   titel: "In Bearbeitung", status: [AnfrageStatus.IN_BEARBEITUNG] },
  { key: "abgeschlossen", titel: "Abgeschlossen",  status: [AnfrageStatus.ABGESCHLOSSEN] },
];

// Abgeschlossen-Spalte tritt zurück → nur die jüngsten N Karten zeigen.
const ABGESCHLOSSEN_LIMIT = 10;

// Stabile Identität einer Gruppe (gruppenNr, sonst Techniker+LogId) — für Keys
// und den Vorher/Nachher-Statusvergleich.
function gruppenKey(g: AnfragenGruppe): string {
  return g.gruppenNr ?? `${g.techniker}__${g.logId}`;
}

export type AnfragenBoardProps = {
  gruppen:          AnfragenGruppe[];
  ersteller:        string;
  now:              number;          // tickender Timestamp (useNow) für Live-Überfälligkeit/Alter
  canEdit:          boolean;
  canDelete:        boolean;
  isBusy:           boolean;
  // Gruppen-Aktionen
  onUebernehmen:    (g: AnfragenGruppe) => void;
  onAlleErledigen:  (g: AnfragenGruppe) => void;
  onZurueckgeben:   (g: AnfragenGruppe) => void;
  onFreigeben:      (g: AnfragenGruppe) => void;
  onEtikettDrucken: (g: AnfragenGruppe) => void;
  // Chat — öffnet exakt den bestehenden Chat der Liste; chatUngelesen liefert die
  // Ungelesen-Anzahl (gleiche Logik/Datenquelle wie die Liste).
  onChat:           (g: AnfragenGruppe) => void;
  chatUngelesen:    (g: AnfragenGruppe) => number;
  // Per-Teil-Aktionen — verdrahten 1:1 auf die bestehenden Handler/Mutationen der Liste
  onTeilErledigen:       (anfrageId: number, gruppenLabel: string) => void;
  onTeilStornieren:      (anfrageId: number) => void;
  onTeilNichtVerfuegbar: (anfrageId: number, label: string) => void;
  onTeilLoeschen:        (anfrageId: number, label: string) => void;
  onTeilReprint:         (a: BoardAnfrage) => void;
};

// ── kleine Helfer ─────────────────────────────────────────────────────────────

function initialen(s: string): string {
  const t = (s ?? "").trim();
  if (!t) return "??";
  const teile = t.split(/\s+/);
  if (teile.length >= 2 && teile[0] && teile[1]) return (teile[0][0]! + teile[1][0]!).toUpperCase();
  return t.slice(0, 2).toUpperCase();
}

function Avatar({ name, text, akzent, title }: { name?: string; text?: string; akzent?: boolean; title?: string }) {
  return (
    <span
      title={title}
      aria-hidden
      className="inline-flex items-center justify-center rounded-full text-[11px] font-black text-white w-7 h-7 flex-shrink-0"
      style={{ background: akzent ? "#04B475" : "#008BD2" }}
    >
      {text ?? initialen(name ?? "")}
    </span>
  );
}

// Dezente Status-Tönung (dunkler Text, WCAG-AA-tauglich) + Balkenfarbe links.
// Überfällig übersteuert: roter Balken + roter Rand, damit es heraussticht.
function kartenStyle(status: AnfrageStatus, ueberfaellig: boolean): { bar: string; bg: string; border: string } {
  if (ueberfaellig) {
    return { bar: "#ef4444", bg: "bg-red-50 dark:bg-red-950/25", border: "border-2 border-red-300 dark:border-red-800" };
  }
  switch (status) {
    case AnfrageStatus.NEU:
      return { bar: "#008BD2", bg: "bg-sky-50 dark:bg-sky-950/20",     border: "border border-[#ced4da] dark:border-[#3e4042]" };
    case AnfrageStatus.BEDARF:
      return { bar: "#f59e0b", bg: "bg-amber-50 dark:bg-amber-950/20", border: "border border-[#ced4da] dark:border-[#3e4042]" };
    case AnfrageStatus.IN_BEARBEITUNG:
      return { bar: "#04B475", bg: "bg-emerald-50 dark:bg-emerald-950/20", border: "border border-[#ced4da] dark:border-[#3e4042]" };
    case AnfrageStatus.ABGESCHLOSSEN:
    default:
      return { bar: "#9ca3af", bg: "bg-gray-50 dark:bg-[#1c1d1e]", border: "border border-[#e4e6e9] dark:border-[#2a2b2c]" };
  }
}

// Unterstatus-Tag nur in Spalte „Offen" — sonst ist die Spalte selbst der Status.
function SubStatusTag({ status }: { status: AnfrageStatus }) {
  const istNeu = status === AnfrageStatus.NEU;
  const farbe  = istNeu ? "#008BD2" : "#f59e0b";
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide bg-white/70 dark:bg-black/20 text-[#1a1a1a] dark:text-[#e4e6eb]">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: farbe }} aria-hidden />
      {istNeu ? "Neu" : "Bedarf"}
    </span>
  );
}

// ── Gruppen-Karte ─────────────────────────────────────────────────────────────

function GruppenKarte({
  gruppe, spalte, flash, ersteller, now, canEdit, canDelete, isBusy,
  onUebernehmen, onAlleErledigen, onZurueckgeben, onFreigeben, onEtikettDrucken,
  onChat, chatUngelesen,
  onTeilErledigen, onTeilStornieren, onTeilNichtVerfuegbar, onTeilLoeschen, onTeilReprint,
}: { gruppe: AnfragenGruppe; spalte: SpaltenKey; flash: boolean } & Omit<AnfragenBoardProps, "gruppen">) {
  const [offen, setOffen] = useState(false); // Teil-Bereich: Default zugeklappt
  const teile = gruppe.anfragen;
  const n     = teile.length;
  const kartenId     = gruppenKey(gruppe);
  const gruppenLabel = gruppe.geraeteName ?? gruppe.logId;
  const chatCount    = chatUngelesen(gruppe);

  // Überfälligkeit + Alter aus der ältesten Anfrage (bestehende Logik, kein Neu-Erfinden).
  const aeltesteMs  = Math.min(...teile.map((a) => new Date(a.createdAt).getTime()));
  const ueberfaellig = teile.some((a) => istUeberfaellig(a.status, a.createdAt, now));
  const alter        = verstricheneZeit(new Date(aeltesteMs), now);

  // Lock-State (wie die Liste)
  const lockedAnfrage   = teile.find((a) => a.bearbeitetVon);
  const bearbeitetVon   = lockedAnfrage?.bearbeitetVon ?? null;
  const isLockedByMe    = !!bearbeitetVon && bearbeitetVon.toUpperCase() === ersteller.toUpperCase();
  const isLockedByOther = !!bearbeitetVon && !isLockedByMe;
  const anyTakeable     = teile.some((a) => (a.status === AnfrageStatus.NEU || a.status === AnfrageStatus.BEDARF) && !a.bearbeitetVon);

  const stil = kartenStyle(gruppe.gruppenStatus, ueberfaellig);

  // Teil/Teile-Zeile
  const erledigt = teile.filter((a) => a.status === AnfrageStatus.ABGESCHLOSSEN).length;

  return (
    <div
      className={`relative rounded-xl ${stil.border} ${stil.bg} shadow-sm overflow-hidden ${flash ? "board-card-enter" : ""}`}
      style={{ borderLeft: `4px solid ${stil.bar}` }}
    >
      {/* Cyan-Highlight beim Spaltenwechsel — Overlay, damit die Status-Tönung bleibt */}
      {flash && <span aria-hidden className="board-card-flash-overlay" />}
      <div className="relative px-3.5 py-3 space-y-2">
        {/* Kopfzeile: Log-ID + Badges */}
        <div className="flex items-start justify-between gap-2">
          <div className="font-mono font-black text-base text-[#1a1a1a] dark:text-[#e4e6eb] break-all leading-tight">
            {gruppe.logId}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {ueberfaellig && <UeberfaelligBadge title={alter} />}
            {spalte === "bearbeitung" && bearbeitetVon && (
              isLockedByOther ? (
                <span
                  title={`Gesperrt von ${bearbeitetVon}`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 whitespace-nowrap"
                >
                  <span aria-hidden>🔒</span> {bearbeitetVon}
                </span>
              ) : (
                <Avatar text={isLockedByMe ? "Du" : initialen(bearbeitetVon)} akzent title={`Bearbeiter: ${bearbeitetVon}`} />
              )
            )}

            {/* Chat — öffnet exakt den Chat der Liste; Ungelesen-Badge wie dort */}
            <button
              type="button"
              onClick={() => onChat(gruppe)}
              aria-label={chatCount > 0 ? `Chat öffnen — ${chatCount} ungelesen` : "Chat öffnen"}
              title="Chat öffnen"
              style={chatCount > 0 ? { animation: "chatPulse 1.5s ease-in-out infinite" } : undefined}
              className={`relative inline-flex items-center justify-center w-9 h-9 rounded-lg transition-colors flex-shrink-0 ${chatCount > 0 ? "bg-[#0064d2] text-white hover:bg-[#0056b3]" : "bg-[#0064d2]/10 text-[#0064d2] dark:text-[#45bdff] hover:bg-[#0064d2]/20"}`}
            >
              <MessageCircle size={16} aria-hidden />
              {chatCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-[#fa3e3e] text-white text-[10px] font-black leading-none">
                  {chatCount > 9 ? "9+" : chatCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Unterstatus-Tag nur in „Offen" */}
        {spalte === "offen" && <div><SubStatusTag status={gruppe.gruppenStatus} /></div>}

        {/* Gerät (bereinigter Modellname kommt bereits aus geraeteName) */}
        {gruppe.geraeteName && (
          <div className="text-xs font-semibold text-[#65676b] dark:text-[#b0b3b8] truncate" title={gruppe.geraeteName}>
            {gruppe.geraeteName}
          </div>
        )}

        {/* Teil / Teile */}
        {n === 1 ? (
          <div className="text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
            {teile[0]!.beschreibung ?? teile[0]!.teil}
            <span className="font-normal text-[#65676b] dark:text-[#b0b3b8]"> · {teile[0]!.grading ?? "Bestmöglich"}</span>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
              {n} Teile <span className="font-normal text-[#65676b] dark:text-[#b0b3b8]">· {erledigt} von {n} erledigt</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-black/10 dark:bg-white/10 overflow-hidden" role="progressbar" aria-valuenow={erledigt} aria-valuemin={0} aria-valuemax={n}>
              <div className="h-full rounded-full transition-all" style={{ width: `${n ? (erledigt / n) * 100 : 0}%`, background: "#04B475" }} />
            </div>
          </div>
        )}

        {/* Fußzeile: Techniker-Avatar + Alter, darunter Auftragsnummer */}
        <div className="flex items-center gap-2 pt-1 min-w-0">
          <Avatar name={gruppe.techniker} title={`Techniker ${gruppe.techniker}`} />
          <span className="text-xs text-[#65676b] dark:text-[#b0b3b8] truncate">
            {gruppe.techniker} · {alter}
          </span>
        </div>
        {gruppe.gruppenNr && (
          <div className="text-[10px] font-mono text-[#90939a] dark:text-[#6b6e73] truncate">{gruppe.gruppenNr}</div>
        )}

        {/* Status-spezifische Haupt-Aktion(en) — bestehende Handler */}
        {spalte === "offen" && canEdit && anyTakeable && !bearbeitetVon && (
          <button
            type="button"
            onClick={() => onUebernehmen(gruppe)}
            disabled={isBusy}
            className="w-full px-3 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg disabled:opacity-50 transition-colors min-h-[44px]"
          >
            ▶️ Übernehmen
          </button>
        )}

        {spalte === "bearbeitung" && canEdit && isLockedByOther && (
          <button
            type="button"
            onClick={() => onFreigeben(gruppe)}
            className="w-full px-3 py-2.5 bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100 text-amber-700 dark:text-amber-400 text-xs font-bold rounded-lg border border-amber-300 dark:border-amber-700 transition-colors min-h-[44px]"
          >
            🔓 Freigeben
          </button>
        )}
        {spalte === "bearbeitung" && canEdit && !isLockedByOther && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onAlleErledigen(gruppe)}
              disabled={isBusy}
              className="flex-1 px-3 py-2.5 bg-[#00a400] text-white text-xs font-bold rounded-lg hover:bg-green-600 disabled:opacity-40 transition-colors min-h-[44px]"
            >
              ✅ Alle erledigen
            </button>
            {isLockedByMe && (
              <button
                type="button"
                onClick={() => onZurueckgeben(gruppe)}
                disabled={isBusy}
                className="px-3 py-2.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-lg disabled:opacity-50 transition-colors border border-slate-300 dark:border-slate-500 min-h-[44px]"
              >
                ⏸️ Zurückgeben
              </button>
            )}
          </div>
        )}

        {spalte === "abgeschlossen" && (
          <button
            type="button"
            onClick={() => onEtikettDrucken(gruppe)}
            aria-label="Etikett erneut drucken"
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-[#0064d2]/10 text-[#0064d2] dark:text-[#45bdff] hover:bg-[#0064d2]/20 text-xs font-bold rounded-lg transition-colors min-h-[44px]"
          >
            <Printer size={14} /> Etikett drucken
          </button>
        )}

        {/* Aufklappbarer Teil-Bereich mit den feinen Per-Teil-Aktionen der Liste */}
        <div className="pt-1 border-t border-black/5 dark:border-white/10">
          <button
            type="button"
            aria-expanded={offen}
            aria-controls={`teile-${kartenId}`}
            onClick={() => setOffen((v) => !v)}
            className="w-full flex items-center justify-between gap-2 px-1 py-2 rounded-lg text-xs font-semibold text-[#65676b] dark:text-[#b0b3b8] hover:bg-black/5 dark:hover:bg-white/5 transition-colors min-h-[44px]"
          >
            <span>{n} {n === 1 ? "Teil" : "Teile"}{offen ? " ausblenden" : " anzeigen"}</span>
            <ChevronDown size={16} aria-hidden className={`transition-transform ${offen ? "rotate-180" : ""}`} />
          </button>

          {offen && (
            <div id={`teile-${kartenId}`} className="divide-y divide-black/5 dark:divide-white/10">
              {teile.map((a) => {
                const rowLockedByOther = !!a.bearbeitetVon && a.bearbeitetVon.toUpperCase() !== ersteller.toUpperCase();
                const teilLabel = a.beschreibung ?? a.teil;
                return (
                  <div key={a.id} className={`flex items-center gap-2 py-2 ${rowLockedByOther ? "opacity-60" : ""}`}>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-[#1a1a1a] dark:text-[#e4e6eb] truncate" title={teilLabel}>{teilLabel}</div>
                      <div className="text-[11px] text-[#65676b] dark:text-[#b0b3b8]">{a.grading ? `${a.grading} erwünscht` : "Bestmöglich"}</div>
                    </div>
                    <StatusBadge status={a.status} />
                    <div className="flex gap-1 flex-shrink-0">
                      {/* Beleg erneut drucken */}
                      {a.status === AnfrageStatus.ABGESCHLOSSEN && (
                        <button
                          onClick={() => onTeilReprint(a)}
                          aria-label="Auslagerbeleg erneut drucken"
                          title="Auslagerbeleg erneut drucken"
                          className="px-2 py-2 text-xs bg-[#0064d2]/10 text-[#0064d2] rounded hover:bg-[#0064d2]/20 font-bold transition-colors min-h-[36px]"
                        >
                          🖨️
                        </button>
                      )}

                      {/* Erledigen */}
                      {canEdit && a.status !== AnfrageStatus.ABGESCHLOSSEN && a.status !== AnfrageStatus.STORNIERT && (
                        <button
                          onClick={() => !rowLockedByOther && onTeilErledigen(a.id, gruppenLabel)}
                          disabled={isBusy || rowLockedByOther}
                          aria-label="Teil erledigen"
                          title={rowLockedByOther ? `Gesperrt von ${a.bearbeitetVon}` : "Erledigen"}
                          className="px-2 py-2 text-xs bg-[#00a400]/10 text-[#00a400] rounded hover:bg-[#00a400]/20 font-bold disabled:opacity-40 transition-colors min-h-[36px]"
                        >
                          ✓
                        </button>
                      )}

                      {/* Stornieren */}
                      {canEdit && (a.status === AnfrageStatus.NEU || a.status === AnfrageStatus.BEDARF) && (
                        <button
                          onClick={() => !rowLockedByOther && onTeilStornieren(a.id)}
                          disabled={isBusy || rowLockedByOther}
                          aria-label="Teil stornieren"
                          title={rowLockedByOther ? `Gesperrt von ${a.bearbeitetVon}` : "Stornieren"}
                          className="px-2 py-2 text-xs bg-[#fa3e3e]/10 text-[#fa3e3e] rounded hover:bg-[#fa3e3e]/20 font-bold disabled:opacity-40 transition-colors min-h-[36px]"
                        >
                          ✕
                        </button>
                      )}

                      {/* Nicht verfügbar */}
                      {canEdit && (a.status === AnfrageStatus.NEU || a.status === AnfrageStatus.BEDARF || a.status === AnfrageStatus.IN_BEARBEITUNG) && (
                        <button
                          onClick={() => !rowLockedByOther && onTeilNichtVerfuegbar(a.id, teilLabel)}
                          disabled={isBusy || rowLockedByOther}
                          aria-label="Ersatzteil als nicht verfügbar markieren"
                          title={rowLockedByOther ? `Gesperrt von ${a.bearbeitetVon}` : "Ersatzteil nicht verfügbar"}
                          className="px-2 py-2 text-xs bg-orange-500/10 text-orange-600 dark:text-orange-400 rounded hover:bg-orange-500/20 font-bold disabled:opacity-40 transition-colors min-h-[36px]"
                        >
                          🚫
                        </button>
                      )}

                      {/* Löschen */}
                      {canDelete && (
                        <button
                          onClick={() => onTeilLoeschen(a.id, teilLabel)}
                          aria-label="Anfrage löschen"
                          title="Anfrage löschen"
                          className="flex items-center justify-center px-2 py-2 bg-[#fa3e3e]/10 text-[#fa3e3e] rounded hover:bg-[#fa3e3e]/20 transition-colors min-h-[44px] min-w-[44px]"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Board ─────────────────────────────────────────────────────────────────────

export function AnfragenBoard(props: AnfragenBoardProps) {
  const { gruppen } = props;

  // ── Spaltenwechsel sichtbar machen ─────────────────────────────────────────
  // Vorher/Nachher-Vergleich: gruppenKey → letzter gruppenStatus. Ändert sich der
  // Status beim nächsten Daten-Render (Mutation-refetch, Socket-Refresh oder
  // 5s-Auto-Refresh — egal von wem ausgelöst), flasht die betroffene Karte.
  // Die Spaltenzuordnung selbst kommt IMMER frisch aus gruppenStatus (siehe unten),
  // hier wird nur die Hervorhebung getriggert.
  const prevStatusRef = useRef<Map<string, AnfrageStatus>>(new Map());
  const timersRef     = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [flashIds, setFlashIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const prev = prevStatusRef.current;
    const next = new Map<string, AnfrageStatus>();
    const changed: string[] = [];
    for (const g of gruppen) {
      const id = gruppenKey(g);
      next.set(id, g.gruppenStatus);
      const vorher = prev.get(id);
      if (vorher !== undefined && vorher !== g.gruppenStatus) changed.push(id);
    }
    prevStatusRef.current = next; // beim ersten Render: nur Baseline, kein Flash
    if (changed.length === 0) return;

    setFlashIds((s) => {
      const n = new Set(s);
      for (const id of changed) n.add(id);
      return n;
    });
    // Selbst-löschende Timer pro id (nicht an Effect-Cleanup gekoppelt, damit ein
    // schneller Folge-Refetch den Flash nicht abschneidet).
    for (const id of changed) {
      const alt = timersRef.current.get(id);
      if (alt) clearTimeout(alt);
      const t = setTimeout(() => {
        timersRef.current.delete(id);
        setFlashIds((s) => { const n = new Set(s); n.delete(id); return n; });
      }, 1200);
      timersRef.current.set(id, t);
    }
  }, [gruppen]);

  // Beim Unmount alle laufenden Timer aufräumen.
  useEffect(() => {
    const timers = timersRef.current;
    return () => { for (const t of timers.values()) clearTimeout(t); };
  }, []);

  // Gruppen je Spalte (Karten = Gruppen, einsortiert nach gruppenStatus).
  const spaltenDaten = useMemo(() => {
    return SPALTEN.map((spalte) => {
      const alle = gruppen.filter((g) => spalte.status.includes(g.gruppenStatus));
      // Abgeschlossen: jüngste zuerst, auf Limit kürzen.
      const sichtbar = spalte.key === "abgeschlossen"
        ? [...alle].sort((a, b) => new Date(b.datum).getTime() - new Date(a.datum).getTime()).slice(0, ABGESCHLOSSEN_LIMIT)
        : alle;
      return { spalte, gesamt: alle.length, sichtbar };
    });
  }, [gruppen]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
      {spaltenDaten.map(({ spalte, gesamt, sichtbar }) => (
        <div
          key={spalte.key}
          className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm overflow-hidden flex flex-col"
        >
          {/* Spalten-Kopf mit Live-Zähler */}
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a]">
            <h2 className="font-black text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">{spalte.titel}</h2>
            <span
              aria-label={`${gesamt} Anfragen`}
              className="text-xs font-bold min-w-[28px] text-center px-2 py-0.5 rounded-full bg-[#0064d2]/10 text-[#0064d2] dark:text-[#45bdff]"
            >
              {gesamt}
            </span>
          </div>

          {/* Spalten-Körper */}
          <div className="flex-1 min-h-[160px] p-3 space-y-3">
            {sichtbar.length === 0 ? (
              <div className="h-full min-h-[120px] flex items-center justify-center text-center text-xs text-[#90939a] dark:text-[#6b6e73]">
                Keine Anfragen
              </div>
            ) : (
              <>
                {sichtbar.map((gruppe) => (
                  <GruppenKarte
                    key={gruppenKey(gruppe)}
                    gruppe={gruppe}
                    spalte={spalte.key}
                    flash={flashIds.has(gruppenKey(gruppe))}
                    ersteller={props.ersteller}
                    now={props.now}
                    canEdit={props.canEdit}
                    canDelete={props.canDelete}
                    isBusy={props.isBusy}
                    onUebernehmen={props.onUebernehmen}
                    onAlleErledigen={props.onAlleErledigen}
                    onZurueckgeben={props.onZurueckgeben}
                    onFreigeben={props.onFreigeben}
                    onEtikettDrucken={props.onEtikettDrucken}
                    onChat={props.onChat}
                    chatUngelesen={props.chatUngelesen}
                    onTeilErledigen={props.onTeilErledigen}
                    onTeilStornieren={props.onTeilStornieren}
                    onTeilNichtVerfuegbar={props.onTeilNichtVerfuegbar}
                    onTeilLoeschen={props.onTeilLoeschen}
                    onTeilReprint={props.onTeilReprint}
                  />
                ))}
                {spalte.key === "abgeschlossen" && gesamt > sichtbar.length && (
                  <div className="text-center text-xs text-[#65676b] dark:text-[#b0b3b8] pt-1">
                    + {gesamt - sichtbar.length} weitere
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

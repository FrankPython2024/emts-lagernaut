"use client";

import { useMemo, useState } from "react";
import { api } from "@/trpc/react";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/components/ui/Toast";
import { useStandortFilter } from "@/lib/standort/standortContext";

// ── Spendergeräte ────────────────────────────────────────────────────────────
//
// Komplette Geräte auf Lager, die später zerlegt werden. Zwei Fragen soll die
// Seite beantworten: Welche Geräte liegen wo — und steckt da noch das Teil
// drin, das gerade gebraucht wird.
//
// ⚠️ Erst das Zerlegen bucht. Bis dahin zählt nichts davon auf den Bestand.

// Wie viele Teile `einlagern.execute` pro Aufruf annimmt. Mehr wird in Pakete
// aufgeteilt — jedes bekommt seinen eigenen Beleg, die Buchungen bleiben korrekt.
const PRO_BUCHUNG = 13;

const STATUS_TEXT = {
  EINGELAGERT:       { label: "vollständig",       cls: "bg-[#04B475]/15 text-[#037A4F] dark:text-[#04B475]" },
  TEILWEISE_ZERLEGT: { label: "teilweise zerlegt", cls: "bg-[#f7b928]/18 text-[#8A5A00] dark:text-[#f7b928]" },
  ZERLEGT:           { label: "zerlegt",           cls: "bg-[#65676b]/15 text-[#65676b] dark:text-[#b0b3b8]" },
} as const;

const ZUSTAND_TEXT = {
  VORHANDEN:     { label: "ist drin",     icon: "✓", cls: "text-[#037A4F] dark:text-[#04B475]" },
  FEHLT_BEREITS: { label: "fehlte schon", icon: "—", cls: "text-[#8A5A00] dark:text-[#f7b928]" },
  ENTNOMMEN:     { label: "entnommen",    icon: "↗", cls: "text-[#65676b] dark:text-[#b0b3b8]" },
} as const;

const karte = "rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526]";
const eingabe = "px-3 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] min-h-[48px]";

function datum(d: Date | string): string {
  return new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function SpenderGeraetePage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfSehen   = has("ARTIKEL_VIEW");
  const darfPflegen = has("ARTIKEL_EINLAGERN");
  const { show } = useToast();
  // Kein aktiver Standort = „alle" in der Ansicht; fürs Buchen braucht es aber
  // einen konkreten. Standort 1 ist der Vorgabewert im Schema.
  const { activeStandortId } = useStandortFilter();

  const [suche, setSuche]   = useState("");
  const [status, setStatus] = useState<"" | "EINGELAGERT" | "TEILWEISE_ZERLEGT" | "ZERLEGT">("");
  const [offenId, setOffenId] = useState<number | null>(null);

  const liste = api.spenderGeraet.liste.useQuery(
    {
      suche:  suche.trim() || undefined,
      status: status || undefined,
    },
    { enabled: !permsLoading && darfSehen },
  );

  if (permsLoading) {
    return <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">Lade Berechtigungen…</div>;
  }
  if (!darfSehen) {
    return (
      <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">
        Kein Zugriff. Bitte das Recht <strong>ARTIKEL_VIEW</strong> bei der Rolle aktivieren.
      </div>
    );
  }

  const geraete = liste.data ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">🖥️ Spendergeräte</h1>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
          Ganze Geräte auf Lager, die später zerlegt werden. Die Teile darin zählen
          noch nicht auf den Bestand — erst das Entnehmen bucht sie ein.
        </p>
      </div>

      {/* ── Filter ──────────────────────────────────────────────────────── */}
      <div className={`${karte} p-4 flex gap-3 flex-wrap items-end`}>
        <label className="flex-1 min-w-[220px]">
          <span className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1">Suchen</span>
          <input value={suche} onChange={(e) => setSuche(e.target.value)}
            placeholder="LogID, Modell oder Lagerplatz…" className={`${eingabe} w-full`} />
        </label>
        <label>
          <span className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1">Zustand</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={eingabe}>
            <option value="">alle</option>
            <option value="EINGELAGERT">vollständig</option>
            <option value="TEILWEISE_ZERLEGT">teilweise zerlegt</option>
            <option value="ZERLEGT">zerlegt</option>
          </select>
        </label>
        <span className="text-sm text-[#65676b] dark:text-[#b0b3b8] pb-3">
          {liste.isFetching ? "…" : `${geraete.length} Gerät${geraete.length === 1 ? "" : "e"}`}
        </span>
      </div>

      {/* ── Liste ───────────────────────────────────────────────────────── */}
      {geraete.length === 0 && !liste.isFetching && (
        <div className="text-center py-16 text-[#65676b] dark:text-[#b0b3b8] border border-dashed border-[#ced4da] dark:border-[#3e4042] rounded-2xl">
          Noch kein Spendergerät erfasst. Der Weg dorthin führt über den
          Einlager-Assistenten → „Komplettes Gerät einlagern".
        </div>
      )}

      <div className="space-y-3">
        {geraete.map((g) => {
          const st = STATUS_TEXT[g.status];
          const offen = offenId === g.id;
          return (
            <div key={g.id} className={karte}>
              <button
                onClick={() => setOffenId(offen ? null : g.id)}
                className="w-full text-left px-5 py-4 flex items-center gap-4 flex-wrap min-h-[56px]"
              >
                <div className="flex-1 min-w-[200px]">
                  <div className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
                    {g.hersteller ? `${g.hersteller} ` : ""}{g.bezeichnung}
                  </div>
                  <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] font-mono">
                    {g.logId}
                    {g.lagerplatz && <span className="font-sans"> · 📍 {g.lagerplatz}</span>}
                  </div>
                </div>
                <span className="text-sm font-black text-[#1a1a1a] dark:text-[#e4e6eb]">
                  Grading {g.grading}
                </span>
                <span className={`text-xs font-black px-3 py-1 rounded-full ${st.cls}`}>{st.label}</span>
                <span className="text-sm text-[#65676b] dark:text-[#b0b3b8] tabular-nums">
                  <b className="text-[#1a1a1a] dark:text-[#e4e6eb]">{g.vorhanden}</b> von {g.gesamt} drin
                </span>
                <span className="text-[#65676b] dark:text-[#b0b3b8] font-black text-lg">{offen ? "−" : "+"}</span>
              </button>

              {offen && (
                <GeraetDetail
                  id={g.id}
                  darfPflegen={darfPflegen}
                  standortId={activeStandortId ?? 1}
                  onGeaendert={() => void liste.refetch()}
                  show={show}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Ein Gerät: Komponenten sehen und entnehmen ───────────────────────────────

function GeraetDetail({
  id, darfPflegen, standortId, onGeaendert, show,
}: {
  id: number;
  darfPflegen: boolean;
  standortId: number;
  onGeaendert: () => void;
  show: (m: string, t?: "success" | "error" | "info" | "warning") => void;
}) {
  const details = api.spenderGeraet.details.useQuery({ id });
  const einbuchen = api.einlagern.execute.useMutation();
  const abhaken   = api.spenderGeraet.komponentenEntnommen.useMutation();

  const [gewaehlt, setGewaehlt] = useState<Set<string>>(new Set());
  const [lagerplatz, setLagerplatz] = useState("");
  const [laeuft, setLaeuft] = useState(false);

  const g = details.data;
  const entnehmbar = useMemo(
    () => (g?.komponenten ?? []).filter((k) => k.zustand === "VORHANDEN"),
    [g],
  );

  if (details.isLoading) {
    return <div className="px-5 pb-4 text-sm text-[#65676b] dark:text-[#b0b3b8]">Wird geladen…</div>;
  }
  if (!g) return null;

  function umschalten(teiltyp: string) {
    setGewaehlt((v) => {
      const n = new Set(v);
      if (n.has(teiltyp)) n.delete(teiltyp); else n.add(teiltyp);
      return n;
    });
  }

  /**
   * Entnehmen: erst buchen, dann abhaken.
   *
   * ⚠️ Reihenfolge ist Absicht. Schlägt das Buchen fehl, bleibt das Gerät
   * unverändert — lieber ein nicht abgehaktes Teil als ein abgehaktes, das
   * nirgends im Bestand steht.
   */
  async function entnehmen() {
    if (!g || gewaehlt.size === 0) return;
    const teiltypen = [...gewaehlt];
    setLaeuft(true);
    try {
      // In Pakete teilen — `execute` nimmt maximal 13 Teile pro Aufruf.
      for (let i = 0; i < teiltypen.length; i += PRO_BUCHUNG) {
        const teil = teiltypen.slice(i, i + PRO_BUCHUNG);
        await einbuchen.mutateAsync({
          geraetName: `${g.hersteller ? `${g.hersteller} ` : ""}${g.bezeichnung}`,
          logId:      g.logId,
          standortId,
          herkunftArt: "SPENDER",
          items: teil.map((t) => ({
            teiltyp:    t,
            menge:      1,
            grading:    g.grading,
            lagerplatz: lagerplatz.trim() || undefined,
            notiz:      `Aus Spendergerät ${g.logId}`,
          })),
        });
      }
      const r = await abhaken.mutateAsync({ id: g.id, teiltypen });
      show(`✅ ${r.entnommen} Teil${r.entnommen === 1 ? "" : "e"} eingebucht`, "success");
      setGewaehlt(new Set());
      await details.refetch();
      onGeaendert();
    } catch (e) {
      show(e instanceof Error ? e.message : "Entnehmen fehlgeschlagen", "error");
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <div className="px-5 pb-5 pt-1 border-t border-[#ced4da] dark:border-[#3e4042] space-y-4">
      {g.notiz && (
        <div className="text-sm text-[#65676b] dark:text-[#b0b3b8] bg-[#f0f2f5] dark:bg-[#18191a] rounded-lg px-3 py-2">
          📝 {g.notiz}
        </div>
      )}
      <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
        Eingelagert am {datum(g.erfasstAm)} von {g.erfasstVon}
        {g.zerlegtAm && <> · vollständig zerlegt am {datum(g.zerlegtAm)}</>}
      </div>

      {/* ── Komponenten ───────────────────────────────────────────────── */}
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        {g.komponenten.map((k) => {
          const z = ZUSTAND_TEXT[k.zustand];
          const waehlbar = darfPflegen && k.zustand === "VORHANDEN";
          const an = gewaehlt.has(k.teiltyp);
          return (
            <label key={k.id}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg border min-h-[48px] ${
                waehlbar ? "cursor-pointer" : "opacity-70"
              } ${an ? "border-[#0064d2] bg-[#0064d2]/6" : "border-[#ced4da] dark:border-[#3e4042]"}`}>
              {waehlbar ? (
                <input type="checkbox" checked={an} onChange={() => umschalten(k.teiltyp)}
                  className="w-5 h-5 accent-[#0064d2] shrink-0" />
              ) : (
                <span className={`w-5 text-center font-black ${z.cls}`} aria-hidden>{z.icon}</span>
              )}
              <span className="min-w-0">
                <span className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] truncate">{k.teiltyp}</span>
                {/* Zustand immer als Wort, nie nur als Farbe. */}
                <span className={`block text-xs font-bold ${z.cls}`}>
                  {z.label}
                  {k.entnommenAm && <> · {datum(k.entnommenAm)}{k.entnommenVon ? ` · ${k.entnommenVon}` : ""}</>}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      {/* ── Entnehmen ─────────────────────────────────────────────────── */}
      {darfPflegen && entnehmbar.length > 0 && (
        <div className="rounded-xl border-2 border-[#04B475]/40 bg-[#04B475]/5 p-4 space-y-3">
          <div className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
            Teile entnehmen und einbuchen
          </div>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
            Ausgewählte Teile werden als Bauteil-Ernte eingebucht — mit diesem Gerät
            als Spender und Grading {g.grading}. Danach sind sie hier abgehakt.
          </p>
          <div className="flex gap-3 flex-wrap items-end">
            <label className="flex-1 min-w-[200px]">
              <span className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1">
                Lagerplatz der Teile (optional)
              </span>
              <input value={lagerplatz} onChange={(e) => setLagerplatz(e.target.value)}
                placeholder={g.lagerplatz ?? "z. B. ETL-9-3-2"} className={`${eingabe} w-full`} />
            </label>
            <button
              onClick={() => void entnehmen()}
              disabled={gewaehlt.size === 0 || laeuft}
              className="px-6 py-3 rounded-xl bg-[#037A4F] text-white font-bold text-base min-h-[56px] disabled:opacity-50">
              {laeuft ? "Wird gebucht…" : `${gewaehlt.size} Teil${gewaehlt.size === 1 ? "" : "e"} entnehmen`}
            </button>
          </div>
          {gewaehlt.size > PRO_BUCHUNG && (
            <p className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
              Wird in {Math.ceil(gewaehlt.size / PRO_BUCHUNG)} Buchungen aufgeteilt —
              jede bekommt einen eigenen Beleg.
            </p>
          )}
        </div>
      )}

      {entnehmbar.length === 0 && (
        <div className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
          Aus diesem Gerät ist nichts mehr zu holen.
        </div>
      )}
    </div>
  );
}

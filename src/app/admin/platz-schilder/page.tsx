"use client";

// ── Platz-Schilder für ORGATEX ET300 (02.10.2026) ─────────────────────────────
// Plätze frei als Liste eingeben, je Platz ein Einsteckschild 38 × 100 mm mit
// QR-Code (= genau der Platzname). 14 Schilder je A4-Bogen.
// Regeln: src/lib/lager/platzSchilder.ts · Druck: src/lib/print/et300.ts.
// Ansehen/Drucken LAGERPLATZ_VIEW, ändern LAGERPLATZ_EDIT.

import { useEffect, useMemo, useState } from "react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { usePermissions } from "@/hooks/usePermissions";
import { ET300_JE_BOGEN, boegenFuer, lesePlatzListe, MAX_BESCHREIBUNG, MAX_CODE, type PlatzEingabe } from "@/lib/lager/platzSchilder";
import { printEt300 } from "@/lib/print/et300";

const karte = "bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm";
const feld = "w-full px-3 rounded-lg border-2 border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] min-h-[56px]";
const knopf = "inline-flex items-center justify-center gap-2 px-4 rounded-xl text-sm font-bold min-h-[56px] disabled:opacity-50";
const blau = `${knopf} bg-[#0064d2] text-white`;
const grau = `${knopf} border-2 border-[#ced4da] dark:border-[#3e4042] text-[#1a1a1a] dark:text-[#e4e6eb] bg-white dark:bg-[#18191a]`;
const leise = "text-[#65676b] dark:text-[#b0b3b8]";
// v2: Seit dem Raster mit 9 mm oben (02.10.2026) wäre der alte Ausgleich von −6,5 mm doppelt.
const EINSTELLUNG = "platz-schilder-druck-v2";

type Druck = { versatzX: number; versatzY: number };

function ladeDruck(): Druck {
  try {
    const d = JSON.parse(localStorage.getItem(EINSTELLUNG) ?? "{}") as Partial<Druck>;
    return { versatzX: Number(d.versatzX) || 0, versatzY: Number(d.versatzY) || 0 };
  } catch { return { versatzX: 0, versatzY: 0 }; }
}

export default function PlatzSchilderPage() {
  const { has, isLoading: rechteLaden } = usePermissions();
  const darfAnsehen = has("LAGERPLATZ_VIEW");
  const darfPflegen = has("LAGERPLATZ_EDIT");
  const { show } = useToast();
  const utils = api.useUtils();
  const q = api.platzSchilder.liste.useQuery(undefined, { enabled: darfAnsehen });

  const [text, setText] = useState("");
  const [suche, setSuche] = useState("");
  const [auswahl, setAuswahl] = useState<Set<number>>(new Set());
  const [start, setStart] = useState(1);
  const [druck, setDruck] = useState<Druck>({ versatzX: 0, versatzY: 0 });
  const [bearbeiten, setBearbeiten] = useState<{ id: number; code: string; beschreibung: string } | null>(null);
  const [loeschFrage, setLoeschFrage] = useState<number[] | null>(null);

  useEffect(() => { setDruck(ladeDruck()); }, []);
  const druckSetzen = (d: Druck) => {
    setDruck(d);
    try { localStorage.setItem(EINSTELLUNG, JSON.stringify(d)); } catch { /* egal */ }
  };

  const gelesen = useMemo(() => lesePlatzListe(text), [text]);
  const liste = q.data ?? [];
  const sichtbar = useMemo(() => {
    const s = suche.trim().toLowerCase();
    return s ? liste.filter((p) => p.code.toLowerCase().includes(s) || (p.beschreibung ?? "").toLowerCase().includes(s)) : liste;
  }, [liste, suche]);
  // Gelöschte fallen aus der Auswahl
  const gewaehlt = liste.filter((p) => auswahl.has(p.id));

  const anlegen = api.platzSchilder.anlegen.useMutation({
    onSuccess: async (r) => {
      show(`✅ ${r.neu} neu${r.schonDa ? ` · ${r.schonDa} schon vorhanden` : ""}${r.geaendert ? ` · ${r.geaendert} Beschreibung geändert` : ""} — zum Drucken ausgewählt`, "success");
      setText("");
      setAuswahl(new Set(r.ids));
      await utils.platzSchilder.liste.invalidate();
    },
    onError: (e) => show(e.message, "error"),
  });
  const aendern = api.platzSchilder.aendern.useMutation({
    onSuccess: async () => { show("✅ Gespeichert", "success"); setBearbeiten(null); await utils.platzSchilder.liste.invalidate(); },
    onError: (e) => show(e.message, "error"),
  });
  const loeschen = api.platzSchilder.loeschen.useMutation({
    onSuccess: async (r) => {
      show(`${r.anzahl} gelöscht`, "success");
      setLoeschFrage(null);
      setAuswahl(new Set());
      await utils.platzSchilder.liste.invalidate();
    },
    onError: (e) => show(e.message, "error"),
  });
  const gedruckt = api.platzSchilder.gedrucktMarkieren.useMutation({
    onSuccess: () => utils.platzSchilder.liste.invalidate(),
  });

  const drucken = (plaetze: PlatzEingabe[], rahmen: boolean, ids: number[]) => {
    // printEt300 öffnet das Fenster vor dem ersten await — bleibt also im Klick.
    void printEt300(plaetze, { start, versatzXMm: druck.versatzX, versatzYMm: druck.versatzY, rahmen }).then((ok) => {
      if (!ok) { show("Das Druckfenster wurde blockiert — bitte Pop-ups für Lagernaut erlauben.", "error"); return; }
      if (ids.length) gedruckt.mutate({ ids });
    });
  };

  if (rechteLaden) return <div className={`p-8 text-center text-sm ${leise}`}>Lade Berechtigungen…</div>;
  if (!darfAnsehen) {
    return (
      <div className={`p-8 text-center text-sm ${leise}`}>
        Kein Zugriff. Bitte das Recht <strong>LAGERPLATZ_VIEW</strong> bei der Rolle aktivieren.
      </div>
    );
  }

  const alleSichtbarGewaehlt = sichtbar.length > 0 && sichtbar.every((p) => auswahl.has(p.id));
  const boegen = boegenFuer(gewaehlt.length, start);

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <h1 className="text-xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">🏷️ Platz-Schilder (ORGATEX ET300)</h1>
        <p className={`text-sm mt-1 max-w-2xl ${leise}`}>
          Lagerplätze eintragen und Einsteckschilder mit QR-Code drucken. Der QR-Code enthält genau den Namen des
          Platzes. Ein Bogen ET300 hat 14 Schilder (38 × 100 mm).
        </p>
      </div>

      {darfPflegen && (
        <section className={`${karte} p-4 space-y-3`} aria-labelledby="eingabe-titel">
          <h2 id="eingabe-titel" className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Plätze eintragen</h2>
          <p className={`text-sm ${leise}`}>
            Ein Platz pro Zeile. Eine Beschreibung kommt nach einem Semikolon (oder aus Excel kopiert in die zweite
            Spalte). Viele Plätze auf einmal mit <strong>„bis“</strong>.
          </p>
          <pre className={`text-xs rounded-lg p-3 bg-[#f0f2f5] dark:bg-[#18191a] ${leise} whitespace-pre-wrap`}>{`HL-07-01
HL-07-02; Lenovo Akkus
ETL-1-1-1 bis ETL-1-1-4
R-01 bis R-30; Regal Wareneingang`}</pre>
          <label htmlFor="platz-liste" className="sr-only">Liste der Plätze</label>
          <textarea id="platz-liste" value={text} onChange={(e) => setText(e.target.value)} rows={7}
            className={`${feld} py-2 font-mono text-sm`} placeholder="Plätze hier eintragen oder einfügen…" />
          <div className="flex items-center gap-3 flex-wrap">
            <button type="button" className={blau} disabled={gelesen.plaetze.length === 0 || anlegen.isPending}
              onClick={() => anlegen.mutate({ plaetze: gelesen.plaetze })}>
              {anlegen.isPending ? "Speichere…" : `＋ ${gelesen.plaetze.length} ${gelesen.plaetze.length === 1 ? "Platz" : "Plätze"} übernehmen`}
            </button>
            {gelesen.plaetze.length > 0 && (
              <span className={`text-sm ${leise}`}>
                {gelesen.plaetze.slice(0, 4).map((p) => p.code).join(", ")}{gelesen.plaetze.length > 4 ? ` … ${gelesen.plaetze[gelesen.plaetze.length - 1]!.code}` : ""}
              </span>
            )}
          </div>
          {gelesen.fehler.length > 0 && (
            <ul className="text-sm font-semibold text-[#c01818] dark:text-[#ff8a8a] list-disc pl-5" role="alert">
              {gelesen.fehler.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          )}
        </section>
      )}

      <section className={`${karte} p-4 space-y-4`} aria-labelledby="druck-titel">
        <h2 id="druck-titel" className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Drucken</h2>
        <div className="flex gap-6 flex-wrap">
          <div>
            <div className="text-sm font-semibold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Erstes freies Feld auf dem Bogen</div>
            <p className={`text-xs mb-2 max-w-[16rem] ${leise}`}>Für angebrochene Bögen: Feld antippen, ab dem gedruckt wird. Grau = schon benutzt.</p>
            <div className="grid grid-cols-2 gap-1 w-[11rem] p-2 rounded-lg bg-[#f0f2f5] dark:bg-[#18191a]" role="group" aria-label="Startfeld wählen">
              {Array.from({ length: ET300_JE_BOGEN }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" onClick={() => setStart(n)} aria-pressed={start === n}
                  aria-label={`Ab Feld ${n} drucken`}
                  className={`h-8 rounded text-xs font-bold border-2 ${n === start
                    ? "bg-[#0064d2] border-[#0064d2] text-white"
                    : n < start
                      ? "bg-[#ced4da] dark:bg-[#3e4042] border-transparent text-[#65676b] dark:text-[#b0b3b8] line-through"
                      : "bg-white dark:bg-[#242526] border-[#ced4da] dark:border-[#3e4042] text-[#1a1a1a] dark:text-[#e4e6eb]"}`}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-3 flex-1 min-w-[16rem]">
            <div>
              <div className="text-sm font-semibold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Feinjustierung (mm)</div>
              <p className={`text-xs mb-2 ${leise}`}>
                Nur nötig, wenn der Probedruck nicht genau trifft. Plus = nach rechts bzw. unten. Wird an diesem PC gemerkt.
              </p>
              <div className="flex gap-3">
                {(["versatzX", "versatzY"] as const).map((k) => (
                  <label key={k} className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
                    {k === "versatzX" ? "→ seitlich" : "↓ hoch/runter"}
                    <input type="number" step={0.5} min={-15} max={15} value={druck[k]} inputMode="decimal"
                      onChange={(e) => druckSetzen({ ...druck, [k]: Math.max(-15, Math.min(15, Number(e.target.value) || 0)) })}
                      className={`${feld} w-28 mt-1`} />
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button type="button" className={blau} disabled={gewaehlt.length === 0}
                onClick={() => drucken(gewaehlt, false, gewaehlt.map((p) => p.id))}>
                🖨️ {gewaehlt.length} {gewaehlt.length === 1 ? "Schild" : "Schilder"} drucken{gewaehlt.length > 0 ? ` (${boegen} ${boegen === 1 ? "Bogen" : "Bögen"})` : ""}
              </button>
              <button type="button" className={grau}
                onClick={() => drucken(
                  gewaehlt.length > 0
                    ? gewaehlt.slice(0, ET300_JE_BOGEN - start + 1)
                    : Array.from({ length: ET300_JE_BOGEN - start + 1 }, (_, i) => ({ code: `PROBE-${String(i + start).padStart(2, "0")}`, beschreibung: "Probedruck" })),
                  true, [])}>
                📄 Probeblatt auf Normalpapier
              </button>
            </div>
            <p className={`text-xs ${leise}`}>
              Im Druckfenster <strong>„Tatsächliche Größe“ bzw. Skalierung 100 %</strong> und <strong>Ränder: Keine</strong> wählen.
              Erst das Probeblatt auf Normalpapier drucken und gegen einen ET300-Bogen ans Licht halten — die
              gestrichelten Rahmen müssen auf den Perforationen liegen.
            </p>
          </div>
        </div>
      </section>

      <section className={`${karte} p-4 space-y-3`} aria-labelledby="liste-titel">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 id="liste-titel" className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
            Plätze <span className={`font-normal ${leise}`}>({liste.length}{auswahl.size ? ` · ${gewaehlt.length} ausgewählt` : ""})</span>
          </h2>
          <div className="flex gap-2 flex-wrap">
            {gewaehlt.length > 0 && (
              <button type="button" className={grau} onClick={() => setAuswahl(new Set())}>Auswahl aufheben</button>
            )}
            {darfPflegen && gewaehlt.length > 0 && (
              <button type="button" className={`${knopf} bg-[#c01818] text-white`} onClick={() => setLoeschFrage(gewaehlt.map((p) => p.id))}>
                🗑 {gewaehlt.length} löschen
              </button>
            )}
          </div>
        </div>
        {liste.length > 6 && (
          <>
            <label htmlFor="platz-suche" className="sr-only">Plätze durchsuchen</label>
            <input id="platz-suche" value={suche} onChange={(e) => setSuche(e.target.value)} className={feld}
              placeholder="Suchen (Platz oder Beschreibung)…" />
          </>
        )}
        {q.isLoading ? (
          <p className={`text-sm ${leise}`}>Lade…</p>
        ) : q.isError ? (
          <p className="text-sm font-semibold text-[#c01818] dark:text-[#ff8a8a]" role="alert">
            Liste konnte nicht geladen werden. <button type="button" className="underline" onClick={() => void q.refetch()}>Erneut versuchen</button>
          </p>
        ) : liste.length === 0 ? (
          <p className={`text-sm ${leise}`}>Noch keine Plätze eingetragen.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={`text-left ${leise} border-b border-[#ced4da] dark:border-[#3e4042]`}>
                  <th className="py-2 pr-2 w-14">
                    <input type="checkbox" className="w-6 h-6 accent-[#0064d2]" checked={alleSichtbarGewaehlt}
                      aria-label={alleSichtbarGewaehlt ? "Keine wählen" : "Alle angezeigten wählen"}
                      onChange={() => setAuswahl((alt) => {
                        const neu = new Set(alt);
                        for (const p of sichtbar) { if (alleSichtbarGewaehlt) neu.delete(p.id); else neu.add(p.id); }
                        return neu;
                      })} />
                  </th>
                  <th className="py-2 pr-3">Platz</th>
                  <th className="py-2 pr-3">Beschreibung</th>
                  <th className="py-2 pr-3">Gedruckt</th>
                  {darfPflegen && <th className="py-2"><span className="sr-only">Aktionen</span></th>}
                </tr>
              </thead>
              <tbody>
                {sichtbar.map((p) => (
                  <tr key={p.id} className="border-b border-[#ced4da]/60 dark:border-[#3e4042]/60 text-[#1a1a1a] dark:text-[#e4e6eb]">
                    <td className="py-1 pr-2">
                      <label className="inline-flex items-center justify-center min-w-[48px] min-h-[48px] cursor-pointer">
                        <input type="checkbox" className="w-6 h-6 accent-[#0064d2]" checked={auswahl.has(p.id)}
                          aria-label={`${p.code} auswählen`}
                          onChange={() => setAuswahl((alt) => {
                            const neu = new Set(alt);
                            if (neu.has(p.id)) neu.delete(p.id); else neu.add(p.id);
                            return neu;
                          })} />
                      </label>
                    </td>
                    <td className="py-1 pr-3 font-mono font-bold">{p.code}</td>
                    <td className="py-1 pr-3">{p.beschreibung ?? <span className={leise}>—</span>}</td>
                    <td className={`py-1 pr-3 whitespace-nowrap ${leise}`}>
                      {p.gedrucktAm ? new Date(p.gedrucktAm).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" }) : "noch nie"}
                    </td>
                    {darfPflegen && (
                      <td className="py-1 text-right whitespace-nowrap">
                        <button type="button" className={`${grau} min-h-[48px]`} aria-label={`${p.code} ändern`}
                          onClick={() => setBearbeiten({ id: p.id, code: p.code, beschreibung: p.beschreibung ?? "" })}>
                          ✏️
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {sichtbar.length === 0 && <p className={`text-sm py-3 ${leise}`}>Kein Platz passt zur Suche.</p>}
          </div>
        )}
      </section>

      <Modal open={!!bearbeiten} onClose={() => setBearbeiten(null)} title="Platz ändern">
        {bearbeiten && (
          <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault();
            aendern.mutate({ id: bearbeiten.id, code: bearbeiten.code.trim().replace(/\s+/g, " "), beschreibung: bearbeiten.beschreibung.trim() || null });
          }}>
            <label className="block text-sm font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">
              Platz (steht so im QR-Code)
              <input value={bearbeiten.code} maxLength={MAX_CODE} className={`${feld} mt-1 font-mono`}
                onChange={(e) => setBearbeiten({ ...bearbeiten, code: e.target.value })} />
            </label>
            <label className="block text-sm font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">
              Beschreibung (freiwillig)
              <input value={bearbeiten.beschreibung} maxLength={MAX_BESCHREIBUNG} className={`${feld} mt-1`}
                onChange={(e) => setBearbeiten({ ...bearbeiten, beschreibung: e.target.value })} />
            </label>
            <p className={`text-xs ${leise}`}>Wird der Platz umbenannt, muss das Schild neu gedruckt werden.</p>
            <div className="flex justify-between gap-2 flex-wrap">
              <button type="button" className={`${knopf} border-2 border-[#c01818] text-[#c01818] dark:text-[#ff8a8a]`}
                onClick={() => { setLoeschFrage([bearbeiten.id]); setBearbeiten(null); }}>
                🗑 Löschen
              </button>
              <div className="flex gap-2">
                <button type="button" className={grau} onClick={() => setBearbeiten(null)}>Abbrechen</button>
                <button type="submit" className={blau} disabled={!bearbeiten.code.trim() || aendern.isPending}>Speichern</button>
              </div>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!loeschFrage} onClose={() => setLoeschFrage(null)} title="Plätze löschen?">
        {loeschFrage && (
          <div className="space-y-4">
            <p className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
              {loeschFrage.length === 1 ? "Dieser Platz wird" : `${loeschFrage.length} Plätze werden`} aus der Liste
              genommen. Gedruckte Schilder bleiben gültig — der QR-Code enthält nur den Namen.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className={grau} onClick={() => setLoeschFrage(null)}>Abbrechen</button>
              <button type="button" className={`${knopf} bg-[#c01818] text-white`} disabled={loeschen.isPending}
                onClick={() => loeschen.mutate({ ids: loeschFrage })}>
                Löschen
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

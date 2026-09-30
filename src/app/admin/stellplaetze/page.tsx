"use client";

// ── Besondere Stellplätze pflegen (30.09.2026) ────────────────────────────────
// Was bedeutet „ETL-0-4-0"? Die Beschreibung erscheint überall, wo der Platz
// steht (Teilespender, Pickup, Sortierhilfe, Lagerfuchs). Erstbefüllung aus
// Franks Stellplatz-Aushang; hier änderbar. Regeln: src/lib/lager/stellplaetze.ts.
// Ansehen LAGERPLATZ_VIEW, ändern LAGERPLATZ_EDIT.

import { useState } from "react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { usePermissions } from "@/hooks/usePermissions";
import { normStellplatz } from "@/lib/lager/stellplaetze";

type Entwurf = { id?: number; code: string; kurz: string; text: string; ausserhalb: boolean };

const karte = "bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm";
const feld = "w-full px-3 rounded-lg border-2 border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] min-h-[48px]";
const knopf = "inline-flex items-center justify-center px-4 rounded-xl text-sm font-bold min-h-[48px] disabled:opacity-50";
const nf = (n: number) => n.toLocaleString("de-DE");

export default function StellplaetzePage() {
  const { has, isLoading: rechteLaden } = usePermissions();
  const darfAnsehen = has("LAGERPLATZ_VIEW");
  const darfPflegen = has("LAGERPLATZ_EDIT");
  const { show } = useToast();
  const utils = api.useUtils();
  const q = api.stellplatzInfo.uebersicht.useQuery(undefined, { enabled: darfAnsehen });

  const [entwurf, setEntwurf] = useState<Entwurf | null>(null);
  const [loeschen, setLoeschen] = useState<{ id: number; code: string } | null>(null);

  const neuLaden = async () => {
    await Promise.all([utils.stellplatzInfo.uebersicht.invalidate(), utils.stellplatzInfo.liste.invalidate()]);
  };
  const speichern = api.stellplatzInfo.speichern.useMutation({
    onSuccess: async (r) => { show(`✅ ${r.code} gespeichert`, "success"); setEntwurf(null); await neuLaden(); },
    onError: (e) => show(e.message, "error"),
  });
  const entfernen = api.stellplatzInfo.loeschen.useMutation({
    onSuccess: async () => { show("Eintrag gelöscht", "success"); setLoeschen(null); await neuLaden(); },
    onError: (e) => show(e.message, "error"),
  });

  if (rechteLaden) return <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">Lade Berechtigungen…</div>;
  if (!darfAnsehen) {
    return (
      <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">
        Kein Zugriff. Bitte das Recht <strong>LAGERPLATZ_VIEW</strong> bei der Rolle aktivieren.
      </div>
    );
  }

  const eintraege = q.data?.eintraege ?? [];
  const codeVorschau = entwurf ? normStellplatz(entwurf.code) : "";
  const entwurfOk = !!entwurf && codeVorschau !== "" && entwurf.kurz.trim() !== "" && entwurf.text.trim() !== "";

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">📍 Stellplätze</h1>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1 max-w-2xl">
            Was bedeutet ein besonderer Stellplatz? Die Beschreibung steht überall dabei, wo der Platz angezeigt wird:
            Teilespender, Pickup am Handgerät, Sortierhilfe und Lagerfuchs.
          </p>
        </div>
        {darfPflegen && (
          <button type="button" className={`${knopf} bg-[#008BD2] text-white`}
            onClick={() => setEntwurf({ code: "", kurz: "", text: "", ausserhalb: false })}>
            ＋ Neuer Stellplatz
          </button>
        )}
      </div>

      <div className={`${karte} p-4 text-sm text-[#1a1a1a] dark:text-[#e4e6eb]`}>
        <strong>Schreibweise:</strong> Die Lagernummer davor ist egal. „120-ETL-0-4-0“ und „ETL-0-4-0“ sind derselbe
        Platz, gespeichert wird ohne. <strong>„Außerhalb EMTS“</strong> hebt den Platz überall deutlich hervor.
      </div>

      {q.isLoading ? (
        <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">Lade …</div>
      ) : q.isError ? (
        <div role="alert" className="rounded-xl bg-[#fa3e3e]/10 px-4 py-3 text-sm text-[#c01818] dark:text-[#ff6b6b]">
          Laden fehlgeschlagen: {q.error.message}{" "}
          <button type="button" className="underline font-bold" onClick={() => void q.refetch()}>Erneut versuchen</button>
        </div>
      ) : (
        <div className={`${karte} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[#65676b] dark:text-[#b0b3b8] border-b border-[#ced4da] dark:border-[#3e4042]">
                <th className="px-4 py-3">Stellplatz</th>
                <th className="px-4 py-3">Kurzform</th>
                <th className="px-4 py-3">Beschreibung</th>
                <th className="px-4 py-3 text-right">Geräte*</th>
                {darfPflegen && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {eintraege.map((b) => (
                <tr key={b.id} className="border-b last:border-b-0 border-[#eef0f2] dark:border-[#3e4042] align-top">
                  <td className="px-4 py-3 font-mono font-black text-[#202F61] dark:text-[#e4e6eb] whitespace-nowrap">{b.code}</td>
                  <td className="px-4 py-3 font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">{b.kurz}</td>
                  <td className="px-4 py-3 text-[#1a1a1a] dark:text-[#e4e6eb]">
                    {b.ausserhalb && (
                      <span className="inline-block mr-1.5 mb-0.5 rounded-md border-2 border-[#008BD2] px-1.5 text-xs font-black text-[#005a8c] dark:text-[#7cc8f0]">
                        Außerhalb EMTS
                      </span>
                    )}
                    {b.text}
                    <div className="text-[11px] text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
                      {b.geaendertVon ? `zuletzt: ${b.geaendertVon}, ` : ""}
                      {new Date(b.updatedAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{nf(b.geraete)}</td>
                  {darfPflegen && (
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button type="button" className={`${knopf} border border-[#ced4da] dark:border-[#3e4042] text-[#202F61] dark:text-[#e4e6eb]`}
                        onClick={() => setEntwurf({ id: b.id, code: b.code, kurz: b.kurz, text: b.text, ausserhalb: b.ausserhalb })}>
                        Ändern
                      </button>{" "}
                      <button type="button" className={`${knopf} text-[#c01818] dark:text-[#ff6b6b]`}
                        onClick={() => setLoeschen({ id: b.id, code: b.code })}>
                        Löschen
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-xs text-[#65676b] dark:text-[#b0b3b8]">
            * Geräte auf diesem Platz laut letztem Lagerfuchs-Import.
          </p>
        </div>
      )}

      {/* Plätze mit Geräten, aber ohne Beschreibung — z. B. ETL-0-0-0 */}
      {(q.data?.vorschlaege.length ?? 0) > 0 && (
        <div className={`${karte} p-4 space-y-2`}>
          <div className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Noch ohne Beschreibung</div>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Diese Sonderplätze haben Geräte, aber keine Bedeutung eingetragen.</p>
          <div className="flex flex-wrap gap-2">
            {q.data!.vorschlaege.map((v) => (
              <button key={v.code} type="button" disabled={!darfPflegen}
                className={`${knopf} border-2 border-dashed border-[#ced4da] dark:border-[#3e4042] text-[#202F61] dark:text-[#e4e6eb] font-mono`}
                onClick={() => setEntwurf({ code: v.code, kurz: "", text: "", ausserhalb: false })}>
                {v.code} <span className="ml-2 font-sans font-semibold text-[#65676b] dark:text-[#b0b3b8]">{nf(v.geraete)} Geräte</span>
                {darfPflegen && <span className="ml-2 font-sans">＋</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Anlegen / Ändern */}
      <Modal open={!!entwurf} onClose={() => setEntwurf(null)} title={entwurf?.id ? "Stellplatz ändern" : "Neuer Stellplatz"}>
        {entwurf && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (entwurfOk) speichern.mutate({ ...entwurf }); }}>
            <label className="block">
              <span className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Stellplatz</span>
              <input className={`${feld} font-mono`} value={entwurf.code} autoFocus={!entwurf.id} placeholder="z. B. 120-ETL-0-4-0"
                onChange={(e) => setEntwurf({ ...entwurf, code: e.target.value })} />
              {entwurf.code.trim() && codeVorschau !== entwurf.code.trim() && (
                <span className="block text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1">Gespeichert als <b className="font-mono">{codeVorschau}</b></span>
              )}
            </label>
            <label className="block">
              <span className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">
                Kurzform <span className="font-normal text-[#65676b] dark:text-[#b0b3b8]">(für enge Stellen, max. 40 Zeichen)</span>
              </span>
              <input className={feld} value={entwurf.kurz} maxLength={40} placeholder="z. B. Abholwagen / QS"
                onChange={(e) => setEntwurf({ ...entwurf, kurz: e.target.value })} />
            </label>
            <label className="block">
              <span className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Beschreibung</span>
              <textarea className={`${feld} py-2`} rows={2} value={entwurf.text} maxLength={300}
                placeholder="z. B. EMTS-Abholwagen, Unterlagenschrank (Schrank 8) und QS Colli"
                onChange={(e) => setEntwurf({ ...entwurf, text: e.target.value })} />
            </label>
            <label className="flex items-start gap-3 cursor-pointer min-h-[44px]">
              <input type="checkbox" className="mt-1 w-5 h-5 accent-[#008BD2]" checked={entwurf.ausserhalb}
                onChange={(e) => setEntwurf({ ...entwurf, ausserhalb: e.target.checked })} />
              <span className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
                <b>Außerhalb EMTS</b>
                <span className="block text-xs text-[#65676b] dark:text-[#b0b3b8]">Wird überall deutlich hervorgehoben — dorthin ist es ein eigener Weg.</span>
              </span>
            </label>
            <div className="flex gap-3 pt-1">
              <button type="button" className={`${knopf} flex-1 border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8]`} onClick={() => setEntwurf(null)}>
                Abbrechen
              </button>
              <button type="submit" disabled={!entwurfOk || speichern.isPending} className={`${knopf} flex-1 bg-[#037A4F] text-white`}>
                {speichern.isPending ? "Speichert …" : "Speichern"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!loeschen} onClose={() => setLoeschen(null)} title="Eintrag löschen?">
        <p className="text-base text-[#1a1a1a] dark:text-[#e4e6eb] mb-4">
          <b className="font-mono">{loeschen?.code}</b> zeigt danach nirgends mehr eine Beschreibung. Die Geräte selbst
          bleiben, wo sie sind.
        </p>
        {eintraege.length === 1 && (
          <p className="text-sm text-[#8A5A00] dark:text-[#f7b928] mb-4">
            Das ist der letzte Eintrag. Eine ganz leere Liste wird beim nächsten Öffnen wieder mit dem Aushang befüllt.
          </p>
        )}
        <div className="flex gap-3">
          <button type="button" className={`${knopf} flex-1 border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8]`} onClick={() => setLoeschen(null)}>
            Abbrechen
          </button>
          <button type="button" disabled={entfernen.isPending} className={`${knopf} flex-1 bg-[#c01818] text-white`}
            onClick={() => loeschen && entfernen.mutate({ id: loeschen.id })}>
            Löschen
          </button>
        </div>
      </Modal>
    </div>
  );
}

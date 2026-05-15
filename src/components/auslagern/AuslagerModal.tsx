"use client";
import { useState, useEffect } from "react";
import FocusTrap from "focus-trap-react";
import { api } from "@/trpc/react";
import { printMehrereAuslagerBelege, type AuslagerBelegData } from "@/components/ui/AuslagerBeleg";

// ── Typen ─────────────────────────────────────────────────────────────────────

type Teil = {
  teilId:         number;
  teiltyp:        string;
  artikelName:    string;
  menge:          number;
  verfuegbar:     boolean;
  bestand:        number;
  lagerplatzCode: string | null;
  grading:        string | null;
  status:         string;
};

export type AuslagerResult = {
  ausgabe: {
    anfrageId:    number;
    artikel:      string;
    kategorie:    string;
    lagerplatz:   string | null;
    menge:        number;
    neuerBestand: number;
    techniker:    string;
    logId:        string;
    geraeteName:  string | null;
    grading:      string | null;
  }[];
  ausgefuehrtVon: string;
  datum:          Date;
};

type Props = {
  anfrageIds:   number[];
  gruppenLabel: string;
  onClose:      () => void;
  onSuccess?:   (result: AuslagerResult) => void;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function gradingColor(g?: string | null): string {
  if (g === "A+" || g === "A") return "#04b475";
  if (g === "B") return "#008bd2";
  if (g === "C") return "#F59E0B";
  return "#94A3B8";
}

function gruppiereNachLagerplatz(teile: Pick<Teil, "teilId" | "teiltyp" | "menge" | "lagerplatzCode" | "grading">[]): Map<string, typeof teile> {
  const m = new Map<string, typeof teile>();
  for (const t of teile) {
    const key = t.lagerplatzCode ?? "Kein Lagerplatz";
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(t);
  }
  return m;
}

// ── Schritt-Indikator ─────────────────────────────────────────────────────────

function StepDots({ step }: { step: 1 | 2 }) {
  const labels = ["Teile auswählen", "Bestätigen"];
  return (
    <div className="flex items-center gap-2 px-6 py-3 border-b border-[#ced4da] dark:border-[#3e4042]">
      {labels.map((label, i) => {
        const s = (i + 1) as 1 | 2;
        const done   = s < step;
        const active = s === step;
        return (
          <div key={s} className="flex items-center gap-1.5">
            <div
              className="h-1.5 rounded-full transition-all duration-300"
              style={{
                width:      active ? 28 : 10,
                background: done ? "#04b475" : active ? "#202f61" : "#ced4da",
              }}
            />
            {done && <span className="text-xs font-black text-[#04b475]">✓</span>}
          </div>
        );
      })}
      <span className="text-xs text-[#65676b] dark:text-[#b0b3b8] ml-1">
        {step === 1 ? "Teile auswählen" : "Bestätigen"}
      </span>
    </div>
  );
}

// ── Haupt-Komponente ──────────────────────────────────────────────────────────

export function AuslagerModal({ anfrageIds, gruppenLabel, onClose, onSuccess }: Props) {
  const [step,        setStep]        = useState<1 | 2 | 3>(1);
  const [ausgewaehlt, setAusgewaehlt] = useState<Set<number>>(new Set());
  const [notiz,       setNotiz]       = useState("");
  const [ergebnis,    setErgebnis]    = useState<AuslagerResult | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const query = api.auslagern.gruppeDetails.useQuery(
    { anfrageIds },
    { staleTime: 10_000 },
  );

  // Pre-select alle verfügbaren Teile wenn Daten geladen
  useEffect(() => {
    if (!query.data) return;
    setAusgewaehlt(new Set(query.data.filter((t) => t.verfuegbar).map((t) => t.teilId)));
  }, [query.data]);

  const mutation = api.auslagern.teile.useMutation({
    onSuccess: (data) => {
      const result = data as AuslagerResult;
      setErgebnis(result);
      setStep(3);
      onSuccess?.(result);
    },
  });

  const teile         = (query.data ?? []) as Teil[];
  const selectedTeile = teile.filter((t) => ausgewaehlt.has(t.teilId));
  const anzahl        = selectedTeile.length;

  function toggleTeil(id: number) {
    setAusgewaehlt((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleBestaetigen() {
    if (!anzahl) return;
    mutation.mutate({ anfrageIds: [...ausgewaehlt], notiz: notiz || undefined });
  }

  // C2/C3: Etiketten drucken — window.open im sync-Kontext, dann QR per await
  function handleDrucken() {
    if (!ergebnis) return;
    const jahr = new Date().getFullYear();
    // C3: Sortierung nach Lagerplatz (nulls ans Ende), dann Artikel-Bezeichnung
    const sorted = [...ergebnis.ausgabe].sort((a, b) => {
      const lpA = a.lagerplatz ?? "\xff\xff";
      const lpB = b.lagerplatz ?? "\xff\xff";
      if (lpA !== lpB) return lpA.localeCompare(lpB);
      return a.artikel.localeCompare(b.artikel);
    });
    const belege: AuslagerBelegData[] = sorted.map((a) => ({
      belegNr:            `AL-${jahr}-${a.anfrageId.toString().padStart(4, "0")}`,
      artikelBezeichnung: a.artikel,
      lagerplatz:         a.lagerplatz,
      kategorie:          a.kategorie,
      grading:            a.grading,
      techniker:          a.techniker,
      logId:              a.logId,
      geraeteName:        a.geraeteName ?? undefined,
      restBestand:        a.neuerBestand,
      ersteller:          ergebnis.ausgefuehrtVon,
      datum:              ergebnis.datum,
    }));
    void printMehrereAuslagerBelege(belege);
  }

  return (
    <FocusTrap focusTrapOptions={{ escapeDeactivates: false, clickOutsideDeactivates: false, returnFocusOnDeactivate: true }}>
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Auslagerung für ${gruppenLabel}`}
          className="relative w-full max-w-xl bg-white dark:bg-[#242526] rounded-2xl shadow-2xl border border-[#ced4da] dark:border-[#3e4042] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#ced4da] dark:border-[#3e4042]">
            <div>
              <h3 className="font-black text-lg text-[#1a1a1a] dark:text-[#e4e6eb]">
                {step === 3 ? "✅ Ausgelagert!" : "📤 Teile auslagern"}
              </h3>
              {step !== 3 && (
                <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-0.5 truncate max-w-xs">{gruppenLabel}</p>
              )}
            </div>
            <button
              onClick={onClose}
              aria-label="Schließen"
              className="text-[#65676b] hover:text-[#fa3e3e] text-2xl leading-none w-11 h-11 flex items-center justify-center rounded-lg hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors flex-shrink-0"
            >
              ×
            </button>
          </div>

          {/* Step dots */}
          {step !== 3 && <StepDots step={step} />}

          {/* Body */}
          <div className="px-6 py-5 max-h-[65vh] overflow-y-auto">

            {/* Loading */}
            {query.isLoading && (
              <div className="flex items-center justify-center py-10 gap-3 text-[#65676b] dark:text-[#b0b3b8]">
                <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Lade Teile…
              </div>
            )}

            {/* Error */}
            {query.error && (
              <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 text-sm">
                {query.error.message}
              </div>
            )}

            {/* ── Schritt 1: Teile-Auswahl ── */}
            {!query.isLoading && step === 1 && teile.length === 0 && !query.error && (
              <div className="text-center py-8 text-[#65676b] dark:text-[#b0b3b8]">
                <div className="text-3xl mb-2">📭</div>
                <div className="font-semibold text-sm">Keine auslagerbaren Teile gefunden</div>
              </div>
            )}

            {!query.isLoading && step === 1 && teile.length > 0 && (
              <div className="space-y-2">
                {teile.map((t) => {
                  const selected = ausgewaehlt.has(t.teilId);
                  return (
                    <div
                      key={t.teilId}
                      onClick={() => t.verfuegbar && toggleTeil(t.teilId)}
                      role="checkbox"
                      aria-checked={selected}
                      aria-disabled={!t.verfuegbar}
                      tabIndex={t.verfuegbar ? 0 : -1}
                      onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && t.verfuegbar) { e.preventDefault(); toggleTeil(t.teilId); } }}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-all select-none ${
                        t.verfuegbar ? "cursor-pointer" : "cursor-default opacity-50"
                      } ${selected
                          ? "border-[#04b475] bg-[#04b475]/5 dark:bg-[#04b475]/10"
                          : "border-[#ced4da] dark:border-[#3e4042] hover:border-[#b0b3b8] dark:hover:border-[#5a5c5e]"
                      }`}
                    >
                      {/* Checkbox */}
                      <div className={`w-5 h-5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-all ${
                        selected ? "bg-[#04b475] border-[#04b475]" : "border-[#ced4da] dark:border-[#5a5c5e]"
                      }`}>
                        {selected && <span className="text-white text-[11px] font-black leading-none">✓</span>}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">{t.teiltyp}</span>
                          {t.grading && (
                            <span
                              className="text-[11px] font-black px-1.5 py-0.5 rounded text-white"
                              style={{ background: gradingColor(t.grading) }}
                            >
                              {t.grading}
                            </span>
                          )}
                          {!t.verfuegbar && (
                            <span className="text-xs text-[#65676b] dark:text-[#b0b3b8]">nicht auf Lager</span>
                          )}
                        </div>
                        <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
                          Bestand: {t.bestand} · {t.menge}× benötigt
                        </div>
                      </div>

                      {/* Lagerplatz */}
                      {t.lagerplatzCode && (
                        <div className="text-right flex-shrink-0">
                          <div className="text-sm font-black font-mono text-[#202f61] dark:text-[#7a9fe0]">{t.lagerplatzCode}</div>
                          <div className="text-[10px] text-[#65676b] dark:text-[#b0b3b8]">Lagerplatz</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Schritt 2: Bestätigung ── */}
            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <div className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase tracking-wider mb-2">
                    Hol diese Teile:
                  </div>
                  {[...gruppiereNachLagerplatz(selectedTeile).entries()].map(([lp, lTeile]) => (
                    <div key={lp} className="mb-2 p-3 rounded-xl bg-[#f0f2f5] dark:bg-[#18191a] border border-[#ced4da] dark:border-[#3e4042]">
                      <div className="font-black text-sm font-mono text-[#202f61] dark:text-[#7a9fe0] mb-1.5">📍 {lp}</div>
                      <div className="flex flex-wrap gap-2">
                        {lTeile.map((t) => (
                          <span key={t.teilId} className="text-sm font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">
                            {t.teiltyp}
                            {t.grading && (
                              <span
                                className="ml-1 text-[11px] font-black px-1 py-0.5 rounded text-white"
                                style={{ background: gradingColor(t.grading) }}
                              >
                                {t.grading}
                              </span>
                            )}
                            <span className="text-[#65676b] dark:text-[#b0b3b8] text-xs ml-1">×{t.menge}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div>
                  <label
                    htmlFor="auslagern-notiz"
                    className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase tracking-wider mb-1"
                  >
                    Notiz (optional)
                  </label>
                  <textarea
                    id="auslagern-notiz"
                    value={notiz}
                    onChange={(e) => setNotiz(e.target.value)}
                    placeholder="z.B. Abgeholt von Techniker XY"
                    rows={2}
                    className="w-full px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] text-sm outline-none focus:border-[#008bd2] resize-none transition-colors"
                  />
                </div>
              </div>
            )}

            {/* ── Schritt 3: Erfolg ── */}
            {step === 3 && ergebnis && (
              <div className="text-center space-y-4">
                <div className="text-5xl">🎉</div>
                <p className="text-[#65676b] dark:text-[#b0b3b8] text-sm">
                  {ergebnis.ausgabe.length} Teil{ergebnis.ausgabe.length !== 1 ? "e" : ""} ausgegeben von <strong className="text-[#1a1a1a] dark:text-[#e4e6eb]">{ergebnis.ausgefuehrtVon}</strong>
                </p>

                <div className="text-left space-y-2">
                  {[...gruppiereNachLagerplatz(
                    ergebnis.ausgabe.map((a) => ({
                      teilId: a.anfrageId, teiltyp: a.artikel, menge: a.menge,
                      lagerplatzCode: a.lagerplatz, grading: null,
                    }))
                  ).entries()].map(([lp, lTeile]) => (
                    <div key={lp} className="p-3 rounded-xl bg-[#f0f2f5] dark:bg-[#18191a] border border-[#ced4da] dark:border-[#3e4042]">
                      <div className="font-black text-xs font-mono text-[#202f61] dark:text-[#7a9fe0] mb-1">📍 {lp}</div>
                      {lTeile.map((t) => (
                        <div key={t.teilId} className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
                          ✓ {t.teiltyp} ×{t.menge}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>

                <div className="p-3 rounded-xl border border-dashed border-[#ced4da] dark:border-[#3e4042] text-xs text-[#65676b] dark:text-[#b0b3b8]">
                  📄 Auslagerbeleg — Phase C
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          {step !== 3 && !query.isLoading && !query.error && (
            <div className="flex gap-3 px-6 py-4 border-t border-[#ced4da] dark:border-[#3e4042]">
              <button
                onClick={() => step === 1 ? onClose() : setStep(1)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-semibold text-sm hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors min-h-[44px]"
              >
                {step === 1 ? "Abbrechen" : "← Zurück"}
              </button>
              {step === 1 && (
                <button
                  onClick={() => setStep(2)}
                  disabled={anzahl === 0}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-[#04b475] text-white font-bold text-sm disabled:opacity-40 hover:bg-[#03a065] transition-colors min-h-[44px]"
                >
                  {anzahl} Teil{anzahl !== 1 ? "e" : ""} auslagern →
                </button>
              )}
              {step === 2 && (
                <button
                  onClick={handleBestaetigen}
                  disabled={mutation.isPending || anzahl === 0}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-[#04b475] text-white font-bold text-sm disabled:opacity-40 hover:bg-[#03a065] transition-colors min-h-[44px]"
                >
                  {mutation.isPending ? "Wird ausgelagert…" : `✅ ${anzahl} Teil${anzahl !== 1 ? "e" : ""} jetzt auslagern`}
                </button>
              )}
            </div>
          )}
          {step === 3 && (
            <div className="flex gap-3 px-6 py-4 border-t border-[#ced4da] dark:border-[#3e4042]">
              <button
                onClick={handleDrucken}
                className="flex-1 px-4 py-2.5 rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-[#1a1a1a] dark:text-[#e4e6eb] font-semibold text-sm hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors min-h-[44px]"
              >
                🏷️ Etiketten drucken
              </button>
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-xl bg-[#202f61] text-white font-bold text-sm hover:bg-[#2a3d7a] transition-colors min-h-[44px]"
              >
                Schließen
              </button>
            </div>
          )}
        </div>
      </div>
    </FocusTrap>
  );
}

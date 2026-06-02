"use client";
import { useState, useEffect } from "react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";

function todayStr() { return new Date().toISOString().slice(0, 10); }

type Existing = { id: number; anzahl: number; bestelltAm: Date; notiz: string | null };

/**
 * Modal zum Erfassen (create) oder Bearbeiten (edit) einer externen Bestellung.
 * Kombination (Modell · Teiltyp) ist vorausgewählt und nicht editierbar — sie
 * ist der Gruppierungs-Schlüssel der Auswertung.
 */
export function BestellungErfassenModal({
  modellName, hersteller, teiltyp, existing, onClose, onSaved,
}: {
  modellName: string;
  hersteller: string | null;
  teiltyp:    string;
  existing?:  Existing;
  onClose:    () => void;
  onSaved:    () => void;
}) {
  const { show } = useToast();
  const isEdit = !!existing;

  const [anzahl,     setAnzahl]     = useState<string>(existing ? String(existing.anzahl) : "1");
  const [bestelltAm, setBestelltAm] = useState<string>(existing ? new Date(existing.bestelltAm).toISOString().slice(0, 10) : todayStr());
  const [notiz,      setNotiz]      = useState<string>(existing?.notiz ?? "");

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const erfassen     = api.bestellempfehlung.bestellungErfassen.useMutation();
  const aktualisieren = api.bestellempfehlung.bestellungAktualisieren.useMutation();
  const pending = erfassen.isPending || aktualisieren.isPending;

  const anzahlNum = Number(anzahl);
  const datumOk   = bestelltAm <= todayStr();
  const canSave   = Number.isInteger(anzahlNum) && anzahlNum > 0 && datumOk && !pending;

  async function handleSave() {
    if (!canSave) return;
    const bestelltAmDate = new Date(bestelltAm + "T12:00:00");
    try {
      if (isEdit) {
        await aktualisieren.mutateAsync({ id: existing!.id, anzahl: anzahlNum, bestelltAm: bestelltAmDate, notiz: notiz.trim() || undefined });
        show("Bestellung aktualisiert", "success");
      } else {
        await erfassen.mutateAsync({ modellName, hersteller: hersteller ?? undefined, teiltyp, anzahl: anzahlNum, bestelltAm: bestelltAmDate, notiz: notiz.trim() || undefined });
        show("Bestellung erfasst", "success");
      }
      onSaved();
      onClose();
    } catch (e) {
      show((e as { message?: string }).message ?? "Fehler beim Speichern", "error");
    }
  }

  return (
    <div
      role="dialog" aria-modal="true" aria-labelledby="bestellung-modal-title"
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4"
      onClick={() => !pending && onClose()}
    >
      <div className="bg-white dark:bg-[#242526] rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#ced4da] dark:border-[#3e4042]">
          <h2 id="bestellung-modal-title" className="font-black text-lg text-[#1a1a1a] dark:text-[#e4e6eb]">
            {isEdit ? "✏️ Bestellung bearbeiten" : "📦 Bestellung erfassen"}
          </h2>
          <button onClick={onClose} aria-label="Schließen" className="text-[#65676b] hover:text-[#fa3e3e] text-xl font-bold w-11 h-11 flex items-center justify-center rounded-lg hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]">×</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Kombination (read-only) */}
          <div className="px-4 py-3 bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl">
            <div className="text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
              {hersteller ? `${hersteller} · ` : ""}{modellName}
            </div>
            <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-0.5">Teiltyp: {teiltyp}</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="be-anzahl" className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase tracking-wider">Anzahl</label>
              <input
                id="be-anzahl" type="number" min={1} value={anzahl}
                onChange={(e) => setAnzahl(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] text-sm outline-none focus:border-[#0064d2]"
              />
            </div>
            <div>
              <label htmlFor="be-datum" className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase tracking-wider">Bestellt am</label>
              <input
                id="be-datum" type="date" value={bestelltAm} max={todayStr()}
                onChange={(e) => setBestelltAm(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] text-sm outline-none focus:border-[#0064d2]"
              />
            </div>
          </div>
          {!datumOk && <p className="text-xs text-[#fa3e3e]">Bestelldatum darf nicht in der Zukunft liegen.</p>}

          <div>
            <label htmlFor="be-notiz" className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase tracking-wider">Notiz (optional)</label>
            <textarea
              id="be-notiz" value={notiz} onChange={(e) => setNotiz(e.target.value)} rows={3}
              placeholder="z. B. bei Refurbished-Händler X bestellt"
              className="w-full px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] text-sm outline-none focus:border-[#0064d2] resize-y"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#ced4da] dark:border-[#3e4042]">
          <button onClick={onClose} disabled={pending} className="px-4 py-2 text-sm text-[#65676b] hover:text-[#fa3e3e] transition-colors disabled:opacity-50">Abbrechen</button>
          <button onClick={handleSave} disabled={!canSave}
            className="px-5 py-2 bg-[#0064d2] text-white text-sm font-bold rounded-lg hover:bg-[#0056b3] disabled:opacity-50 transition-colors">
            {pending ? "Speichert…" : isEdit ? "Speichern" : "Erfassen"}
          </button>
        </div>
      </div>
    </div>
  );
}

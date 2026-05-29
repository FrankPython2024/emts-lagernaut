"use client";
import { useState, useEffect, useMemo } from "react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { useDebounce } from "@/hooks/useDebounce";

const INPUT_CLS = "px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] text-sm";

// ── Pool-Verknüpfung: ein Artikel ↔ mehrere Modelle (Basis-Gruppen) ───────────
//
// teiltyp = artikel.kategorie. Verknüpft denselben Artikel als kompatibles Teil
// für mehrere Geräte (Kompatibilitaet.geraet = "Hersteller Modell"). Auswahl auf
// Basis-Modell-Ebene; beim Speichern werden alle MTM-Varianten expandiert.
// Wiederverwendbar von der Artikel-Seite UND aus dem Modell-Verknüpfungs-Modal.

type Props = {
  artikelId:           number;
  teiltyp:             string;
  artikelBezeichnung?: string;
  onClose:             () => void;
  onSaved?:            () => void;
};

export function ModellPoolModal({ artikelId, teiltyp, artikelBezeichnung, onClose, onSaved }: Props) {
  const { show } = useToast();

  const gruppenQuery = api.modell.list.useQuery({ aktiv: true });
  const verknuepft   = api.kompatibilitaet.getVerknuepfteGeraete.useQuery({ artikelId, teiltyp });

  const [suchtext,         setSuchtext]         = useState("");
  const debSuchtext = useDebounce(suchtext, 300);
  const [ausgewaehltBasis, setAusgewaehltBasis] = useState<Set<string>>(new Set());
  const [initialized,      setInitialized]      = useState(false);

  const gruppen = gruppenQuery.data ?? [];
  const bereits = useMemo(() => new Set(verknuepft.data ?? []), [verknuepft.data]);

  // Initial-State: alle Gruppen vorauswählen, die mind. eine verknüpfte Variante haben
  useEffect(() => {
    if (verknuepft.data && gruppenQuery.data && !initialized) {
      const initial = new Set<string>();
      for (const g of gruppenQuery.data) {
        if (g.varianten.some((v) => bereits.has(v))) initial.add(g.basisName);
      }
      setAusgewaehltBasis(initial);
      setInitialized(true);
    }
  }, [verknuepft.data, gruppenQuery.data, bereits, initialized]);

  const gefiltert = useMemo(() => {
    const q = debSuchtext.trim().toLowerCase();
    return q ? gruppen.filter((g) => g.basisName.toLowerCase().includes(q)) : gruppen;
  }, [gruppen, debSuchtext]);

  const setBulk = api.kompatibilitaet.setVerknuepfungBulk.useMutation({
    onSuccess: (r) => {
      show(`✅ ${r.verknuepft} verknüpft · ${r.entfernt} entfernt`, "success");
      onSaved?.();
      onClose();
    },
    onError: (e) => show(e.message, "error"),
  });

  function toggleBasis(basisName: string) {
    setAusgewaehltBasis((prev) => {
      const next = new Set(prev);
      if (next.has(basisName)) next.delete(basisName); else next.add(basisName);
      return next;
    });
  }

  function alleGefilterteMarkieren() {
    setAusgewaehltBasis((prev) => {
      const next = new Set(prev);
      for (const g of gefiltert) next.add(g.basisName);
      return next;
    });
  }

  function auswahlAufheben() {
    setAusgewaehltBasis(new Set());
  }

  function gruppenStatus(g: { varianten: string[] }): "voll" | "teilweise" | "leer" {
    const n = g.varianten.filter((v) => bereits.has(v)).length;
    if (n === 0) return "leer";
    if (n === g.varianten.length) return "voll";
    return "teilweise";
  }

  function handleSave() {
    // Alle Varianten der ausgewählten Basis-Gruppen expandieren
    const gewuenscht = new Set<string>();
    for (const g of gruppen) {
      if (ausgewaehltBasis.has(g.basisName)) for (const v of g.varianten) gewuenscht.add(v);
    }
    const hinzugefuegt = [...gewuenscht].filter((v) => !bereits.has(v));
    const entfernt     = [...bereits].filter((v) => !gewuenscht.has(v));
    setBulk.mutate({ artikelId, teiltyp, geraete: hinzugefuegt, entfernen: entfernt });
  }

  const laedt = gruppenQuery.isLoading || verknuepft.isLoading;

  return (
    <Modal open onClose={onClose} title={`Modelle verknüpfen — ${teiltyp}`} width="max-w-xl">
      <div className="space-y-3">
        {artikelBezeichnung && (
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
            Artikel: <strong className="text-[#1a1a1a] dark:text-[#e4e6eb]">{artikelBezeichnung}</strong>
          </p>
        )}

        <input
          type="search"
          autoFocus
          value={suchtext}
          onChange={(e) => setSuchtext(e.target.value)}
          placeholder="🔍 Basis-Modell suchen…"
          className={`${INPUT_CLS} w-full`}
          aria-label="Basis-Modell suchen"
        />

        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            onClick={alleGefilterteMarkieren}
            disabled={gefiltert.length === 0}
            aria-label={`Alle ${gefiltert.length} gefilterten Basis-Modelle markieren`}
            className="px-3 py-1 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#1a1a1a] dark:text-[#e4e6eb] hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ minHeight: 36 }}
          >
            Alle{gefiltert.length > 0 ? ` (${gefiltert.length})` : ""} markieren
          </button>
          <button
            type="button"
            onClick={auswahlAufheben}
            disabled={ausgewaehltBasis.size === 0}
            className="px-3 py-1 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#1a1a1a] dark:text-[#e4e6eb] hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ minHeight: 36 }}
          >
            Auswahl aufheben
          </button>
          <span className="ml-auto text-xs text-[#65676b] dark:text-[#b0b3b8]">
            {ausgewaehltBasis.size} ausgewählt · {gefiltert.length} Basis-Modelle
          </span>
        </div>

        <div className="max-h-96 overflow-y-auto space-y-1 pr-0.5 border-t border-[#ced4da] dark:border-[#3e4042] pt-2">
          {laedt ? (
            <div className="flex justify-center py-6">
              <div className="w-6 h-6 border-2 border-[#0064d2]/20 border-t-[#0064d2] rounded-full animate-spin" />
            </div>
          ) : gefiltert.length === 0 ? (
            <p className="text-sm text-center py-6 text-[#65676b] dark:text-[#b0b3b8]">
              {debSuchtext ? `Keine Modelle für „${debSuchtext}"` : "Keine aktiven Modelle."}
            </p>
          ) : (
            gefiltert.map((g) => {
              const sel    = ausgewaehltBasis.has(g.basisName);
              const status = gruppenStatus(g);
              return (
                <label
                  key={g.basisName}
                  className="flex items-center gap-3 px-3 rounded-lg cursor-pointer hover:bg-[#f0f2f5] dark:hover:bg-[#18191a]"
                  style={{ minHeight: 44 }}
                >
                  <input
                    type="checkbox"
                    checked={sel}
                    onChange={() => toggleBasis(g.basisName)}
                    className="w-4 h-4 accent-[#0064d2] flex-shrink-0"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-[#1a1a1a] dark:text-[#e4e6eb]">{g.basisName}</span>
                    <span className="block text-xs text-[#65676b] dark:text-[#b0b3b8]">
                      {g.anzahl} {g.anzahl === 1 ? "Variante" : "Varianten"}
                      {status === "voll"      && <span className="ml-2 font-semibold text-[#00a400]">· vollständig verknüpft</span>}
                      {status === "teilweise" && <span className="ml-2 font-semibold text-[#f7b928]">· teilweise verknüpft</span>}
                    </span>
                  </span>
                </label>
              );
            })
          )}
        </div>

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
            disabled={setBulk.isPending || laedt}
            className="flex-1 py-2.5 rounded-xl bg-[#0064d2] text-white font-bold hover:bg-blue-700 disabled:opacity-50"
          >
            {setBulk.isPending ? "Speichere…" : `Speichern (${ausgewaehltBasis.size} Modelle)`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

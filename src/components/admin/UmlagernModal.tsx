"use client";

import { useState } from "react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { printMehrereLabels } from "@/components/ui/ArtikelLabel";

type Props = {
  modellId:    number;
  modellName:  string;
  hersteller:  string;
  aktuellesFachCode: string;
  onClose:     () => void;
  onDone:      () => void; // refetch der Fach-Ansicht nach Erfolg
};

// Modell von Fach A → Fach B umlagern. Verändert nur den Lagerort, nie den Bestand.
export function UmlagernModal({ modellId, modellName, hersteller, aktuellesFachCode, onClose, onDone }: Props) {
  const { show } = useToast();
  const vorschau = api.lagerplatz.umlagerVorschau.useQuery({ modellId }, { staleTime: 0 });

  const [zielId, setZielId] = useState<number | null>(null);
  const [ergebnis, setErgebnis] = useState<{ von: string; nach: string; artikel: { id: number; bezeichnung: string; kategorie: string }[] } | null>(null);

  const umlagern = api.lagerplatz.umlagern.useMutation({
    onSuccess: (r) => {
      setErgebnis({ von: r.von, nach: r.nach, artikel: r.artikel });
      show(`✅ ${modellName}: ${r.von} → ${r.nach}`, "success");
      onDone();
    },
    onError: (e) => show(e.message, "error"),
  });

  const d           = vorschau.data;
  const zielfaecher = d?.zielfaecher ?? [];
  const betroffene  = d?.betroffeneArtikel ?? [];

  async function drucken() {
    if (!ergebnis) return;
    await printMehrereLabels(
      ergebnis.artikel.map((a) => ({ id: a.id, bezeichnung: a.bezeichnung, kategorie: a.kategorie, lagerplatz: ergebnis.nach, hersteller })),
    );
  }

  return (
    <Modal open onClose={onClose} title={`Umlagern · ${modellName}`}>
      {/* ── Erfolg ── */}
      {ergebnis ? (
        <div className="space-y-4 text-center">
          <div className="text-5xl" aria-hidden>📦✅</div>
          <div className="text-lg font-black text-[#202F61] dark:text-[#e4e6eb]">Umgelagert</div>
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#04B475]/10 text-[#04713f] dark:text-[#04B475] font-bold">
            {ergebnis.von} → {ergebnis.nach}
          </div>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
            {ergebnis.artikel.length} {ergebnis.artikel.length === 1 ? "Artikel" : "Artikel"} auf den neuen Ort gesetzt.
          </p>
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={drucken}
              disabled={ergebnis.artikel.length === 0}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[#008BD2] text-white font-bold hover:bg-[#0077b5] disabled:opacity-40 transition-colors min-h-[56px]"
            >
              🖨️ Etiketten neu drucken
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-bold hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors min-h-[56px]"
            >
              Fertig
            </button>
          </div>
        </div>
      ) : vorschau.isLoading ? (
        <div className="py-10 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">Lade…</div>
      ) : vorschau.error ? (
        <div className="py-10 text-center text-sm text-[#fa3e3e]">{vorschau.error.message}</div>
      ) : (
        <div className="space-y-4">
          {/* Aktuelles Fach */}
          <div className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
            Aktuelles Fach:{" "}
            <span className="font-mono font-bold text-[#202F61] dark:text-[#e4e6eb]">{aktuellesFachCode}</span>
            <span className="ml-2 text-xs">· {hersteller}</span>
          </div>

          {/* Zielfach-Auswahl */}
          <div>
            <label htmlFor="ziel-fach" className="block text-sm font-bold text-[#202F61] dark:text-[#e4e6eb] mb-1">
              Zielfach wählen
            </label>
            {zielfaecher.length === 0 ? (
              <div className="px-4 py-3 rounded-xl bg-[#f0f2f5] dark:bg-[#18191a] text-sm text-[#65676b] dark:text-[#b0b3b8]">
                Kein passendes Zielfach frei (gleicher Standort, freie Kapazität, {hersteller}-Reinheit).
              </div>
            ) : (
              <select
                id="ziel-fach"
                value={zielId ?? ""}
                onChange={(e) => setZielId(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-4 rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#202F61] dark:text-[#e4e6eb] outline-none focus:border-[#008BD2] focus:ring-2 focus:ring-[#008BD2]/30 transition-colors min-h-[56px]"
              >
                <option value="">— bitte wählen —</option>
                {zielfaecher.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.code} · {f.belegt}/4 belegt{f.belegt > 0 ? ` · ${f.modellHersteller}` : " · leer"}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Betroffene Artikel */}
          <div>
            <div className="text-sm font-bold text-[#202F61] dark:text-[#e4e6eb] mb-1">
              Diese {betroffene.length} {betroffene.length === 1 ? "Artikel wird" : "Artikel werden"} mit umgelagert
            </div>
            {betroffene.length === 0 ? (
              <div className="px-4 py-3 rounded-xl bg-[#f7b928]/10 text-sm text-[#8a6d1b] dark:text-[#f7b928]">
                Keine Artikel zu diesem Modell gefunden — es wird nur das Fach des Modells umgehängt.
              </div>
            ) : (
              <div className="rounded-xl border border-[#ced4da] dark:border-[#3e4042] divide-y divide-[#f0f2f5] dark:divide-[#3e4042] max-h-56 overflow-y-auto">
                {betroffene.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="flex-1 min-w-0 truncate text-[#1a1a1a] dark:text-[#e4e6eb]" title={a.bezeichnung}>
                      <span className="font-semibold">{a.kategorie}</span>
                      <span className="text-[#65676b] dark:text-[#b0b3b8]"> · {a.bezeichnung}</span>
                    </span>
                    <span className="text-xs text-[#65676b] dark:text-[#b0b3b8] whitespace-nowrap">{a.bestand} Stk</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-[#90939a] dark:text-[#6b6e73] mt-1">
              Nur der Lagerort ändert sich — der Bestand bleibt unverändert.
            </p>
          </div>

          {/* Aktionen */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={umlagern.isPending}
              className="flex-1 rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-bold hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] disabled:opacity-50 transition-colors min-h-[56px]"
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={() => zielId && umlagern.mutate({ modellId, neuerLagerplatzId: zielId })}
              disabled={!zielId || umlagern.isPending}
              className="flex-1 rounded-xl bg-[#04B475] text-white font-bold hover:bg-[#039c64] disabled:opacity-40 transition-colors min-h-[56px]"
            >
              {umlagern.isPending ? "Lagere um…" : "Umlagern"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

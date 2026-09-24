"use client";

// ── „🖨️ Drucken" (3D-Druck Paket 3, Stufe 3) ─────────────────────────────────
// Legt an JEDEM PC einen Druckauftrag in Lagernaut an; die Druckbrücke am
// Laptop holt ihn ab, sobald Drucker UND Platte frei sind. Braucht DRUCK_STARTEN.
// ⚠️ Kein „Platte ist leer"-Häkchen hier: Wer an einem anderen PC sitzt, sieht die
// Platte nicht. Das bestätigt jemand am Drucker mit dem Knopf auf der Druckerkarte.

import { useState } from "react";
import { api } from "@/trpc/react";
import { usePermissions } from "@/hooks/usePermissions";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { materialPasst } from "@/lib/druck/warteschlange";
import { useDruckerStand } from "./useDruckbruecke";

type Props = {
  vorlageId?: number;
  titel: string;
  dateiId: number;
  dateiname: string;
  material?: string | null;
  klein?: boolean;
};

export function DruckenKnopf({ titel, dateiId, dateiname, material, klein }: Props) {
  const { has } = usePermissions();
  const { data: s } = useDruckerStand();
  const [auf, setAuf] = useState(false);
  if (!has("DRUCK_STARTEN") || !s?.gekoppelt) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setAuf(true)}
        className={`inline-flex items-center justify-center gap-2 px-4 rounded-xl bg-[#04B475] text-white text-sm font-bold hover:bg-[#039a64] transition-colors ${klein ? "min-h-[48px]" : "min-h-[56px]"}`}
        title={`„${dateiname}“ drucken`}
      >
        🖨️ Drucken
      </button>
      {auf && <DruckenDialog {...{ titel, dateiId, dateiname, material }} onClose={() => setAuf(false)} />}
    </>
  );
}

function DruckenDialog({ titel, dateiId, dateiname, material, onClose }: Omit<Props, "klein" | "vorlageId"> & { onClose: () => void }) {
  const { show } = useToast();
  const utils = api.useUtils();
  const { data: s } = useDruckerStand();
  const anlegen = api.druck.auftragAnlegen.useMutation({
    onSuccess: () => {
      void utils.druck.druckerStand.invalidate();
      show(s?.startbereit && (s.warteschlange.length ?? 0) === 0
        ? `🖨️ „${titel}“ geht an den Drucker`
        : `🖨️ „${titel}“ steht in der Warteschlange`, "success");
      onClose();
    },
    onError: (e) => show(e.message, "error"),
  });

  const spule = s?.drucker?.spule?.typ ?? null;
  const passt = materialPasst(material, spule);
  const vorAnderen = s?.warteschlange.length ?? 0;
  const zeile = "rounded-xl px-3 py-2 text-sm font-bold";

  return (
    <Modal open onClose={() => { if (!anlegen.isPending) onClose(); }} title="Drucken">
      <div className="space-y-3">
        <div className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
          <div><strong>{titel}</strong></div>
          <div className="text-[#65676b] dark:text-[#b0b3b8] break-all">{dateiname}</div>
        </div>

        {!s?.online ? (
          <div className={`${zeile} bg-[#BA7517]/10 text-[#8A5A00] dark:text-[#f7b928]`}>
            Die Druckbrücke am Laptop ist gerade aus. Der Auftrag wartet, bis sie wieder läuft.
          </div>
        ) : vorAnderen > 0 ? (
          <div className={`${zeile} bg-[#BA7517]/10 text-[#8A5A00] dark:text-[#f7b928]`}>
            Vor diesem Auftrag {vorAnderen === 1 ? "wartet noch einer" : `warten noch ${vorAnderen}`}.
          </div>
        ) : s.startbereit ? (
          <div className={`${zeile} bg-[#04B475]/10 text-[#037A4F] dark:text-[#3ddc97]`}>
            Drucker und Platte sind frei — der Druck startet in wenigen Sekunden.
          </div>
        ) : (
          <div className={`${zeile} bg-[#BA7517]/10 text-[#8A5A00] dark:text-[#f7b928]`}>
            Kommt in die Warteschlange — {s.wartegrund}.
          </div>
        )}

        {passt === false && (
          <div role="alert" className={`${zeile} bg-[#fa3e3e]/10 text-[#c01818] dark:text-[#ff6b6b]`}>
            ⚠ Die Vorlage will {material}, am Drucker ist {spule} eingelegt.
          </div>
        )}
        {material && passt !== false && (
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Material laut Vorlage: {material}{spule ? ` · eingelegt: ${spule}` : ""}</p>
        )}

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} disabled={anlegen.isPending}
            className="flex-1 text-sm font-semibold border border-[#ced4da] dark:border-[#3e4042] rounded-xl text-[#65676b] dark:text-[#b0b3b8] min-h-[56px] disabled:opacity-50">
            Abbrechen
          </button>
          <button type="button" onClick={() => anlegen.mutate({ dateiId })} disabled={anlegen.isPending}
            className="flex-1 rounded-xl bg-[#04B475] text-white text-sm font-black min-h-[56px] disabled:opacity-50">
            {anlegen.isPending ? "Sende…" : "🖨️ Druckauftrag senden"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

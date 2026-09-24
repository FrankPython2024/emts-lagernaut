"use client";

// ── „🖨️ Drucken" über die lokale Druckbrücke (3D-Druck Paket 3, Stufe 2) ────
// Erscheint NUR, wenn auf diesem PC eine Brücke läuft und mit dem Drucker
// verbunden ist. Ablauf: Datei aus Lagernaut holen (Sitzung des Browsers) →
// an die Brücke schicken → die legt sie in /cache und startet sie.
// ⚠️ Vorher zwei Pflicht-Häkchen: Ein Druck auf eine belegte Platte fährt die
// Düse in das alte Teil.

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { BRUECKE_URL, STARTBEREIT, brueckeJetztFragen, merkeAuftrag, useDruckbruecke } from "./useDruckbruecke";

type Props = {
  vorlageId: number;
  titel: string;
  dateiId: number;
  dateiname: string;
  material?: string | null;
  klein?: boolean;
};

export function DruckenKnopf({ vorlageId, titel, dateiId, dateiname, material, klein }: Props) {
  const { erreichbar, status } = useDruckbruecke();
  const [auf, setAuf] = useState(false);
  if (!erreichbar || status?.verbindung !== "verbunden") return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setAuf(true)}
        className={`inline-flex items-center justify-center gap-2 px-4 rounded-xl bg-[#04B475] text-white text-sm font-bold hover:bg-[#039a64] transition-colors ${klein ? "min-h-[48px]" : "min-h-[56px]"}`}
        title={`„${dateiname}“ an den Drucker schicken`}
      >
        🖨️ Drucken
      </button>
      {auf && <DruckenDialog {...{ vorlageId, titel, dateiId, dateiname, material }} onClose={() => setAuf(false)} />}
    </>
  );
}

function DruckenDialog({ vorlageId, titel, dateiId, dateiname, material, onClose }: Omit<Props, "klein"> & { onClose: () => void }) {
  const { show } = useToast();
  const { status } = useDruckbruecke();
  const [platteLeer, setPlatteLeer] = useState(false);
  const [filament, setFilament] = useState(false);
  const [schritt, setSchritt] = useState<"" | "hole" | "uebertrage">("");
  const [fehler, setFehler] = useState<string | null>(null);

  const d = status?.drucker;
  const bereit = status?.verbindung === "verbunden" && !!d?.zustand && STARTBEREIT.includes(d.zustand);
  const laeuft = schritt !== "";

  async function drucken() {
    setFehler(null);
    try {
      setSchritt("hole");
      const r = await fetch(`/api/druck/datei/${dateiId}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`Datei konnte nicht aus Lagernaut geladen werden (${r.status})`);
      const inhalt = await r.blob();
      setSchritt("uebertrage");
      const q = new URLSearchParams({ bestaetigt: "1", vorlage: String(vorlageId), titel });
      const b = await fetch(`${BRUECKE_URL}/drucken?${q}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: inhalt,
      });
      const j = (await b.json().catch(() => ({}))) as { ok?: boolean; fehler?: string; bestaetigt?: boolean; datei?: string; weiterePlatten?: number };
      if (!b.ok || !j.ok) throw new Error(j.fehler ?? `Druckbrücke meldet Fehler ${b.status}`);
      merkeAuftrag({ vorlageId, titel, datei: j.datei ?? "", gestartet: new Date().toISOString() });
      brueckeJetztFragen();
      show(j.bestaetigt ? `🖨️ Druck gestartet: „${titel}“` : `🖨️ An den Drucker geschickt: „${titel}“ — Start noch nicht bestätigt, bitte am Drucker nachsehen`, "success");
      if (j.weiterePlatten) show(`Hinweis: Die Datei enthält ${j.weiterePlatten + 1} Platten — gedruckt wird die erste.`, "info");
      onClose();
    } catch (err) {
      setFehler(err instanceof Error ? (err.message === "Failed to fetch" ? "Druckbrücke nicht erreichbar — läuft das Fenster noch?" : err.message) : String(err));
    } finally {
      setSchritt("");
    }
  }

  const haken = "flex items-start gap-3 min-h-[48px] text-base text-[#1a1a1a] dark:text-[#e4e6eb] cursor-pointer";
  return (
    <Modal open onClose={() => { if (!laeuft) onClose(); }} title="An den Drucker schicken">
      <div className="space-y-4">
        <div className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
          <div><strong>{titel}</strong></div>
          <div className="text-[#65676b] dark:text-[#b0b3b8] break-all">{dateiname}</div>
        </div>

        <div className={`rounded-xl px-3 py-2 text-sm font-bold ${bereit ? "bg-[#04B475]/10 text-[#037A4F] dark:text-[#3ddc97]" : "bg-[#BA7517]/10 text-[#8A5A00] dark:text-[#f7b928]"}`}>
          Drucker: {d?.zustandText ?? "unbekannt"}
          {!bereit && " — erst starten, wenn der laufende Druck fertig ist."}
        </div>

        <label className={haken}>
          <input type="checkbox" className="mt-1 w-6 h-6" checked={platteLeer} onChange={(e) => setPlatteLeer(e.target.checked)} disabled={laeuft} />
          <span>Die <strong>Druckplatte ist leer</strong> und sauber.</span>
        </label>
        <label className={haken}>
          <input type="checkbox" className="mt-1 w-6 h-6" checked={filament} onChange={(e) => setFilament(e.target.checked)} disabled={laeuft} />
          <span>Das <strong>richtige Filament</strong> ist eingelegt{material ? ` (${material})` : ""}.</span>
        </label>

        {fehler && <div role="alert" className="rounded-xl bg-[#fa3e3e]/10 px-3 py-2 text-sm font-bold text-[#c01818] dark:text-[#ff6b6b]">⚠ {fehler}</div>}

        <div className="flex gap-3">
          <button type="button" onClick={onClose} disabled={laeuft}
            className="flex-1 text-sm font-semibold border border-[#ced4da] dark:border-[#3e4042] rounded-xl text-[#65676b] dark:text-[#b0b3b8] min-h-[56px] disabled:opacity-50">
            Abbrechen
          </button>
          <button type="button" onClick={() => void drucken()} disabled={!bereit || !platteLeer || !filament || laeuft}
            className="flex-1 rounded-xl bg-[#04B475] text-white text-sm font-black min-h-[56px] disabled:opacity-50">
            {schritt === "hole" ? "Hole Datei…" : schritt === "uebertrage" ? "Übertrage an Drucker…" : "🖨️ Jetzt drucken"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

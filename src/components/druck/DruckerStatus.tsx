"use client";

// ── Druckerstatus über die lokale Druckbrücke (3D-Druck Paket 3) ──────────────
// Fragt über useDruckbruecke die Brücke auf DEM PC, auf dem dieser Browser läuft
// (tools/druckbruecke/druckbruecke.mjs). Der Lagernaut-Server ist daran nicht
// beteiligt. An jedem anderen PC gibt es keine Brücke; dann steht hier nur eine
// unaufdringliche Zeile.
// ⚠️ Chrome fragt beim ersten Mal, ob die Seite auf Geräte im lokalen Netzwerk
// zugreifen darf — „Zulassen", sonst sieht es aus wie „Brücke läuft nicht".
//
// Ist ein aus Lagernaut gestarteter Druck fertig, fragt die Karte direkt nach
// dem Einbuchen (Paket 2) — genau dann steht man am Drucker.

import { useEffect, useState } from "react";
import Link from "next/link";
import { leseAuftrag, useDruckbruecke, vergissAuftrag, type LetzterAuftrag } from "./useDruckbruecke";

const FARBE: Record<string, string> = {
  RUNNING: "bg-[#008BD2]/15 text-[#0064d2] dark:text-[#45bdff]",
  PREPARE: "bg-[#008BD2]/15 text-[#0064d2] dark:text-[#45bdff]",
  IDLE:    "bg-[#04B475]/15 text-[#037A4F] dark:text-[#3ddc97]",
  FINISH:  "bg-[#04B475]/15 text-[#037A4F] dark:text-[#3ddc97]",
  PAUSE:   "bg-[#BA7517]/15 text-[#8A5A00] dark:text-[#f7b928]",
  FAILED:  "bg-[#fa3e3e]/15 text-[#c01818] dark:text-[#ff6b6b]",
};

function fmtRest(min: number | null): string | null {
  if (min == null || min <= 0) return null;
  const h = Math.floor(min / 60);
  return h > 0 ? `noch ${h} h ${min % 60} min` : `noch ${min} min`;
}
const grad = (ist: number | null, ziel: number | null) =>
  ist == null ? "–" : `${Math.round(ist)}°${ziel ? ` / ${Math.round(ziel)}°` : ""}`;

/** Gehört der fertige Druck zu dem, was hier gestartet wurde? (subtask_name = unser Titel) */
function istUnserDruck(a: LetzterAuftrag, datei: string | null): boolean {
  if (!datei) return false;
  const ohneEndung = a.datei.replace(/\.gcode\.3mf$/i, "");
  return datei === a.titel || datei === ohneEndung || datei === a.datei;
}

export function DruckerStatus() {
  const { erreichbar, status: s } = useDruckbruecke();
  const [auftrag, setAuftrag] = useState<LetzterAuftrag | null>(null);
  // localStorage erst im Browser lesen; bei jedem neuen Bericht neu (Start/Einbuchen ändern ihn).
  useEffect(() => { setAuftrag(leseAuftrag()); }, [s]);

  if (erreichbar === null) return null;
  if (!erreichbar) {
    return (
      <p className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
        🔌 Kein Drucker verbunden — die Druckbrücke läuft nur am PC beim Drucker.
      </p>
    );
  }
  if (!s) return null;

  const d = s.drucker;
  const karte = "bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-4";

  if (s.verbindung !== "verbunden") {
    return (
      <div className={`${karte} text-sm text-[#1a1a1a] dark:text-[#e4e6eb]`}>
        <strong className="text-[#8A5A00] dark:text-[#f7b928]">🖨️ Druckbrücke läuft, aber keine Verbindung zum Drucker.</strong>
        {s.fehler && <div className="mt-1">{s.fehler}</div>}
        <div className="mt-1 text-xs text-[#65676b] dark:text-[#b0b3b8]">Drucker an? Im selben Netz? „Nur LAN“ und „Entwicklermodus“ eingeschaltet?</div>
      </div>
    );
  }
  if (!d) {
    return <div className={`${karte} text-sm text-[#65676b] dark:text-[#b0b3b8]`}>🖨️ Verbunden — warte auf den ersten Bericht des Druckers…</div>;
  }

  const rest = fmtRest(d.restMinuten);
  const aktiv = d.zustand === "RUNNING" || d.zustand === "PREPARE" || d.zustand === "PAUSE";
  const fertigUnser = d.zustand === "FINISH" && auftrag != null && istUnserDruck(auftrag, d.datei);
  return (
    <div className={`${karte} space-y-2`} aria-live="polite">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-black text-[#202F61] dark:text-[#e4e6eb]">🖨️ Drucker</span>
        <span className={`inline-flex items-center px-2 py-1 rounded-lg text-xs font-bold ${FARBE[d.zustand ?? ""] ?? "bg-[#65676b]/15 text-[#4b4f56] dark:text-[#b0b3b8]"}`}>
          {d.zustandText}
        </span>
        {(aktiv || d.zustand === "FINISH" || d.zustand === "FAILED") && d.datei && <span className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb] truncate">{d.datei}</span>}
        {d.fehlercode && <span className="text-xs font-bold text-[#c01818] dark:text-[#ff6b6b]">Fehler {d.fehlercode}</span>}
        {d.meldungen > 0 && <span className="text-xs font-bold text-[#8A5A00] dark:text-[#f7b928]">⚠ {d.meldungen} {d.meldungen === 1 ? "Meldung" : "Meldungen"} am Drucker</span>}
      </div>
      {aktiv && d.fortschritt != null && (
        <div>
          <div className="flex justify-between text-xs font-semibold text-[#65676b] dark:text-[#b0b3b8] mb-1">
            <span>{d.fortschritt} %{d.schicht != null && d.schichten ? ` · Schicht ${d.schicht}/${d.schichten}` : ""}</span>
            {rest && <span>{rest}</span>}
          </div>
          <div className="h-2.5 rounded-full bg-[#f0f2f5] dark:bg-[#18191a] overflow-hidden" role="progressbar" aria-valuenow={d.fortschritt} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-[#008BD2] transition-all" style={{ width: `${Math.max(0, Math.min(100, d.fortschritt))}%` }} />
          </div>
        </div>
      )}
      <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
        Düse {grad(d.duese, d.dueseZiel)} · Bett {grad(d.bett, d.bettZiel)}
      </div>
      {fertigUnser && auftrag && (
        <div className="flex items-center gap-2 flex-wrap rounded-xl bg-[#04B475]/10 px-3 py-2">
          <span className="text-sm font-bold text-[#037A4F] dark:text-[#3ddc97] flex-1 min-w-[180px]">✓ „{auftrag.titel}“ ist fertig gedruckt.</span>
          <Link href={`/admin/druck/${auftrag.vorlageId}#fertig`}
            className="inline-flex items-center px-4 rounded-xl bg-[#037A4F] text-white text-sm font-bold min-h-[48px]">
            Jetzt einbuchen
          </Link>
          <button type="button" onClick={() => { vergissAuftrag(auftrag.vorlageId); setAuftrag(null); }}
            className="px-3 rounded-xl text-sm font-semibold text-[#65676b] dark:text-[#b0b3b8] min-h-[48px]">
            Ausblenden
          </button>
        </div>
      )}
    </div>
  );
}

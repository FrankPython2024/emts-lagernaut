"use client";

// ── Druckerstatus über die lokale Druckbrücke (3D-Druck Paket 3, Stufe 1) ────
// Fragt http://127.0.0.1:17350/status — also die Brücke auf DEM PC, auf dem
// dieser Browser läuft (tools/druckbruecke/druckbruecke.mjs). Der Lagernaut-
// Server ist daran nicht beteiligt. An jedem anderen PC gibt es keine Brücke;
// dann steht hier nur eine unaufdringliche Zeile.
// ⚠️ Chrome fragt beim ersten Mal, ob die Seite auf Geräte im lokalen Netzwerk
// zugreifen darf — „Zulassen", sonst sieht es aus wie „Brücke läuft nicht".

import { useEffect, useRef, useState } from "react";

export const BRUECKE_URL = "http://127.0.0.1:17350";

type Drucker = {
  zustand: string | null; zustandText: string; datei: string | null;
  fortschritt: number | null; restMinuten: number | null; schicht: number | null; schichten: number | null;
  duese: number | null; dueseZiel: number | null; bett: number | null; bettZiel: number | null;
  fehlercode: number | null; meldungen: number;
};
type BrueckenStatus = {
  bruecke: { version: string }; verbindung: string; fehler: string | null;
  letzterBericht: string | null; drucker: Drucker | null;
};

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

export function DruckerStatus() {
  const [s, setS] = useState<BrueckenStatus | null>(null);
  const [erreichbar, setErreichbar] = useState<boolean | null>(null);
  const erreichbarRef = useRef(false);

  useEffect(() => {
    let aus = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hole = async () => {
      if (document.visibilityState === "visible") {
        const ab = new AbortController();
        const t = setTimeout(() => ab.abort(), 2500);
        let ok = false;
        try {
          const r = await fetch(`${BRUECKE_URL}/status`, { signal: ab.signal, cache: "no-store" });
          if (r.ok) {
            const j = (await r.json()) as BrueckenStatus;
            if (!aus) setS(j);
            ok = true;
          }
        } catch { /* keine Brücke an diesem PC */ } finally {
          clearTimeout(t);
        }
        erreichbarRef.current = ok;
        if (!aus) setErreichbar(ok);
      }
      // Läuft keine Brücke, seltener nachsehen — das ist an fast jedem PC so.
      if (!aus) timer = setTimeout(hole, erreichbarRef.current ? 3000 : 15000);
    };
    void hole();
    return () => { aus = true; clearTimeout(timer); };
  }, []);

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
  return (
    <div className={`${karte} space-y-2`} aria-live="polite">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-black text-[#202F61] dark:text-[#e4e6eb]">🖨️ Drucker</span>
        <span className={`inline-flex items-center px-2 py-1 rounded-lg text-xs font-bold ${FARBE[d.zustand ?? ""] ?? "bg-[#65676b]/15 text-[#4b4f56] dark:text-[#b0b3b8]"}`}>
          {d.zustandText}
        </span>
        {aktiv && d.datei && <span className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb] truncate">{d.datei}</span>}
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
    </div>
  );
}

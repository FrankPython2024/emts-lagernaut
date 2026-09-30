"use client";

// ── Druckerkarte, oberer Teil: Livebild + laufender Druck (30.09.2026) ────────
// Wunsch Frank: Livebild kleiner, dazu ein Bild der Druckdatei, Restzeit, Schichten,
// in welchem Schritt der Drucker gerade ist — „in einem professionellen Look".
// Links das Livebild (Standbild, an/aus), rechts der Druck: Vorschau aus der
// .gcode.3mf, Phase im Klartext (src/lib/druck/druckerPhase.ts), Fortschritt,
// Schicht und Restzeit. Platte, Warteschlange und Fehler stehen darunter in DruckerStatus.
// Audit 30.09.2026: Video, Temperaturen, Tempo, Licht und WLAN wieder entfernt —
// niemand handelt danach, und jedes Feld ist eine Stelle mehr, die bei einem
// Firmware-Update bricht.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers";
import { phaseVon, restText, fertigUm } from "@/lib/druck/druckerPhase";
import { DRUCKT } from "@/lib/druck/warteschlange";
import { KameraBild } from "./KameraBild";

type Stand = inferRouterOutputs<AppRouter>["druck"]["druckerStand"];

const TON = {
  laeuft:  { punkt: "bg-[#008BD2]", text: "text-[#0064d2] dark:text-[#45bdff]", balken: "bg-[#008BD2]" },
  pause:   { punkt: "bg-[#BA7517]", text: "text-[#8A5A00] dark:text-[#f7b928]", balken: "bg-[#BA7517]" },
  fertig:  { punkt: "bg-[#04B475]", text: "text-[#037A4F] dark:text-[#3ddc97]", balken: "bg-[#04B475]" },
  fehler:  { punkt: "bg-[#fa3e3e]", text: "text-[#c01818] dark:text-[#ff6b6b]", balken: "bg-[#fa3e3e]" },
  ruhe:    { punkt: "bg-[#65676b]", text: "text-[#4b4f56] dark:text-[#b0b3b8]", balken: "bg-[#65676b]" },
} as const;

const kachel = "rounded-xl bg-[#f5f7f9] dark:bg-[#18191a] border border-[#e4e8ec] dark:border-[#3e4042] px-3 py-2";
const kachelTitel = "text-xs font-bold uppercase tracking-wide text-[#65676b] dark:text-[#b0b3b8]";
const kachelWert = "text-base font-black tabular-nums text-[#1a1a1a] dark:text-[#e4e6eb]";

const gramm = (g: number | null | undefined) => (g == null ? null : `${g.toLocaleString("de-DE", { maximumFractionDigits: 1 })} g`);
/** Nur echte Farbwerte aus dem Druckerbericht als CSS übernehmen (Audit 30.09.2026). */
const farbeOk = (f: string | null | undefined) => (f && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(f) ? f.slice(0, 7) : null);

/** Livebild an/aus, je Browser gemerkt. */
function useLivebild(): [boolean, (an: boolean) => void] {
  const [an, setAn] = useState(false);
  useEffect(() => {
    try { setAn(window.localStorage.getItem("druck-livebild") === "1"); } catch { /* egal */ }
  }, []);
  const waehle = (v: boolean) => {
    setAn(v);
    try { window.localStorage.setItem("druck-livebild", v ? "1" : "0"); } catch { /* egal */ }
  };
  return [an, waehle];
}

/**
 * `darfKamera`: Livebild nur mit DRUCK_STARTEN (Audit 30.09.2026) — die Kamera kann
 * Beschäftigte aufnehmen (§ 87 BetrVG), Leserollen sehen sie deshalb nicht.
 */
export function DruckerCockpit({ s, darfKamera }: { s: Stand; darfKamera: boolean }) {
  const d = s.drucker;
  const [live, setLive] = useLivebild();
  // Draufsicht zuerst: Die meisten Drucke sind flache Füße — in der Plattenansicht
  // (schräg von vorn) nur ein Strich, von oben klar erkennbar (30.09.2026).
  const [draufsicht, setDraufsicht] = useState(true);
  if (!d) return null;

  const z = d.zustand ?? "";
  const aktiv = DRUCKT.includes(z);
  const phase = phaseVon(d.zustand, d.zustandText, d.stufe, d.stufen);
  const ton = z === "FAILED" || d.fehlercode ? TON.fehler
    : phase.pause ? TON.pause
    : aktiv ? TON.laeuft
    : z === "FINISH" ? TON.fertig : TON.ruhe;
  const a = s.aktuell;
  const titel = a?.titel ?? (aktiv || z === "FINISH" || z === "FAILED" ? d.datei : null);
  const rest = aktiv ? restText(d.restMinuten) : null;
  const ende = aktiv ? fertigUm(d.restMinuten) : null;
  const farbe = farbeOk(d.spule?.farbe);

  return (
    <div className={`grid gap-4 ${darfKamera ? "lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]" : ""}`}>
      {/* ── Livebild ─────────────────────────────────────────────────────── */}
      {darfKamera && (
        <div className="space-y-2 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className={kachelTitel}>Livebild</span>
            {live && (
              <button type="button" onClick={() => setLive(false)}
                className="px-3 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-sm font-bold text-[#202F61] dark:text-[#e4e6eb] min-h-[56px]">
                Ausschalten
              </button>
            )}
          </div>
          {live ? <KameraBild /> : (
            <button type="button" onClick={() => setLive(true)}
              className="w-full min-h-[56px] lg:aspect-video rounded-xl bg-[#18191a] border border-[#3e4042] flex lg:flex-col items-center justify-center gap-2 lg:gap-1 text-white/80 hover:text-white transition-colors">
              <span className="text-xl lg:text-3xl" aria-hidden>📷</span>
              <span className="text-sm font-bold">Livebild einschalten</span>
            </button>
          )}
        </div>
      )}

      {/* ── Laufender Druck ──────────────────────────────────────────────── */}
      <div className="space-y-3 min-w-0">
        <div className="flex gap-3 items-start">
          {a?.vorschau ? (
            <button type="button" onClick={() => setDraufsicht((v) => !v)}
              aria-label={draufsicht ? "Vorschau: Draufsicht — antippen für die Plattenansicht" : "Vorschau: Plattenansicht — antippen für die Draufsicht"}
              className="shrink-0 w-24 h-24 rounded-xl bg-white border border-[#e4e8ec] dark:border-[#3e4042] p-1.5 shadow-sm">
              {/* Hell auch im Dunkelmodus: die Vorschau zeigt die Teile in Filamentfarbe (oft schwarz). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={draufsicht ? `${a.vorschau}&ansicht=oben` : a.vorschau} alt="" className="w-full h-full object-contain" />
            </button>
          ) : (
            <div className="shrink-0 w-24 h-24 rounded-xl bg-[#f5f7f9] dark:bg-[#18191a] border border-[#e4e8ec] dark:border-[#3e4042] flex items-center justify-center text-3xl" aria-hidden>
              🖨️
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className={`flex items-center gap-2 text-sm font-bold ${ton.text}`}>
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${ton.punkt} ${aktiv && !phase.pause ? "motion-safe:animate-pulse" : ""}`} aria-hidden />
              <span className="truncate">{phase.text}</span>
              {phase.schritt && <span className="font-semibold text-[#65676b] dark:text-[#b0b3b8] whitespace-nowrap">· Schritt {phase.schritt.nr} von {phase.schritt.von}</span>}
            </div>
            <div className="mt-0.5 text-lg font-black leading-snug text-[#1a1a1a] dark:text-[#e4e6eb] line-clamp-2">
              {titel ?? (z === "IDLE" ? "Bereit für den nächsten Druck" : d.zustandText)}
            </div>
            <div className="mt-0.5 text-xs text-[#65676b] dark:text-[#b0b3b8] flex flex-wrap gap-x-2">
              {a ? (
                <>
                  {gramm(a.gramm) && <span>{gramm(a.gramm)} Filament</span>}
                  {a.minutenGeplant != null && <span>· geplant {restText(a.minutenGeplant)}</span>}
                  {a.vorlageId && <Link href={`/admin/druck/${a.vorlageId}`} className="font-bold text-[#0064d2] dark:text-[#45bdff] hover:underline">· Vorlage öffnen ›</Link>}
                </>
              ) : titel ? <span>außerhalb von Lagernaut gestartet (z. B. Bambu Studio)</span> : null}
            </div>
          </div>
        </div>

        {(aktiv || z === "FINISH") && d.fortschritt != null && (
          <div>
            <div className="flex items-end justify-between gap-2 mb-1.5">
              <span className="text-3xl font-black tabular-nums leading-none text-[#1a1a1a] dark:text-[#e4e6eb]">{d.fortschritt}<span className="text-lg"> %</span></span>
              {ende && <span className="text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">fertig ca. {ende}</span>}
            </div>
            <div className="h-3 rounded-full bg-[#e9edf1] dark:bg-[#18191a] overflow-hidden" role="progressbar" aria-valuenow={d.fortschritt} aria-valuemin={0} aria-valuemax={100} aria-label="Fortschritt">
              <div className={`h-full rounded-full ${ton.balken} transition-all duration-700`} style={{ width: `${Math.max(0, Math.min(100, d.fortschritt))}%` }} />
            </div>
          </div>
        )}

        {aktiv && (
          <div className="grid grid-cols-2 gap-2">
            <div className={kachel}>
              <div className={kachelTitel}>Schicht</div>
              <div className={kachelWert}>{d.schicht != null && d.schichten ? `${d.schicht} von ${d.schichten}` : "–"}</div>
            </div>
            <div className={kachel}>
              <div className={kachelTitel}>Restzeit</div>
              <div className={kachelWert}>{rest ?? "–"}</div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-[#65676b] dark:text-[#b0b3b8]">
          {d.spule?.typ && (
            <span className="inline-flex items-center gap-1">
              Spule <b className="text-[#1a1a1a] dark:text-[#e4e6eb]">{d.spule.typ}</b>
              {farbe && <span className="inline-block w-3 h-3 rounded-full border border-[#ced4da]" style={{ background: farbe }} aria-hidden />}
            </span>
          )}
          {d.fehlercode ? <span className="font-bold text-[#c01818] dark:text-[#ff6b6b]">Der Drucker meldet einen Fehler — bitte am Drucker nachsehen</span> : null}
          {(d.meldungen ?? 0) > 0 && <span className="font-bold text-[#8A5A00] dark:text-[#f7b928]">⚠ {d.meldungen} Meldung{d.meldungen === 1 ? "" : "en"} am Drucker</span>}
        </div>
      </div>
    </div>
  );
}

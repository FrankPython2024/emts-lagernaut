"use client";

// ── Druckerkarte, oberer Teil: Livebild + laufender Druck (30.09.2026) ────────
// Wunsch Frank: Livebild kleiner, dazu ein Bild der Druckdatei, Restzeit, Schichten,
// in welchem Schritt der Drucker gerade ist — „in einem professionellen Look".
// Links das Livebild (Aus | Video | Standbild), rechts der Druck: Vorschau aus der
// .gcode.3mf, Phase im Klartext (src/lib/druck/druckerPhase.ts), Fortschritt,
// Kennzahlen. Platte, Warteschlange und Fehler bleiben darunter in DruckerStatus.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers";
import { phaseVon, tempoText, wlanText, restText, fertigUm } from "@/lib/druck/druckerPhase";
import { KameraBild } from "./KameraBild";
import { KameraVideo } from "./KameraVideo";

type Stand = inferRouterOutputs<AppRouter>["druck"]["druckerStand"];
type LiveModus = "aus" | "video" | "bild";

const TON = {
  laeuft:  { punkt: "bg-[#008BD2]", text: "text-[#0064d2] dark:text-[#45bdff]", balken: "bg-[#008BD2]" },
  pause:   { punkt: "bg-[#BA7517]", text: "text-[#8A5A00] dark:text-[#f7b928]", balken: "bg-[#BA7517]" },
  fertig:  { punkt: "bg-[#04B475]", text: "text-[#037A4F] dark:text-[#3ddc97]", balken: "bg-[#04B475]" },
  fehler:  { punkt: "bg-[#fa3e3e]", text: "text-[#c01818] dark:text-[#ff6b6b]", balken: "bg-[#fa3e3e]" },
  ruhe:    { punkt: "bg-[#65676b]", text: "text-[#4b4f56] dark:text-[#b0b3b8]", balken: "bg-[#65676b]" },
} as const;

const kachel = "rounded-xl bg-[#f5f7f9] dark:bg-[#18191a] border border-[#e4e8ec] dark:border-[#3e4042] px-3 py-2";
const kachelTitel = "text-[11px] font-bold uppercase tracking-wide text-[#65676b] dark:text-[#b0b3b8]";
const kachelWert = "text-base font-black tabular-nums text-[#1a1a1a] dark:text-[#e4e6eb]";

const grad = (ist: number | null | undefined, ziel: number | null | undefined) =>
  ist == null ? "–" : `${Math.round(ist)}°${ziel ? ` / ${Math.round(ziel)}°` : ""}`;
const gramm = (g: number | null | undefined) => (g == null ? null : `${g.toLocaleString("de-DE", { maximumFractionDigits: 1 })} g`);

function useLiveModus(): [LiveModus, (m: LiveModus) => void] {
  const [modus, setModus] = useState<LiveModus>("aus");
  useEffect(() => {
    try {
      const an = window.localStorage.getItem("druck-livebild") === "1";
      const art = window.localStorage.getItem("druck-livebild-modus") === "bild" ? "bild" : "video";
      setModus(an ? art : "aus");
    } catch { /* egal */ }
  }, []);
  const waehle = (m: LiveModus) => {
    setModus(m);
    try {
      window.localStorage.setItem("druck-livebild", m === "aus" ? "0" : "1");
      if (m !== "aus") window.localStorage.setItem("druck-livebild-modus", m);
    } catch { /* egal */ }
  };
  return [modus, waehle];
}

export function DruckerCockpit({ s }: { s: Stand }) {
  const d = s.drucker;
  const [live, setLive] = useLiveModus();
  // Draufsicht zuerst: Die meisten Drucke sind flache Füße — in der Plattenansicht
  // (schräg von vorn) nur ein Strich, von oben klar erkennbar (30.09.2026).
  const [draufsicht, setDraufsicht] = useState(true);
  if (!d) return null;

  const z = d.zustand ?? "";
  const aktiv = z === "RUNNING" || z === "PREPARE" || z === "PAUSE";
  const phase = phaseVon(d.zustand, d.zustandText, d.stufe, d.stufen);
  const ton = z === "FAILED" || d.fehlercode ? TON.fehler
    : phase.pause ? TON.pause
    : aktiv ? TON.laeuft
    : z === "FINISH" ? TON.fertig : TON.ruhe;
  const a = s.aktuell;
  const titel = a?.titel ?? (aktiv || z === "FINISH" || z === "FAILED" ? d.datei : null);
  const rest = aktiv ? restText(d.restMinuten) : null;
  const ende = aktiv ? fertigUm(d.restMinuten) : null;
  const tempo = tempoText(d.tempo);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      {/* ── Livebild ─────────────────────────────────────────────────────── */}
      <div className="space-y-2 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={kachelTitel}>Livebild</span>
          <div role="group" aria-label="Livebild" className="inline-flex rounded-lg overflow-hidden border border-[#ced4da] dark:border-[#3e4042]">
            {([["aus", "Aus"], ["video", "Video"], ["bild", "Standbild"]] as const).map(([m, text], i) => (
              <button key={m} type="button" aria-pressed={live === m} onClick={() => setLive(m)}
                className={`px-3 text-xs font-bold min-h-[36px] ${i > 0 ? "border-l border-[#ced4da] dark:border-[#3e4042]" : ""} ${live === m ? "bg-[#202F61] text-white dark:bg-[#0064d2]" : "bg-white dark:bg-[#242526] text-[#202F61] dark:text-[#e4e6eb] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"}`}>
                {text}
              </button>
            ))}
          </div>
        </div>
        {live === "video" ? <KameraVideo key="video" />
          : live === "bild" ? <KameraBild key="bild" />
          : (
            <button type="button" onClick={() => setLive("video")}
              className="w-full h-14 lg:h-auto lg:aspect-video rounded-xl bg-[#18191a] border border-[#3e4042] flex lg:flex-col items-center justify-center gap-2 lg:gap-1 text-white/70 hover:text-white transition-colors">
              <span className="text-xl lg:text-3xl" aria-hidden>📷</span>
              <span className="text-sm font-bold">Livebild einschalten</span>
            </button>
          )}
      </div>

      {/* ── Laufender Druck ──────────────────────────────────────────────── */}
      <div className="space-y-3 min-w-0">
        <div className="flex gap-3 items-start">
          {a?.vorschau ? (
            <button type="button" onClick={() => setDraufsicht((v) => !v)}
              title={draufsicht ? "Draufsicht — antippen für die Plattenansicht" : "Plattenansicht — antippen für die Draufsicht"}
              className="shrink-0 w-24 h-24 rounded-xl bg-white border border-[#e4e8ec] dark:border-[#3e4042] p-1.5 shadow-sm">
              {/* Hell auch im Dunkelmodus: die Vorschau zeigt die Teile in Filamentfarbe (oft schwarz). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={draufsicht ? `${a.vorschau}&ansicht=oben` : a.vorschau} alt="Vorschau der Druckdatei" className="w-full h-full object-contain" />
            </button>
          ) : (
            <div className="shrink-0 w-24 h-24 rounded-xl bg-[#f5f7f9] dark:bg-[#18191a] border border-[#e4e8ec] dark:border-[#3e4042] flex items-center justify-center text-3xl" aria-hidden>
              🖨️
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className={`flex items-center gap-2 text-sm font-bold ${ton.text}`}>
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${ton.punkt} ${aktiv && !phase.pause ? "animate-pulse" : ""}`} aria-hidden />
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

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className={kachel}>
            <div className={kachelTitel}>Schicht</div>
            <div className={kachelWert}>{d.schicht != null && d.schichten ? `${d.schicht} / ${d.schichten}` : "–"}</div>
          </div>
          <div className={kachel}>
            <div className={kachelTitel}>Restzeit</div>
            <div className={kachelWert}>{rest ?? "–"}</div>
          </div>
          <div className={kachel}>
            <div className={kachelTitel}>Düse</div>
            <div className={kachelWert}>{grad(d.duese, d.dueseZiel)}</div>
          </div>
          <div className={kachel}>
            <div className={kachelTitel}>Druckbett</div>
            <div className={kachelWert}>{grad(d.bett, d.bettZiel)}</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#65676b] dark:text-[#b0b3b8]">
          {d.spule?.typ && (
            <span className="inline-flex items-center gap-1">
              Spule <b className="text-[#1a1a1a] dark:text-[#e4e6eb]">{d.spule.typ}</b>
              {d.spule.farbe && <span className="inline-block w-3 h-3 rounded-full border border-[#ced4da]" style={{ background: d.spule.farbe }} aria-hidden />}
            </span>
          )}
          {tempo && <span>Tempo <b className="text-[#1a1a1a] dark:text-[#e4e6eb]">{tempo}</b></span>}
          {d.licht != null && <span>Licht <b className="text-[#1a1a1a] dark:text-[#e4e6eb]">{d.licht ? "an" : "aus"}</b></span>}
          {wlanText(d.wlan) && <span>WLAN <b className="text-[#1a1a1a] dark:text-[#e4e6eb]">{wlanText(d.wlan)}</b> ({d.wlan} dBm)</span>}
          {d.fehlercode ? <span className="font-bold text-[#c01818] dark:text-[#ff6b6b]">Fehler {d.fehlercode}</span> : null}
          {(d.meldungen ?? 0) > 0 && <span className="font-bold text-[#8A5A00] dark:text-[#f7b928]">⚠ {d.meldungen} Meldung{d.meldungen === 1 ? "" : "en"} am Drucker</span>}
        </div>
      </div>
    </div>
  );
}

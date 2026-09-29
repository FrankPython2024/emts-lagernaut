"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers";
import { api } from "@/trpc/react";
import { GRUPPEN_KURZNAME, type GruppenSchluessel } from "@/lib/pickup/technikGruppen";
import { playScanErfolg, playNegativeSound, playNochmal } from "@/lib/pickup/scanSound";

// ── Sortierhilfe am Zebra ─────────────────────────────────────────────────────
//
// LogID scannen → groß anzeigen, wohin das Gerät gehört: Zustand H / R-B bis 9 /
// ab 10 — dieselbe Regel und dieselben Namen wie die Technik-Abholaufträge.
// Anlass (Frank, 29.09.2026): Geräte vom Lagerwagen waren nicht auf das
// Wagen-Colli gebucht; beim Umbuchen in ReForm (LogID für LogID) soll man sehen,
// in welches Fach das Gerät gehört, ohne nachzuschlagen.
//
// Quelle ist der Lagerfuchs (`aktuellerZustand` + `prozessorGen`). Der Zustand
// ändert sich in der Technik — deshalb steht der Stand des letzten Imports
// immer dabei, und vor dem Sortieren gehört ein frischer Import hinein.
// Nur lesen, keine Buchung.

type Info = inferRouterOutputs<AppRouter>["pickup"]["sortierInfo"];
type Eintrag = { nr: number; roh: string; info: Info | null; fehler: boolean };

const FARBE: Record<GruppenSchluessel, string> = {
  ZUSTAND_H: "#8A5A00",
  GEN_ALT:   "#0064d2",
  GEN_NEU:   "#037A4F",
};

const berlin = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
});

function alterStunden(d: Date | string | null): number | null {
  return d ? (Date.now() - new Date(d).getTime()) / 3_600_000 : null;
}

export default function SortierenPage() {
  const utils = api.useUtils();
  const inputRef = useRef<HTMLInputElement>(null);
  const [wert, setWert] = useState("");
  const [tastatur, setTastatur] = useState(false);
  const [verlauf, setVerlauf] = useState<Eintrag[]>([]);
  const nrRef = useRef(0);

  // Scan-Feld immer bereit — wie auf der Scan-Seite der Aufträge: Taste ohne
  // Fokus, Antippen irgendwo, Rückkehr in den Tab holen das Feld zurück.
  useEffect(() => {
    const holen = () => {
      const aktiv = document.activeElement;
      if (aktiv === inputRef.current) return;
      if (aktiv && (aktiv.tagName === "INPUT" || aktiv.tagName === "TEXTAREA" || aktiv.tagName === "SELECT")) return;
      inputRef.current?.focus({ preventScroll: true });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length === 1 || e.key === "Enter") holen();
    };
    let t: ReturnType<typeof setTimeout> | null = null;
    const onTipp = () => { if (t) clearTimeout(t); t = setTimeout(holen, 150); };
    const onSichtbar = () => { if (document.visibilityState === "visible") holen(); };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerup", onTipp, true);
    document.addEventListener("visibilitychange", onSichtbar);
    holen();
    return () => {
      if (t) clearTimeout(t);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerup", onTipp, true);
      document.removeEventListener("visibilitychange", onSichtbar);
    };
  }, []);

  // Bildschirm bleibt an, solange die Seite offen ist.
  useEffect(() => {
    let sperre: { release: () => Promise<void> } | null = null;
    const holen = async () => {
      try {
        if (document.visibilityState === "visible" && "wakeLock" in navigator) {
          sperre = await (navigator as Navigator & { wakeLock: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock.request("screen");
        }
      } catch { /* nicht schlimm */ }
    };
    void holen();
    document.addEventListener("visibilitychange", holen);
    return () => { document.removeEventListener("visibilitychange", holen); void sperre?.release(); };
  }, []);

  async function scan(roh: string) {
    const eingabe = roh.trim();
    if (!eingabe) return;
    const nr = ++nrRef.current;
    setVerlauf((v) => [{ nr, roh: eingabe, info: null, fehler: false }, ...v].slice(0, 30));
    try {
      // staleTime 0: Jeder Scan fragt frisch — ein neuer Import soll sofort wirken.
      const info = await utils.pickup.sortierInfo.fetch({ logIdRaw: eingabe }, { staleTime: 0 });
      setVerlauf((v) => v.map((e) => (e.nr === nr ? { ...e, info } : e)));
      if (!info.erkannt) playNochmal();
      else if (info.gruppe) playScanErfolg();
      else playNegativeSound();
    } catch {
      setVerlauf((v) => v.map((e) => (e.nr === nr ? { ...e, fehler: true } : e)));
      playNochmal();
    }
  }

  function absenden() {
    const v = wert;
    setWert("");               // sofort leeren — der nächste Scan klebt sonst an
    if (tastatur) setTastatur(false);
    void scan(v);
  }

  const aktuell = verlauf[0] ?? null;
  const zaehler: Record<GruppenSchluessel | "OHNE", number> = { ZUSTAND_H: 0, GEN_ALT: 0, GEN_NEU: 0, OHNE: 0 };
  const gesehen = new Set<string>();
  for (const e of verlauf) {
    if (!e.info?.erkannt || gesehen.has(e.info.logId)) continue;
    gesehen.add(e.info.logId);
    zaehler[e.info.gruppe ?? "OHNE"]++;
  }
  const standInfo = verlauf.find((e) => e.info?.erkannt)?.info;
  const stand = standInfo?.erkannt ? standInfo.stand : null;
  const alter = alterStunden(stand);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-black text-[#202F61] dark:text-[#e4e6eb]">Sortieren nach Zustand &amp; Generation</h1>
        <Link href="/pickup" className="text-sm font-bold text-[#0064d2] dark:text-[#45bdff] min-h-[40px] flex items-center">← Liste</Link>
      </div>

      {/* Scan-Feld */}
      <form onSubmit={(e) => { e.preventDefault(); absenden(); }} className="flex gap-2">
        <input
          ref={inputRef}
          value={wert}
          onChange={(e) => setWert(e.target.value)}
          inputMode={tastatur ? "numeric" : "none"}
          autoComplete="off"
          placeholder="LogID scannen"
          aria-label="LogID scannen"
          className="flex-1 min-w-0 px-4 rounded-xl border-2 border-[#202F61] dark:border-[#45bdff] bg-white dark:bg-[#242526] text-lg font-mono min-h-[56px] outline-none"
        />
        <button
          type="button"
          onClick={() => { setTastatur(true); setTimeout(() => inputRef.current?.focus(), 0); }}
          className="px-3 rounded-xl border-2 border-[#ced4da] dark:border-[#3e4042] text-sm font-bold min-h-[56px] bg-white dark:bg-[#242526]"
        >
          ⌨ Von Hand
        </button>
      </form>

      {/* Ergebnis — das Wichtigste groß */}
      {!aktuell && (
        <div className="rounded-2xl border-2 border-dashed border-[#ced4da] dark:border-[#3e4042] p-6 text-center text-[#65676b] dark:text-[#b0b3b8]">
          Gerät scannen. Hier steht dann groß, wohin es gehört:
          <div className="mt-2 font-black">{GRUPPEN_KURZNAME.ZUSTAND_H} · {GRUPPEN_KURZNAME.GEN_ALT} · {GRUPPEN_KURZNAME.GEN_NEU}</div>
        </div>
      )}
      {aktuell && <Ergebnis e={aktuell} />}

      {/* Stand der Daten */}
      {stand && (
        <p className={`text-sm font-bold ${alter != null && alter > 24 ? "text-[#b3261e] dark:text-[#ff8a8a]" : "text-[#65676b] dark:text-[#b0b3b8]"}`}>
          Lagerfuchs-Stand: {berlin.format(new Date(stand))} Uhr
          {alter != null && alter > 24 && " — älter als ein Tag. Der Zustand kann sich in der Technik geändert haben: bitte frischen Export einlesen."}
        </p>
      )}

      {/* Zähler dieser Runde */}
      {gesehen.size > 0 && (
        <div className="grid grid-cols-4 gap-2 text-center">
          {(["ZUSTAND_H", "GEN_ALT", "GEN_NEU"] as const).map((g) => (
            <div key={g} className="rounded-xl p-2 text-white" style={{ background: FARBE[g] }}>
              <div className="text-2xl font-black tabular-nums">{zaehler[g]}</div>
              <div className="text-xs font-bold">{GRUPPEN_KURZNAME[g]}</div>
            </div>
          ))}
          <div className="rounded-xl p-2 bg-[#e4e6eb] dark:bg-[#3e4042]">
            <div className="text-2xl font-black tabular-nums">{zaehler.OHNE}</div>
            <div className="text-xs font-bold">unklar</div>
          </div>
        </div>
      )}

      {/* Verlauf */}
      {verlauf.length > 1 && (
        <div className="rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] divide-y divide-[#eef0f2] dark:divide-[#3e4042]">
          {verlauf.slice(1, 12).map((e) => (
            <div key={e.nr} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="font-mono font-bold">{e.info?.erkannt ? e.info.logId : e.roh}</span>
              <GruppenChip e={e} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GruppenChip({ e }: { e: Eintrag }) {
  if (e.fehler) return <span className="text-xs font-black text-[#b3261e] dark:text-[#ff8a8a]">Nochmal scannen</span>;
  if (!e.info) return <span className="text-xs text-[#65676b]">…</span>;
  if (!e.info.erkannt) return <span className="text-xs font-black text-[#b3261e] dark:text-[#ff8a8a]">keine LogID</span>;
  if (!e.info.gruppe) return <span className="text-xs font-black px-2 py-1 rounded-full bg-[#e4e6eb] dark:bg-[#3e4042]">unklar</span>;
  return (
    <span className="text-xs font-black px-2 py-1 rounded-full text-white" style={{ background: FARBE[e.info.gruppe] }}>
      {GRUPPEN_KURZNAME[e.info.gruppe]}
    </span>
  );
}

function Ergebnis({ e }: { e: Eintrag }) {
  const gross = "rounded-2xl p-5 text-center shadow-sm";
  if (e.fehler) {
    return (
      <div className={`${gross} bg-[#b3261e] text-white`}>
        <div className="text-3xl font-black">Nochmal scannen</div>
        <div className="text-sm mt-1">Keine Verbindung zu Lagernaut.</div>
      </div>
    );
  }
  if (!e.info) {
    return <div className={`${gross} bg-[#e4e6eb] dark:bg-[#3e4042] text-xl font-black`}>… {e.roh}</div>;
  }
  const i = e.info;
  if (!i.erkannt) {
    return (
      <div className={`${gross} bg-[#b3261e] text-white`}>
        <div className="text-3xl font-black">Nochmal scannen</div>
        <div className="text-sm mt-1 font-mono break-all">„{i.eingabe}" ist keine LogID</div>
      </div>
    );
  }
  const details = (
    <>
      <div className="text-2xl font-black font-mono mt-2">{i.logId}</div>
      {i.geraet && <div className="text-sm mt-1 opacity-90 line-clamp-2">{i.geraet}</div>}
      {(i.stellplatz || i.colli) && (
        <div className="text-xs mt-1 opacity-90">
          laut Lagerfuchs: {[i.stellplatz, i.colli ? `Colli ${i.colli}` : null].filter(Boolean).join(" · ")}
        </div>
      )}
      {i.ausgeschieden && <div className="text-sm font-black mt-1">⚠ Im letzten Lagerfuchs nicht mehr enthalten</div>}
    </>
  );
  if (!i.gefunden) {
    return (
      <div className={`${gross} bg-[#4b4f56] text-white`}>
        <div className="text-3xl font-black">Nicht im Lagerfuchs</div>
        <div className="text-sm mt-1">Zustand und Generation unbekannt — in ReForm nachsehen.</div>
        {details}
      </div>
    );
  }
  if (!i.gruppe) {
    return (
      <div className={`${gross} bg-[#4b4f56] text-white`}>
        <div className="text-3xl font-black">Unklar</div>
        <div className="text-base font-bold mt-1">
          Zustand {i.zustand ?? "—"} · {i.generation != null ? `Generation ${i.generation}` : "keine Generation"}
        </div>
        <div className="text-sm mt-1">Weder „H" noch eine Generation — bitte in ReForm prüfen.</div>
        {details}
      </div>
    );
  }
  return (
    <div className={`${gross} text-white`} style={{ background: FARBE[i.gruppe] }}>
      <div className="text-5xl font-black leading-tight">{GRUPPEN_KURZNAME[i.gruppe]}</div>
      <div className="text-xl font-bold mt-2">
        Zustand {i.zustand ?? "—"} · {i.generation != null ? `Generation ${i.generation}` : "Generation —"}
      </div>
      {details}
    </div>
  );
}

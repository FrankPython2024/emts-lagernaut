"use client";
import { useEffect, useState } from "react";
import type { Buendel } from "@/lib/anfragen/gleicheTeile";
import { ohneSpenderSuche } from "@/lib/anfragen/kategorie";

// ── Gleiche Teile gesammelt ───────────────────────────────────────────────────
//
// Steht über der Anfragen-Liste: je Bündel eine Überschrift („6× Akku · Dell
// Latitude 7490 — für folgende Anfragen") und die Anfragen direkt darunter,
// ohne Aufklappen (Wunsch Frank, 29.09.2026). Antippen einer Zeile springt zur
// Anfrage in der Liste — dort wird sie bearbeitet, hier nur gebündelt gezeigt.
// Die Regel, was gleich ist, steht in src/lib/anfragen/gleicheTeile.ts.

export type BuendelZeile = {
  id:            number;
  logId:         string;
  techniker:     string;
  datum:         Date | string;
  status:        string;
  menge:         number;
  bearbeitetVon: string | null;
  geraeteName:   string | null;
  /** Anker der Gruppe in der Liste (`gruppe-<key>`). */
  gruppenKey:    string;
};

type Props = {
  buendel:   Buendel[];
  zeilen:    ReadonlyMap<number, BuendelZeile>;
  /** Teilespender-Suche für alle Anfragen des Bündels; fehlt ohne Recht. */
  onSpender?: (b: { geraeteName: string; teil: string; logIds: string[] }) => void;
  /** Neues Design: eine Zeile je Bündel, Anfragen erst auf Wunsch. */
  kompakt?: boolean;
};

const STATUS_WORT: Record<string, string> = {
  NEU:            "Neu",
  IN_BEARBEITUNG: "In Arbeit",
  BEDARF:         "Zu erledigen",
};

const STATUS_CLS: Record<string, string> = {
  NEU:            "bg-blue-100 text-blue-900 dark:bg-blue-900/50 dark:text-blue-100",
  IN_BEARBEITUNG: "bg-violet-100 text-violet-900 dark:bg-violet-900/50 dark:text-violet-100",
  BEDARF:         "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100",
};

const berlinTag = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });
const berlinUhr = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
const berlinKurz = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit" });

/** „heute 05:29", „gestern 13:43", sonst „25.09. 13:43". */
function wann(d: Date | string): string {
  const t = new Date(d);
  const tag = berlinTag.format(t);
  const heute = new Date();
  const gestern = new Date(heute.getTime() - 86_400_000);
  const vorn = tag === berlinTag.format(heute) ? "heute"
    : tag === berlinTag.format(gestern) ? "gestern"
    : berlinKurz.format(t);
  return `${vorn} ${berlinUhr.format(t)}`;
}

/** Häufigster Wert — der Gerätename, unter dem das Bündel erscheint. */
function haeufigster(werte: string[]): string {
  const n = new Map<string, number>();
  for (const w of werte) n.set(w, (n.get(w) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

function springeZu(gruppenKey: string): void {
  const el = document.getElementById(`gruppe-${gruppenKey}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("ring-4", "ring-[#008BD2]");
  window.setTimeout(() => el.classList.remove("ring-4", "ring-[#008BD2]"), 2200);
}

const MERKER = "anfragen-gleiche-teile-zu";

export function GleicheTeile({ buendel, zeilen, onSpender, kompakt }: Props) {
  const [zu, setZu] = useState(false);
  const [aufgeklappt, setAufgeklappt] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    try { setZu(window.localStorage.getItem(MERKER) === "1"); } catch { /* egal */ }
  }, []);
  function umschalten(): void {
    setZu((v) => {
      try { window.localStorage.setItem(MERKER, v ? "0" : "1"); } catch { /* egal */ }
      return !v;
    });
  }

  if (buendel.length === 0) return null;
  const summe = buendel.reduce((s, b) => s + b.anfrageIds.length, 0);

  return (
    <section
      aria-label="Gleiche Teile, mehrfach angefragt"
      className="rounded-xl border-2 border-[#008BD2] bg-[#f2f9fd] dark:bg-[#0d2233] dark:border-[#3aa8e0] shadow-sm overflow-hidden"
    >
      <button
        type="button"
        onClick={umschalten}
        aria-expanded={!zu}
        className="w-full flex items-center justify-between gap-3 px-5 min-h-[56px] text-left hover:bg-[#e3f2fb] dark:hover:bg-[#12304a] transition-colors"
      >
        <span className="font-black text-base text-[#202F61] dark:text-[#e4e6eb]">
          🔗 Gleiche Teile mehrfach angefragt
          <span className="ml-2 font-bold text-sm text-[#3a4a5c] dark:text-[#b0b3b8]">
            {buendel.length} {buendel.length === 1 ? "Teil" : "Teile"} · {summe} Anfragen
          </span>
        </span>
        <span className="text-sm font-bold text-[#202F61] dark:text-[#b0b3b8] whitespace-nowrap">
          {zu ? "▼ Anzeigen" : "▲ Einklappen"}
        </span>
      </button>

      {!zu && (
        <div className="px-3 pb-3 space-y-3">
          {buendel.map((b) => {
            const liste = b.anfrageIds.map((id) => zeilen.get(id)).filter((z): z is BuendelZeile => !!z);
            if (liste.length === 0) return null;
            const geraet = haeufigster(liste.map((z) => z.geraeteName ?? "").filter(Boolean)) || "Unbekanntes Gerät";
            const stueck = liste.reduce((s, z) => s + z.menge, 0);
            const proTechniker = new Map<string, number>();
            for (const z of liste) proTechniker.set(z.techniker, (proTechniker.get(z.techniker) ?? 0) + 1);
            const logIds = liste.map((z) => z.logId).filter((l) => l && l !== "unbekannt");

            if (kompakt) {
              const offen = aufgeklappt.has(b.key);
              const seit = liste.reduce((m, z) => (new Date(z.datum) < new Date(m) ? z.datum : m), liste[0]!.datum);
              return (
                <div key={b.key} className="rounded-lg bg-white dark:bg-[#242526] border border-[#d9dde3] dark:border-[#3e4042]">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 min-h-[52px]">
                    <strong className="text-base text-[#202F61] dark:text-[#e4e6eb]">{liste.length}× {b.teil} · {geraet}</strong>
                    <span className="text-sm text-[#5f6368] dark:text-[#b0b3b8]">
                      {[...proTechniker.entries()].map(([k, n]) => (n > 1 ? `${k} ${n}×` : k)).join(", ")} · seit {wann(seit)}
                      {stueck !== liste.length && <> · {stueck} Stück</>}
                    </span>
                    <span className="ml-auto flex gap-1">
                      {onSpender && !ohneSpenderSuche(b.teil) && (
                        <button type="button" onClick={() => onSpender({ geraeteName: geraet, teil: b.teil, logIds })}
                          className="min-h-[44px] px-3 rounded-lg text-sm font-bold text-[#0064d2] dark:text-[#45bdff] hover:bg-[#f0f7fc] dark:hover:bg-[#2d3a45]">
                          Spender suchen
                        </button>
                      )}
                      <button type="button" aria-expanded={offen}
                        onClick={() => setAufgeklappt((alt) => { const n = new Set(alt); if (n.has(b.key)) n.delete(b.key); else n.add(b.key); return n; })}
                        className="min-h-[44px] px-3 rounded-lg text-sm font-bold text-[#0064d2] dark:text-[#45bdff] hover:bg-[#f0f7fc] dark:hover:bg-[#2d3a45]">
                        {offen ? "Anfragen ausblenden" : "Anfragen zeigen"}
                      </button>
                    </span>
                  </div>
                  {offen && (
                    <ul className="border-t border-[#eef3f7] dark:border-[#3e4042]">
                      {liste.map((z) => (
                        <li key={z.id}>
                          <button type="button" onClick={() => springeZu(z.gruppenKey)}
                            className="w-full flex flex-wrap items-center gap-x-3 px-4 py-2 min-h-[44px] text-left text-sm hover:bg-[#f0f7fc] dark:hover:bg-[#2d3a45]">
                            <span className="font-mono font-bold text-[#202F61] dark:text-[#e4e6eb] w-32 shrink-0">{z.logId}</span>
                            <span className="font-bold w-12 shrink-0">{z.techniker}</span>
                            <span className="text-[#5f6368] dark:text-[#b0b3b8]">{wann(z.datum)} · {STATUS_WORT[z.status] ?? z.status}</span>
                            <span className="ml-auto font-bold text-[#0064d2] dark:text-[#45bdff]">zur Anfrage</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            }

            return (
              <div key={b.key} className="rounded-lg border border-[#b9d9ec] dark:border-[#2a4a63] bg-white dark:bg-[#242526]">
                {/* Überschrift: was fehlt, wie oft, für wen */}
                <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[#e3eef5] dark:border-[#3e4042]">
                  <div className="min-w-0">
                    <h3 className="font-black text-lg leading-tight text-[#1a1a1a] dark:text-[#e4e6eb]">
                      {liste.length}× {b.teil} · {geraet}
                    </h3>
                    <p className="text-sm text-[#3a4a5c] dark:text-[#b0b3b8] mt-0.5">
                      für folgende Anfragen
                      {stueck !== liste.length && <> · <strong>{stueck} Stück</strong></>}
                      {" · "}
                      {[...proTechniker.entries()].map(([k, n]) => `${k} ${n}`).join(" · ")}
                    </p>
                  </div>
                  {/* Füße kommen aus dem 3D-Druck — keine Spendersuche (Frank, 09.10.2026). */}
                  {onSpender && !ohneSpenderSuche(b.teil) && (
                    <button
                      type="button"
                      onClick={() => onSpender({ geraeteName: geraet, teil: b.teil, logIds })}
                      title={`${b.teil} für ${geraet} in Verwertungsgeräten suchen`}
                      className="shrink-0 px-3 py-2.5 bg-[#202F61] text-white text-xs font-bold rounded-lg hover:bg-[#2b3f80] transition-colors min-h-[44px]"
                    >
                      🔍 Spender suchen
                    </button>
                  )}
                </div>

                {/* Die Anfragen — älteste zuerst, Antippen springt in die Liste */}
                <ul>
                  {liste.map((z) => (
                    <li key={z.id} className="border-b last:border-b-0 border-[#eef3f7] dark:border-[#3e4042]">
                      <button
                        type="button"
                        onClick={() => springeZu(z.gruppenKey)}
                        className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 min-h-[48px] text-left hover:bg-[#f0f7fc] dark:hover:bg-[#2d3a45] transition-colors"
                      >
                        <span className="font-mono font-black text-base text-[#1a1a1a] dark:text-[#e4e6eb] w-32 shrink-0">{z.logId}</span>
                        <span className="font-bold text-sm text-[#1a1a1a] dark:text-[#e4e6eb] w-12 shrink-0">{z.techniker}</span>
                        <span className="text-sm text-[#3a4a5c] dark:text-[#b0b3b8] w-28 shrink-0">{wann(z.datum)}</span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_CLS[z.status] ?? "bg-slate-100 text-slate-800"}`}>
                          {STATUS_WORT[z.status] ?? z.status}
                          {z.status === "IN_BEARBEITUNG" && z.bearbeitetVon ? ` · ${z.bearbeitetVon}` : ""}
                        </span>
                        {z.menge > 1 && (
                          <span className="text-xs font-black px-2 py-0.5 rounded-full bg-yellow-200 text-yellow-900 whitespace-nowrap">{z.menge}× Stück</span>
                        )}
                        <span className="ml-auto text-xs font-bold text-[#0064d2] dark:text-[#6fb6ff] whitespace-nowrap">↓ zur Anfrage</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

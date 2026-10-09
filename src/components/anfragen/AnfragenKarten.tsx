"use client";

// ── Anfragen als Karten — „neues Design" (Frank, 09.10.2026) ──────────────────
//
// Dritte Ansicht neben Liste und Board, zum Vergleichen umschaltbar; die alte
// Liste bleibt unverändert. Gleiche Daten und Handler wie die Liste.
// Grundregeln (aus der Analyse vom 09.10.2026):
//   • Farbe heißt nur „Achtung" oder „Handeln": Karten weiß, Status als Kante +
//     Wort; Grün nur „auf Lager"/„Erledigt", Rot nur überfällig/Löschen, EINE
//     Handlungsfarbe (Blau) für den nächsten Schritt.
//   • Lesereihenfolge oben → unten: Gerät, Teile, Handeln (Knöpfe in der Fußleiste).
//   • Genau EIN gefüllter Hauptknopf je Zustand; Seltenes und Gefährliches
//     (Stornieren, Teil fehlt, Löschen, Gruppe löschen) im „⋯"-Menü.
//   • Füße: keine Spendersuche, keine Verwertungsgeräte-Hinweise (3D-Druck).

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { AnfrageStatus } from "@prisma/client";
import type { AppRouter } from "@/server/routers";
import { istOffen, istUeberfaellig, verstricheneZeit } from "@/lib/anfragen/ueberfaellig";
import { ohneSpenderSuche } from "@/lib/anfragen/kategorie";
import { maxMengeFuer, teilAnzeige } from "@/lib/constants/teiltypen";

type RouterOutputs = inferRouterOutputs<AppRouter>;
export type KartenGruppe  = RouterOutputs["anfragen"]["getGruppiert"][number];
type KartenAnfrage        = KartenGruppe["anfragen"][number] & {
  bearbeitetVon?: string | null; bearbeitetSeit?: Date | string | null;
  istSonderAnfrage?: boolean; beschreibung?: string | null;
};
type TeilespenderHinweise = RouterOutputs["teilespender"]["hinweiseFuerAnfragen"];
type SpenderHinweise      = RouterOutputs["spenderGeraet"]["hinweiseFuerAnfragen"];
type DruckHinweise        = RouterOutputs["druck"]["druckFuerAnfragen"];

export type AnfragenKartenProps = {
  gruppen:   KartenGruppe[];
  ersteller: string;
  now:       number;
  canEdit:   boolean;
  canDelete: boolean;
  canSpender: boolean;
  isBusy:    boolean;
  auslagerInfo: (gruppenKey: string) => { anzahlVerfuegbar: number; anzahlTotal: number } | undefined;
  druckHinweise:        DruckHinweise;
  teilespenderHinweise: TeilespenderHinweise;
  spenderHinweise:      SpenderHinweise;
  technikerStorniert:   ReadonlySet<number>;
  chatUngelesen:  (g: KartenGruppe) => number;
  // Gruppe
  onUebernehmen:   (g: KartenGruppe) => void;
  onZurueckgeben:  (g: KartenGruppe) => void;
  onFreigeben:     (g: KartenGruppe) => void;
  onAuslagern:     (g: KartenGruppe, anfrageIds: number[]) => void;
  onSpender:       (g: KartenGruppe, teiltypen: string[]) => void;
  onChat:          (g: KartenGruppe) => void;
  onAlleErledigen: (g: KartenGruppe) => void;
  onGruppeLoeschen:(g: KartenGruppe) => void;
  // Teil
  onTeilErledigen:       (id: number, gruppenLabel: string) => void;
  onTeilStornieren:      (id: number) => void;
  onTeilNichtVerfuegbar: (id: number, label: string) => void;
  onTeilLoeschen:        (id: number, label: string) => void;
  onTeilReprint:         (a: KartenAnfrage) => void;
  onTeilZuruecksetzen:   (id: number) => void;
};

export function gruppenSchluessel(g: KartenGruppe): string {
  return g.gruppenNr ?? `${g.techniker}__${g.logId}`;
}

// ── Status: Kante + Wort, sonst nichts ────────────────────────────────────────
const STATUS: Record<string, { wort: string; kante: string; text: string }> = {
  NEU:              { wort: "Neu",          kante: "border-l-[#0064d2] dark:border-l-[#45bdff]", text: "text-[#0064d2] dark:text-[#45bdff]" },
  BEDARF:           { wort: "Zu erledigen", kante: "border-l-[#8A5A00] dark:border-l-[#f7b928]", text: "text-[#8A5A00] dark:text-[#f7b928]" },
  IN_BEARBEITUNG:   { wort: "In Arbeit",    kante: "border-l-[#5b3fb8] dark:border-l-[#b9a6ff]", text: "text-[#5b3fb8] dark:text-[#b9a6ff]" },
  ABGESCHLOSSEN:    { wort: "Erledigt",     kante: "border-l-[#9aa0a6]",                          text: "text-[#5f6368] dark:text-[#b0b3b8]" },
  STORNIERT:        { wort: "Erledigt",     kante: "border-l-[#9aa0a6]",                          text: "text-[#5f6368] dark:text-[#b0b3b8]" },
  NICHT_VERFUEGBAR: { wort: "Kein Teil",    kante: "border-l-[#9aa0a6]",                          text: "text-[#5f6368] dark:text-[#b0b3b8]" },
};

const knopfHaupt = "inline-flex items-center gap-2 px-5 min-h-[52px] rounded-xl bg-[#0064d2] text-white font-bold text-[15px] hover:bg-[#0056b3] disabled:opacity-45 disabled:cursor-not-allowed transition-colors";
const knopfNeben = "inline-flex items-center gap-2 px-4 min-h-[52px] rounded-xl border-2 border-[#d9dde3] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-[#202F61] dark:text-[#e4e6eb] font-bold text-[15px] hover:border-[#0064d2] disabled:opacity-45 disabled:cursor-not-allowed transition-colors";
const zahlCls    = "inline-flex items-center justify-center min-w-[22px] px-1.5 rounded-full bg-[#0064d2] text-white text-xs font-bold";

// ── „⋯"-Menü ───────────────────────────────────────────────────────────────────
type MenuePunkt = { label: string; onClick: () => void; gefahr?: boolean; disabled?: boolean; trennerDavor?: boolean };

function Mehr({ punkte, name }: { punkte: MenuePunkt[]; name: string }) {
  const [offen, setOffen] = useState(false);
  const huelle = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!offen) return;
    const zu = (e: MouseEvent) => { if (!huelle.current?.contains(e.target as Node)) setOffen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOffen(false); };
    document.addEventListener("mousedown", zu);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", zu); document.removeEventListener("keydown", esc); };
  }, [offen]);
  if (punkte.length === 0) return null;
  return (
    <span ref={huelle} className="relative inline-flex">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={offen}
        aria-label={`Weitere Aktionen: ${name}`}
        onClick={() => setOffen((v) => !v)}
        className="min-h-[48px] min-w-[48px] rounded-xl border-2 border-[#d9dde3] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-[#5f6368] dark:text-[#b0b3b8] text-lg font-bold leading-none hover:border-[#0064d2]"
      >
        ⋯
      </button>
      {offen && (
        <span role="menu" className="absolute right-0 top-[54px] z-20 w-64 rounded-xl border border-[#d9dde3] dark:border-[#3e4042] bg-white dark:bg-[#242526] shadow-[0_8px_24px_rgba(32,47,97,0.18)] p-1.5">
          {punkte.map((p) => (
            <span key={p.label} className="block">
              {p.trennerDavor && <span className="block my-1.5 border-t border-[#d9dde3] dark:border-[#3e4042]" aria-hidden />}
              <button
                type="button"
                role="menuitem"
                disabled={p.disabled}
                onClick={() => { setOffen(false); p.onClick(); }}
                className={`block w-full text-left min-h-[44px] px-3 rounded-lg text-[15px] disabled:opacity-45 hover:bg-[#f3f4f7] dark:hover:bg-[#3e4042] ${p.gefahr ? "text-[#c01818] dark:text-[#ff8a8a] font-bold" : "text-[#202F61] dark:text-[#e4e6eb]"}`}
              >
                {p.label}
              </button>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

function Zeile({ children, cls = "" }: { children: ReactNode; cls?: string }) {
  return <div className={`text-sm ${cls}`}>{children}</div>;
}

/** Zur Karte springen und kurz umranden (wie „Gleiche Teile"). */
function springeZuKarte(key: string): void {
  const el = document.getElementById(`gruppe-${key}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("ring-4", "ring-[#0064d2]");
  window.setTimeout(() => el.classList.remove("ring-4", "ring-[#0064d2]"), 2200);
}

// ── Eine Karte ─────────────────────────────────────────────────────────────────
// `geschwister` = andere Gruppen mit DERSELBEN LogID (getrennt abgeschickte
// Anfragen zum selben Gerät, 09.10.2026 live gesehen: 212.992.326 zweimal).
function Karte(p: AnfragenKartenProps & { g: KartenGruppe; geschwister: KartenGruppe[] }) {
  const { g, ersteller, now, canEdit, canDelete, isBusy } = p;
  const teile = g.anfragen as KartenAnfrage[];
  const key = gruppenSchluessel(g);
  const label = g.geraeteName ?? g.logId;

  const gesperrtVon = teile.find((a) => a.bearbeitetVon)?.bearbeitetVon ?? null;
  const gesperrtSeit = teile.find((a) => a.bearbeitetVon)?.bearbeitetSeit ?? null;
  const vonMir   = !!gesperrtVon && gesperrtVon.toUpperCase() === ersteller.toUpperCase();
  const vonAnderem = !!gesperrtVon && !vonMir;
  const alleDone = teile.every((a) => a.status === AnfrageStatus.ABGESCHLOSSEN || a.status === AnfrageStatus.STORNIERT);
  const nehmbar  = teile.some((a) => (a.status === AnfrageStatus.NEU || a.status === AnfrageStatus.BEDARF) && !a.bearbeitetVon);
  const offeneIds = teile
    .filter((a) => a.status !== AnfrageStatus.ABGESCHLOSSEN && a.status !== AnfrageStatus.STORNIERT && a.status !== AnfrageStatus.NICHT_VERFUEGBAR)
    .map((a) => a.id);
  const lager = p.auslagerInfo(key);
  const aufLager = !alleDone && (lager?.anzahlVerfuegbar ?? 0) > 0 && offeneIds.length > 0;

  // Spendersuche: nur offene, normale Teile — und nie Füße (3D-Druck).
  const spenderTeiltypen = [...new Set(teile
    .filter((a) => !a.istSonderAnfrage && istOffen(a.status) && !ohneSpenderSuche(a.teil, a.beschreibung))
    .map((a) => a.teil))];
  const spenderMoeglich = p.canSpender && !!g.geraeteName && spenderTeiltypen.length > 0;
  const spenderTreffer = teile.filter((a) => !ohneSpenderSuche(a.teil, a.beschreibung) && (p.teilespenderHinweise[a.id]?.anzahl ?? 0) > 0).length;

  const ueberfaellig = teile.some((a) => istUeberfaellig(a.status, a.createdAt, now, a.teil));
  const aeltestes = teile.filter((a) => istOffen(a.status)).map((a) => new Date(a.createdAt).getTime());
  const alter = aeltestes.length ? verstricheneZeit(new Date(Math.min(...aeltestes)), now) : null;
  const status = STATUS[g.gruppenStatus] ?? STATUS.NEU!;
  const chat = p.chatUngelesen(g);
  const istTest = teile.some((a) => a.testModus);

  // ── Hauptknopf je Zustand ──
  type Knopf = { label: string; onClick: () => void; disabled?: boolean };
  let haupt: Knopf | null = null;
  const neben: Knopf[] = [];
  if (canEdit && !alleDone) {
    if (vonAnderem) {
      neben.push({ label: "Freigeben", onClick: () => p.onFreigeben(g) });
    } else if (!gesperrtVon && nehmbar) {
      haupt = { label: "Übernehmen", onClick: () => p.onUebernehmen(g), disabled: isBusy };
      if (aufLager) neben.push({ label: "Auslagern", onClick: () => p.onAuslagern(g, offeneIds) });
    } else if (vonMir) {
      haupt = aufLager
        ? { label: "Auslagern", onClick: () => p.onAuslagern(g, offeneIds) }
        : { label: "Alle erledigt", onClick: () => p.onAlleErledigen(g), disabled: isBusy };
      neben.push({ label: "Zurückgeben", onClick: () => p.onZurueckgeben(g), disabled: isBusy });
    } else if (aufLager) {
      haupt = { label: "Auslagern", onClick: () => p.onAuslagern(g, offeneIds) };
    }
  }
  const geraeteMenue: MenuePunkt[] = [];
  if (canEdit && !alleDone && !vonAnderem && haupt?.label !== "Alle erledigt") {
    geraeteMenue.push({ label: "Alle erledigt", onClick: () => p.onAlleErledigen(g), disabled: isBusy });
  }
  if (canDelete && g.gruppenNr) {
    geraeteMenue.push({ label: "Ganze Gruppe löschen", onClick: () => p.onGruppeLoeschen(g), gefahr: true, trennerDavor: geraeteMenue.length > 0 });
  }

  return (
    <article
      id={`gruppe-${key}`}
      aria-label={`${label}, ${g.logId}`}
      className={`flex flex-col rounded-2xl border border-[#d9dde3] dark:border-[#3e4042] border-l-[6px] ${status.kante} ${vonAnderem || alleDone ? "bg-[#f7f7f9] dark:bg-[#1f2021]" : "bg-white dark:bg-[#242526]"} transition-shadow`}
    >
      {/* Kopf: Gerät groß, darunter LogID + Status; rechts wer und wie lange */}
      <header className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-5 pt-4 pb-3">
        <h3 className="text-xl font-bold leading-tight text-[#202F61] dark:text-[#e4e6eb] min-w-0 break-words">{g.geraeteName ?? "Gerät unbekannt"}</h3>
        <div className="text-right font-bold text-[15px] text-[#202F61] dark:text-[#e4e6eb]">{g.techniker}</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 min-w-0">
          <span className="font-mono font-bold text-[17px] tracking-wide text-[#202F61] dark:text-[#e4e6eb]">{g.logId}</span>
          <span className={`text-sm font-bold ${status.text}`}><span aria-hidden>● </span>{status.wort}</span>
          {aufLager && lager && (
            <span className="px-3 py-0.5 rounded-full bg-[#037A4F] text-white text-sm font-bold">
              {lager.anzahlVerfuegbar >= lager.anzahlTotal
                ? (lager.anzahlTotal === 1 ? "Teil auf Lager" : `Alle ${lager.anzahlTotal} Teile auf Lager`)
                : `${lager.anzahlVerfuegbar} von ${lager.anzahlTotal} auf Lager`}
            </span>
          )}
          {gesperrtVon && (
            <span className={`px-3 py-0.5 rounded-full text-sm font-bold ${vonMir ? "bg-[#e8f0fe] text-[#0b3d91] dark:bg-[#1c3a63] dark:text-[#cfe0ff]" : "bg-[#fff1d6] text-[#6b4700] dark:bg-[#4a3500] dark:text-[#ffe2a8]"}`}>
              {vonMir ? "Du bearbeitest" : `${gesperrtVon} bearbeitet`}
              {gesperrtSeit ? ` seit ${new Date(gesperrtSeit).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })}` : ""}
            </span>
          )}
          {istTest && <span className="px-2 py-0.5 rounded bg-yellow-300 text-yellow-900 text-xs font-bold">Test</span>}
        </div>
        <div className={`text-right text-sm whitespace-nowrap ${ueberfaellig ? "font-bold text-[#c01818] dark:text-[#ff8a8a]" : "text-[#5f6368] dark:text-[#b0b3b8]"}`}>
          {alleDone || !alter
            ? new Date(g.datum).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })
            : ueberfaellig ? `überfällig · ${alter.replace(/^vor /, "seit ")}` : alter}
        </div>
      </header>

      {p.geschwister.length > 0 && (
        <div className="px-5 pb-2 -mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-[#5f6368] dark:text-[#b0b3b8]">
          <span>{p.geschwister.length === 1 ? "Noch eine Anfrage" : `Noch ${p.geschwister.length} Anfragen`} zu diesem Gerät:</span>
          {p.geschwister.map((s) => (
            <button key={gruppenSchluessel(s)} type="button" onClick={() => springeZuKarte(gruppenSchluessel(s))}
              className="font-bold text-[#0064d2] dark:text-[#45bdff] hover:underline">
              {s.anfragen.map((x) => (!(x as KartenAnfrage).beschreibung && maxMengeFuer(x.teil) > 1 ? teilAnzeige(x.teil, x.menge ?? 1) : ((x as KartenAnfrage).beschreibung ?? x.teil))).join(", ")} ({s.techniker})
            </button>
          ))}
        </div>
      )}

      {istTest && (
        <p className="px-5 pb-2 text-xs font-semibold text-yellow-800 dark:text-yellow-300">Test-Anfrage: zählt nicht in der Statistik, Auslagern ändert keinen echten Bestand.</p>
      )}

      {/* Teile */}
      <div className="border-t border-[#d9dde3] dark:border-[#3e4042]">
        {teile.map((a, i) => {
          const zeileGesperrt = !!a.bearbeitetVon && a.bearbeitetVon.toUpperCase() !== ersteller.toUpperCase();
          const name = !a.beschreibung && maxMengeFuer(a.teil) > 1 ? teilAnzeige(a.teil, a.menge ?? 1) : (a.beschreibung ?? a.teil);
          const fuss = ohneSpenderSuche(a.teil, a.beschreibung);
          const druck = p.druckHinweise[a.id];
          const ts = fuss ? undefined : p.teilespenderHinweise[a.id];
          const sg = fuss ? undefined : p.spenderHinweise[a.id];
          const erledigbar = canEdit && a.status !== AnfrageStatus.ABGESCHLOSSEN && a.status !== AnfrageStatus.STORNIERT;
          const menue: MenuePunkt[] = [];
          if (canEdit && istOffen(a.status)) menue.push({ label: "Teil nicht verfügbar", onClick: () => p.onTeilNichtVerfuegbar(a.id, name), disabled: isBusy || zeileGesperrt });
          if (canEdit && (a.status === AnfrageStatus.NEU || a.status === AnfrageStatus.BEDARF)) menue.push({ label: "Stornieren", onClick: () => p.onTeilStornieren(a.id), disabled: isBusy || zeileGesperrt });
          if (a.status === AnfrageStatus.ABGESCHLOSSEN) menue.push({ label: "Beleg nachdrucken", onClick: () => p.onTeilReprint(a) });
          if (canEdit && a.status === AnfrageStatus.ABGESCHLOSSEN) menue.push({ label: "Zurücksetzen (Ausgabe rückgängig)", onClick: () => p.onTeilZuruecksetzen(a.id), disabled: isBusy });
          if (canDelete) menue.push({ label: "Anfrage löschen", onClick: () => p.onTeilLoeschen(a.id, name), gefahr: true, trennerDavor: menue.length > 0 });

          return (
            <div key={a.id} id={`row-${a.id}`}
              className={`grid grid-cols-[1fr_auto_auto] items-center gap-x-2.5 gap-y-1 px-5 py-3 ${i > 0 ? "border-t border-dashed border-[#d9dde3] dark:border-[#3e4042]" : ""} ${zeileGesperrt ? "opacity-70" : ""}`}>
              <div className="min-w-0">
                <span className={`text-[17px] font-bold ${a.status === AnfrageStatus.STORNIERT ? "line-through text-[#5f6368]" : "text-[#202F61] dark:text-[#e4e6eb]"}`}>
                  {name}
                </span>
                {(a.menge ?? 1) > 1 && (a.beschreibung || maxMengeFuer(a.teil) <= 1) && (
                  <span className="ml-2 text-sm font-bold text-[#8A5A00] dark:text-[#f7b928]">{a.menge} Stück</span>
                )}
                {a.grading && <span className="ml-2 text-sm font-bold text-[#5f6368] dark:text-[#b0b3b8]">Grading {a.grading} erwünscht</span>}
                {a.istSonderAnfrage && <span className="ml-2 text-sm font-bold text-[#8A5A00] dark:text-[#f7b928]">Sonderanfrage</span>}
              </div>
              {a.status === AnfrageStatus.ABGESCHLOSSEN ? (
                <span className="text-sm font-bold text-[#037A4F] dark:text-[#3ddc97]">✓ Erledigt</span>
              ) : a.status === AnfrageStatus.STORNIERT ? (
                <span className="text-sm font-bold text-[#5f6368] dark:text-[#b0b3b8]">Storniert</span>
              ) : erledigbar ? (
                <button
                  type="button"
                  onClick={() => !zeileGesperrt && p.onTeilErledigen(a.id, label)}
                  disabled={isBusy || zeileGesperrt}
                  title={zeileGesperrt ? `Gesperrt von ${a.bearbeitetVon}` : undefined}
                  className="min-h-[48px] px-4 rounded-xl border-2 border-[#037A4F] dark:border-[#3ddc97] bg-white dark:bg-[#242526] text-[#037A4F] dark:text-[#3ddc97] font-bold text-[15px] hover:bg-[#e8f6ef] dark:hover:bg-[#123528] disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  Erledigt
                </button>
              ) : <span />}
              <Mehr punkte={menue} name={name} />

              {/* Zusatz: Kommentar als Zitat, dann EINE Zeile je Bezugsquelle */}
              <div className="col-span-3 flex flex-col gap-1 empty:hidden">
                {a.kommentar && (
                  <Zeile cls="border-l-[3px] border-[#d9dde3] dark:border-[#3e4042] pl-2.5 text-[#2b2f36] dark:text-[#d6d9de]">
                    „{a.kommentar}“ <span className="text-xs text-[#5f6368] dark:text-[#b0b3b8]">{a.techniker}</span>
                  </Zeile>
                )}
                {a.status === AnfrageStatus.NICHT_VERFUEGBAR && <Zeile cls="font-bold text-[#5f6368] dark:text-[#b0b3b8]">Teil fehlt</Zeile>}
                {p.technikerStorniert.has(a.id) && <Zeile cls="font-bold text-[#c01818] dark:text-[#ff8a8a]">Vom Techniker storniert, nicht mehr ausgeben</Zeile>}
                {druck && (
                  <Zeile cls={druck.fertig ? "text-[#037A4F] dark:text-[#3ddc97]" : "text-[#5f6368] dark:text-[#b0b3b8]"}>
                    <strong className="text-[#202F61] dark:text-[#e4e6eb]">Im 3D-Druck</strong> · {druck.text}
                  </Zeile>
                )}
                {sg && sg.length > 0 && (
                  <Zeile cls="text-[#5f6368] dark:text-[#b0b3b8]">
                    <strong className="text-[#202F61] dark:text-[#e4e6eb]">{sg.length} {sg.length === 1 ? "Spendergerät" : "Spendergeräte"} im Lager</strong> · nächstes: {sg[0]!.lagerplatz ?? "ohne Platz"}, {sg[0]!.grading}
                  </Zeile>
                )}
                {ts && ts.anzahl > 0 && (
                  <Zeile cls="text-[#5f6368] dark:text-[#b0b3b8]">
                    <strong className="text-[#202F61] dark:text-[#e4e6eb]">{ts.anzahl} {ts.anzahl === 1 ? "Verwertungsgerät" : "Verwertungsgeräte"}</strong>
                    {ts.vorschau[0] && <> · nächstes: {ts.vorschau[0].stellplatz ?? "ohne Platz"}, Colli {ts.vorschau[0].colli ?? "—"}
                      {/* Zwei Ortsquellen widersprechen sich (src/lib/teilespender/ort.ts) — in Worten statt ⚠. */}
                      {ts.vorschau[0].ortUnsicher && <span className="text-[#8A5A00] dark:text-[#f7b928]"> (Ort unsicher)</span>}</>}
                    {spenderMoeglich && (
                      <button type="button" onClick={() => p.onSpender(g, [a.teil])} className="ml-2 font-bold text-[#0064d2] dark:text-[#45bdff] hover:underline">alle zeigen</button>
                    )}
                    {ts.deckung.text && <span className="block text-[#8A5A00] dark:text-[#f7b928]">{ts.deckung.text}</span>}
                  </Zeile>
                )}
                {ts && ts.zugeteiltAn != null && (
                  <Zeile cls="text-[#5f6368] dark:text-[#b0b3b8]">Kein freies Verwertungsgerät: das vorhandene ist Anfrage #{ts.zugeteiltAn} zugeteilt.</Zeile>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Fußleiste: links der nächste Schritt, rechts Chat + Menü */}
      <footer className="mt-auto flex flex-wrap items-center gap-2 border-t border-[#d9dde3] dark:border-[#3e4042] px-5 py-3">
        {haupt && <button type="button" onClick={haupt.onClick} disabled={haupt.disabled} className={knopfHaupt}>{haupt.label}</button>}
        {neben.map((k) => <button key={k.label} type="button" onClick={k.onClick} disabled={k.disabled} className={knopfNeben}>{k.label}</button>)}
        {spenderMoeglich && (
          <button type="button" onClick={() => p.onSpender(g, spenderTeiltypen)} className={knopfNeben}>
            Spender suchen{spenderTreffer > 0 && <span className={zahlCls}>{spenderTreffer}</span>}
          </button>
        )}
        <span className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => p.onChat(g)} className={knopfNeben} aria-label={chat > 0 ? `Chat, ${chat} ungelesen` : "Chat"}>
            Chat{chat > 0 && <span className={zahlCls}>{chat > 9 ? "9+" : chat}</span>}
          </button>
          <Mehr punkte={geraeteMenue} name={label} />
        </span>
      </footer>
    </article>
  );
}

export function AnfragenKarten(p: AnfragenKartenProps) {
  if (p.gruppen.length === 0) {
    return <p className="text-center py-16 text-[#5f6368] dark:text-[#b0b3b8]">Keine Anfragen in dieser Auswahl.</p>;
  }
  const jeLogId = new Map<string, KartenGruppe[]>();
  for (const g of p.gruppen) {
    if (!g.logId || g.logId === "unbekannt") continue;
    const k = g.logId.replace(/\D/g, "");
    jeLogId.set(k, [...(jeLogId.get(k) ?? []), g]);
  }
  return (
    <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 620px), 1fr))" }}>
      {p.gruppen.map((g) => {
        const k = g.logId ? g.logId.replace(/\D/g, "") : "";
        const geschwister = (k && jeLogId.get(k)?.filter((x) => x !== g)) || [];
        return <Karte key={gruppenSchluessel(g)} {...p} g={g} geschwister={geschwister} />;
      })}
    </div>
  );
}

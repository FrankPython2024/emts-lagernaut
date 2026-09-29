"use client";

// ── Urlaubsplanung (29.09.2026) ───────────────────────────────────────────────
// Nur für Frank (FRANK), Christian Roth (CR) und Ronny Schorg (RS) —
// src/lib/urlaub/team.ts. Der Server prüft das bei jedem Aufruf; hier wird nur
// die Seite für alle anderen gar nicht erst gezeigt.
// ⚠️ Jeder bearbeitet NUR seine eigenen Einträge und seinen eigenen Anspruch
// (Frank, 29.09.2026) — die der anderen sind nur lesbar. Der Server prüft das
// ebenso (`darfBearbeiten`); hier werden die Knöpfe nur gar nicht erst gezeigt.
// Urlaubskonto je Person (Anspruch + Übertrag − genehmigt − geplant),
// Monatskalender Personen × Tage (Wochenenden/Feiertage Thüringen grau,
// geplant gestreift, genehmigt voll), Liste des Jahres mit Ändern/Löschen/Genehmigen.

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { istImUrlaubTeam } from "@/lib/urlaub/team";
import { addiereTage } from "@/lib/zeit/berlin";
import { besteZeitpunkte, vorschlagsBudget } from "@/lib/urlaub/brueckentage";
import {
  ABWESENHEIT_ARTEN, ART_TEXT, arbeitstage, feiertag, freieTage, istArbeitstag, ueberschneiden, wochentag,
  type AbwesenheitArt, type UrlaubStatus,
} from "@/lib/urlaub/tage";

const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const FARBE: Record<AbwesenheitArt, string> = {
  URLAUB: "#008BD2", KRANK: "#d93025", SCHULUNG: "#7b61ff", GLEITZEIT: "#04B475", SONSTIGES: "#65676b",
};
const karte = "bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm";
const knopfBlau = "inline-flex items-center justify-center gap-2 px-4 rounded-xl bg-[#008BD2] text-white text-sm font-bold hover:bg-[#0077b5] transition-colors min-h-[48px] disabled:opacity-50";
const knopfRand = "inline-flex items-center justify-center gap-2 px-3 rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-[#202F61] dark:text-[#e4e6eb] text-sm font-bold hover:border-[#008BD2] transition-colors min-h-[44px] disabled:opacity-50";
const feld = "w-full px-3 rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#202F61] dark:text-[#e4e6eb] text-base outline-none focus:border-[#008BD2] min-h-[48px]";
const label = "block text-sm font-bold text-[#202F61] dark:text-[#e4e6eb] mb-1";

/** Heute als Kalendertag in deutscher Zeit (nicht UTC — sonst ist „heute" nachts gestern). */
function heute(): string {
  const t = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const g = (k: string) => t.find((x) => x.type === k)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}
const kurz = (tag: string) => `${tag.slice(8, 10)}.${tag.slice(5, 7)}.`;
const lang = (tag: string) => `${WT[wochentag(tag)]} ${tag.slice(8, 10)}.${tag.slice(5, 7)}.${tag.slice(0, 4)}`;
const zahl = (n: number) => String(n).replace(".", ",");

type Eintrag = {
  id: number; userId: number; art: string; von: string; bis: string; halberTag: boolean; status: string;
  notiz: string | null; erstelltVon: string; geaendertVon: string | null; genehmigtVon: string | null; tage: number;
};
type Entwurf = {
  id?: number; userId: number; art: AbwesenheitArt; von: string; bis: string; halberTag: boolean;
  status: UrlaubStatus; notiz: string;
  original?: { userId: number; art: string; von: string; bis: string; halberTag: boolean; status: string };
};

export default function UrlaubSeite() {
  const { data: session, status: sitzung } = useSession();
  const meineId = Number((session?.user as { id?: number | string } | undefined)?.id);
  const darf = istImUrlaubTeam(meineId);
  const [jahr, setJahr] = useState(() => Number(heute().slice(0, 4)));
  const [monat, setMonat] = useState(() => Number(heute().slice(5, 7)) - 1);
  const [entwurf, setEntwurf] = useState<Entwurf | null>(null);
  const [anspruchFuer, setAnspruchFuer] = useState<number | null>(null);
  const [loeschen, setLoeschen] = useState<Eintrag | null>(null);
  const [ansehen, setAnsehen] = useState<Eintrag | null>(null);
  const { show } = useToast();
  const utils = api.useUtils();

  const q = api.urlaub.uebersicht.useQuery({ jahr }, { enabled: darf });
  const neu = () => void utils.urlaub.uebersicht.invalidate();
  const statusSetzen = api.urlaub.status.useMutation({ onSuccess: neu, onError: (e) => show(e.message, "error") });
  const loeschenM = api.urlaub.loeschen.useMutation({
    onSuccess: () => { setLoeschen(null); show("Eintrag gelöscht", "success"); neu(); },
    onError: (e) => show(e.message, "error"),
  });

  if (sitzung === "loading") return <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">Lade…</div>;
  if (!darf) return <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">Kein Zugang zur Urlaubsplanung.</div>;

  const d = q.data;
  const namen = new Map((d?.personen ?? []).map((p) => [p.id, p.name]));
  // Eintragen immer nur für mich selbst.
  const neuerEintrag = (von = heute(), bis = von) =>
    setEntwurf({ userId: meineId, art: "URLAUB", von, bis, halberTag: false, status: "GEPLANT", notiz: "" });
  const istMeins = (e: { userId: number }) => e.userId === meineId;
  // Fremde Einträge öffnen nur eine Ansicht, eigene den Bearbeiten-Dialog.
  const oeffnen = (e: Eintrag) => (istMeins(e) ? bearbeiten(e) : setAnsehen(e));
  const bearbeiten = (e: Eintrag) => setEntwurf({
    id: e.id, userId: e.userId, art: e.art as AbwesenheitArt, von: e.von, bis: e.bis, halberTag: e.halberTag,
    status: e.status as UrlaubStatus, notiz: e.notiz ?? "",
    original: { userId: e.userId, art: e.art, von: e.von, bis: e.bis, halberTag: e.halberTag, status: e.status },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-[#202F61] dark:text-[#e4e6eb]">🏖️ Urlaubsplanung</h1>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">Nur für Frank, Christian und Ronny sichtbar. Gezählt werden Arbeitstage — Wochenenden, Feiertage in Thüringen sowie 24.12. und 31.12. (betriebsfrei) nicht.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={knopfRand} onClick={() => setJahr(jahr - 1)} aria-label="Vorjahr">‹</button>
          <span className="text-lg font-black text-[#202F61] dark:text-[#e4e6eb] min-w-[4ch] text-center">{jahr}</span>
          <button type="button" className={knopfRand} onClick={() => setJahr(jahr + 1)} aria-label="Nächstes Jahr">›</button>
          <button type="button" className={knopfBlau} onClick={() => neuerEintrag()}>＋ Eintragen</button>
        </div>
      </div>

      {q.isLoading ? <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Lade…</p>
        : q.isError ? <p className="text-sm text-[#d93025]">Fehler: {q.error.message}</p>
        : d && (
          <>
            {/* Urlaubskonten */}
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
              {d.personen.map((p) => (
                <div key={p.id} className={`${karte} p-4 space-y-2`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-black text-[#202F61] dark:text-[#e4e6eb]">{p.name}</span>
                    {p.id === meineId && (
                      <button type="button" className="text-xs font-bold text-[#0064d2] dark:text-[#45bdff] underline min-h-[32px]" onClick={() => setAnspruchFuer(p.id)}>
                        {p.anspruchGesetzt ? "Anspruch ändern" : "Anspruch eintragen"}
                      </button>
                    )}
                  </div>
                  {!p.anspruchGesetzt ? (
                    <p className="text-sm font-bold text-[#8A5A00] dark:text-[#f7b928]">
                      ⚠ Für {jahr} ist noch kein Urlaubsanspruch eingetragen{p.id === meineId ? "." : ` — das kann nur ${p.name} selbst.`}
                    </p>
                  ) : (
                    <>
                      <div className={`text-3xl font-black ${p.konto.verfuegbar < 0 ? "text-[#d93025]" : "text-[#037A4F] dark:text-[#3ddc97]"}`}>
                        {zahl(p.konto.verfuegbar)} <span className="text-sm font-bold text-[#65676b] dark:text-[#b0b3b8]">Tage frei</span>
                      </div>
                      <div className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb] space-y-0.5">
                        <div>Anspruch {zahl(p.konto.anspruch)}{p.konto.uebertrag ? ` + ${zahl(p.konto.uebertrag)} aus ${jahr - 1}` : ""}</div>
                        <div>✓ genehmigt {zahl(p.konto.genehmigt)} · geplant {zahl(p.konto.geplant)}</div>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>

            <Brueckentage jahr={jahr} meineId={meineId} personen={d.personen} eintraege={d.eintraege}
              onEintragen={(von, bis) => neuerEintrag(von, bis)} />

            <Monat jahr={jahr} monat={monat} setMonat={setMonat} personen={d.personen} eintraege={d.eintraege}
              meineId={meineId} onNeu={(tag) => neuerEintrag(tag)} onEintrag={oeffnen} />

            {/* Liste des Jahres */}
            <section className={`${karte} overflow-hidden`}>
              <h2 className="px-4 pt-4 pb-2 font-black text-[#202F61] dark:text-[#e4e6eb]">Alle Einträge {jahr}</h2>
              {d.eintraege.length === 0 ? (
                <p className="px-4 pb-4 text-sm text-[#65676b] dark:text-[#b0b3b8]">Noch nichts eingetragen.</p>
              ) : (
                <ul className="divide-y divide-[#ced4da] dark:divide-[#3e4042]">
                  {d.eintraege.map((e) => {
                    const art = e.art as AbwesenheitArt;
                    return (
                      <li key={e.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                        <span className="w-3 h-8 rounded" style={{ background: FARBE[art] }} aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-[#202F61] dark:text-[#e4e6eb]">
                            {namen.get(e.userId) ?? `#${e.userId}`} · {ART_TEXT[art]}
                            <span className="font-normal text-[#65676b] dark:text-[#b0b3b8]">
                              {" "}· {e.von === e.bis ? lang(e.von) : `${lang(e.von)} – ${lang(e.bis)}`}{e.halberTag ? " (halber Tag)" : ""} · {zahl(e.tage)} {e.tage === 1 ? "Tag" : "Tage"}
                            </span>
                          </div>
                          <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
                            eingetragen von {e.erstelltVon}{e.geaendertVon ? ` · geändert von ${e.geaendertVon}` : ""}
                            {e.status === "GENEHMIGT" && e.genehmigtVon ? ` · genehmigt von ${e.genehmigtVon}` : ""}
                            {e.notiz ? ` · ${e.notiz}` : ""}
                          </div>
                        </div>
                        {(() => {
                          const stil = `inline-flex items-center px-3 rounded-xl text-sm font-bold min-h-[44px] border-2 ${e.status === "GENEHMIGT"
                            ? "border-[#04B475] bg-[#04B475]/10 text-[#037A4F] dark:text-[#3ddc97]"
                            : "border-dashed border-[#BA7517] text-[#8A5A00] dark:text-[#f7b928]"}`;
                          const text = e.status === "GENEHMIGT" ? "✓ genehmigt" : "○ geplant";
                          return istMeins(e) ? (
                            <button type="button" disabled={statusSetzen.isPending} className={stil}
                              onClick={() => statusSetzen.mutate({ id: e.id, status: e.status === "GENEHMIGT" ? "GEPLANT" : "GENEHMIGT" })}
                              title={e.status === "GENEHMIGT" ? "Zurück auf geplant" : "Als genehmigt markieren"}>
                              {text}
                            </button>
                          ) : <span className={stil}>{text}</span>;
                        })()}
                        {istMeins(e) ? (
                          <>
                            <button type="button" className={knopfRand} onClick={() => bearbeiten(e)}>Ändern</button>
                            <button type="button" className={`${knopfRand} text-[#d93025]`} onClick={() => setLoeschen(e)} aria-label="Löschen">🗑</button>
                          </>
                        ) : (
                          <span className="text-xs text-[#65676b] dark:text-[#b0b3b8] min-w-[6rem] text-right">nur {namen.get(e.userId) ?? "die Person"} selbst</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}

      {entwurf && d && (
        <EintragDialog entwurf={entwurf} name={namen.get(meineId) ?? "dich"} onClose={() => setEntwurf(null)}
          onGespeichert={(warnung) => { setEntwurf(null); neu(); show(warnung ?? "Gespeichert", warnung ? "warning" : "success"); }}
          onLoeschen={() => { const e = d.eintraege.find((x) => x.id === entwurf.id); setEntwurf(null); if (e) setLoeschen(e); }} />
      )}
      {ansehen && (
        <Modal open onClose={() => setAnsehen(null)} title={`${namen.get(ansehen.userId) ?? ""} · ${ART_TEXT[ansehen.art as AbwesenheitArt] ?? ansehen.art}`}>
          <div className="space-y-2 text-base text-[#1a1a1a] dark:text-[#e4e6eb]">
            <p>{ansehen.von === ansehen.bis ? lang(ansehen.von) : `${lang(ansehen.von)} – ${lang(ansehen.bis)}`}{ansehen.halberTag ? " (halber Tag)" : ""}</p>
            <p>{zahl(ansehen.tage)} {ansehen.tage === 1 ? "Arbeitstag" : "Arbeitstage"} · {ansehen.status === "GENEHMIGT" ? `✓ genehmigt${ansehen.genehmigtVon ? ` (${ansehen.genehmigtVon})` : ""}` : "○ geplant"}</p>
            {ansehen.notiz && <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">{ansehen.notiz}</p>}
            <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Ändern kann diesen Eintrag nur {namen.get(ansehen.userId) ?? "die Person"} selbst.</p>
            <button type="button" className={`${knopfRand} w-full min-h-[56px]`} onClick={() => setAnsehen(null)}>Schließen</button>
          </div>
        </Modal>
      )}
      {anspruchFuer != null && d && (
        <AnspruchDialog jahr={jahr} person={d.personen.find((p) => p.id === anspruchFuer)!} onClose={() => setAnspruchFuer(null)}
          onGespeichert={() => { setAnspruchFuer(null); neu(); }} />
      )}
      <Modal open={loeschen != null} onClose={() => setLoeschen(null)} title="Eintrag löschen?">
        {loeschen && (
          <>
            <p className="text-base text-[#1a1a1a] dark:text-[#e4e6eb] mb-4">
              {namen.get(loeschen.userId)} · {ART_TEXT[loeschen.art as AbwesenheitArt]} ·{" "}
              {loeschen.von === loeschen.bis ? lang(loeschen.von) : `${lang(loeschen.von)} – ${lang(loeschen.bis)}`} wird gelöscht.
            </p>
            <div className="flex gap-3">
              <button type="button" className={`${knopfRand} flex-1 min-h-[56px]`} onClick={() => setLoeschen(null)}>Abbrechen</button>
              <button type="button" disabled={loeschenM.isPending} onClick={() => loeschenM.mutate({ id: loeschen.id })}
                className="flex-1 rounded-xl bg-[#d93025] text-white text-sm font-black min-h-[56px] disabled:opacity-50">Löschen</button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

// ── Beste Zeitpunkte (Brückentage) ────────────────────────────────────────────
// Rechnet im Browser (src/lib/urlaub/brueckentage.ts) — alle Daten liegen schon
// vor. Eigene Einträge sind gesperrt; auf Wunsch auch die Zeiten der anderen.
function Brueckentage({ jahr, meineId, personen, eintraege, onEintragen }: {
  jahr: number; meineId: number;
  personen: { id: number; name: string; anspruchGesetzt: boolean; konto: { verfuegbar: number } }[];
  eintraege: Eintrag[];
  onEintragen: (von: string, bis: string) => void;
}) {
  // Nur für mich — eintragen darf ich ohnehin nur bei mir.
  const person = meineId;
  const [max, setMax] = useState(5);
  const [ohneAndere, setOhneAndere] = useState(false);
  const [alle, setAlle] = useState(false);
  const h = heute();
  const aktuellesJahr = Number(h.slice(0, 4));
  const von = jahr === aktuellesJahr ? addiereTage(h, 1) : `${jahr}-01-01`;
  const bis = `${jahr}-12-31`;
  const p = personen.find((x) => x.id === person);
  // Der Rest vom Konto begrenzt die Vorschläge; ohne Resttage gibt es keine.
  const rest = p?.anspruchGesetzt ? Math.floor(Math.max(0, p.konto.verfuegbar)) : 0;
  const budget = vorschlagsBudget(!!p?.anspruchGesetzt, p?.konto.verfuegbar ?? 0, max);
  const auswahl = Math.max(1, Math.min(10, rest));

  const vorschlaege = useMemo(() => {
    if (jahr < aktuellesJahr || !budget) return [];
    const sperren = eintraege
      .filter((e) => e.userId === person || ohneAndere)
      .map((e) => ({ von: e.von, bis: e.bis }));
    return besteZeitpunkte({ von, bis, maxUrlaubstage: budget, sperren, anzahl: 20 });
  }, [jahr, aktuellesJahr, eintraege, person, ohneAndere, von, bis, budget]);

  const namen = new Map(personen.map((x) => [x.id, x.name]));
  const andereWeg = (uv: string, ub: string) => [...new Set(eintraege
    .filter((e) => e.userId !== person && ueberschneiden({ von: uv, bis: ub }, { von: e.von, bis: e.bis }))
    .map((e) => namen.get(e.userId) ?? `#${e.userId}`))];
  const sichtbar = alle ? vorschlaege : vorschlaege.slice(0, 6);

  return (
    <section className={`${karte} p-4 space-y-3`}>
      <div>
        <h2 className="font-black text-[#202F61] dark:text-[#e4e6eb]">💡 Beste Zeitpunkte für deinen Urlaub {jahr}</h2>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
          Wo wenige Urlaubstage mit Wochenenden, Feiertagen und freien Tagen die meiste Zeit am Stück ergeben.
          {jahr === aktuellesJahr ? " Ab morgen." : ""}
        </p>
      </div>
      {!!budget && (
      <div className="flex items-center gap-2 flex-wrap">
        <label className="inline-flex items-center gap-2 text-sm font-bold text-[#202F61] dark:text-[#e4e6eb]">
          höchstens
          <select value={Math.min(max, auswahl)} onChange={(e) => setMax(Number(e.target.value))}
            className="px-2 rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] min-h-[44px]">
            {Array.from({ length: auswahl }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          Urlaubstage
          <span className="font-normal text-[#65676b] dark:text-[#b0b3b8]">(noch {zahl(p?.konto.verfuegbar ?? 0)} frei)</span>
        </label>
        <label className="inline-flex items-center gap-2 text-sm font-bold text-[#202F61] dark:text-[#e4e6eb] min-h-[44px]">
          <input type="checkbox" className="w-5 h-5" checked={ohneAndere} onChange={(e) => setOhneAndere(e.target.checked)} />
          nur wenn sonst niemand weg ist
        </label>
      </div>
      )}

      {jahr < aktuellesJahr ? (
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Das Jahr liegt zurück.</p>
      ) : budget === null ? (
        <p className="text-sm font-bold text-[#8A5A00] dark:text-[#f7b928]">Trag zuerst deinen Urlaubsanspruch für {jahr} ein — dann rechnet das hier mit deinem Rest.</p>
      ) : budget === 0 ? (
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Du hast für {jahr} keine Urlaubstage mehr frei — deshalb keine Vorschläge.</p>
      ) : vorschlaege.length === 0 ? (
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Keine lohnenden Brückentage mehr {jahr === aktuellesJahr ? "in diesem Jahr" : `in ${jahr}`} — oder alle schon verplant.</p>
      ) : (
        <ul className="space-y-2">
          {sichtbar.map((v) => {
            const weg = andereWeg(v.urlaubVon, v.urlaubBis);
            return (
              <li key={`${v.urlaubVon}-${v.urlaubBis}`} className="rounded-xl border border-[#ced4da] dark:border-[#3e4042] px-3 py-2 flex items-center gap-3 flex-wrap">
                <div className="text-center min-w-[4.5rem]">
                  <div className="text-2xl font-black text-[#037A4F] dark:text-[#3ddc97]">{v.freieTage}</div>
                  <div className="text-[11px] font-bold text-[#65676b] dark:text-[#b0b3b8]">Tage frei</div>
                </div>
                <div className="min-w-0 flex-1 text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
                  <div className="font-bold">
                    {lang(v.freiVon)} – {lang(v.freiBis)}
                  </div>
                  <div>
                    für <strong>{v.urlaubstage} {v.urlaubstage === 1 ? "Urlaubstag" : "Urlaubstage"}</strong>
                    {" "}({v.urlaubVon === v.urlaubBis ? kurz(v.urlaubVon) : `${kurz(v.urlaubVon)}–${kurz(v.urlaubBis)}`})
                    <span className="text-[#65676b] dark:text-[#b0b3b8]"> · {v.anlass.join(", ")}</span>
                  </div>
                  {weg.length > 0 && <div className="text-xs font-bold text-[#8A5A00] dark:text-[#f7b928]">⚠ Dann ist schon weg: {weg.join(", ")}</div>}
                </div>
                <span className="text-xs font-bold px-2 py-1 rounded-lg bg-[#04B475]/10 text-[#037A4F] dark:text-[#3ddc97]" title="freie Tage je Urlaubstag">
                  ×{zahl(Math.round(v.faktor * 10) / 10)}
                </span>
                <button type="button" className={knopfRand} onClick={() => onEintragen(v.urlaubVon, v.urlaubBis)}>Eintragen</button>
              </li>
            );
          })}
        </ul>
      )}
      {!!budget && vorschlaege.length > 6 && (
        <button type="button" className="text-sm font-bold text-[#0064d2] dark:text-[#45bdff] underline min-h-[44px]" onClick={() => setAlle(!alle)}>
          {alle ? "Weniger zeigen" : `Alle ${vorschlaege.length} zeigen`}
        </button>
      )}
    </section>
  );
}

// ── Monatskalender: Personen × Tage ───────────────────────────────────────────
function Monat({ jahr, monat, setMonat, personen, eintraege, meineId, onNeu, onEintrag }: {
  jahr: number; monat: number; setMonat: (m: number) => void;
  personen: { id: number; name: string; kuerzel: string }[]; eintraege: Eintrag[];
  meineId: number;
  onNeu: (tag: string) => void; onEintrag: (e: Eintrag) => void;
}) {
  const erster = `${jahr}-${String(monat + 1).padStart(2, "0")}-01`;
  const tage = useMemo(() => {
    const raus: string[] = [];
    for (let t = erster; t.slice(0, 7) === erster.slice(0, 7); t = addiereTage(t, 1)) raus.push(t);
    return raus;
  }, [erster]);
  const h = heute();
  const eintragAm = (userId: number, tag: string) => eintraege.find((e) => e.userId === userId && e.von <= tag && tag <= e.bis);
  // Tage, an denen mehr als eine Person fehlt (nur Arbeitstage) — Überschneidung.
  const mehrfach = new Set(tage.filter((t) => istArbeitstag(t) && personen.filter((p) => eintragAm(p.id, t)).length > 1));
  const feiertageImMonat = tage.filter((t) => feiertag(t)).map((t) => ({ tag: t, name: feiertag(t)! }));
  const alleFeiertage = [...freieTage(jahr)];
  // Feiertag (Thüringen, arbeitsfrei) rosa — bewusst weder Rot (Krank) noch Violett (Schulung).
  const leer = (t: string) => feiertag(t)
    ? "bg-[#fce4ec] dark:bg-[#4a2433]"
    : !istArbeitstag(t) ? "bg-[#e4e6eb] dark:bg-[#3a3b3c]" : "bg-[#f0f2f5] dark:bg-[#18191a] hover:bg-[#008BD2]/15";

  return (
    <section className={`${karte} p-4 space-y-3`}>
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" className={knopfRand} onClick={() => setMonat(Math.max(0, monat - 1))} disabled={monat === 0} aria-label="Voriger Monat">‹</button>
        <h2 className="font-black text-[#202F61] dark:text-[#e4e6eb] min-w-[10ch] text-center">{MONATE[monat]} {jahr}</h2>
        <button type="button" className={knopfRand} onClick={() => setMonat(Math.min(11, monat + 1))} disabled={monat === 11} aria-label="Nächster Monat">›</button>
        {mehrfach.size > 0 && (
          <span className="text-sm font-bold text-[#8A5A00] dark:text-[#f7b928]">⚠ An {mehrfach.size} {mehrfach.size === 1 ? "Arbeitstag" : "Arbeitstagen"} fehlen mehrere gleichzeitig</span>
        )}
      </div>
      {/* Volle Breite, alle Tagesspalten gleich breit; unter ~58rem scrollt die Tabelle seitlich. */}
      <div className="overflow-x-auto">
        <table className="w-full border-separate" style={{ borderSpacing: 2, tableLayout: "fixed", minWidth: "58rem" }}>
          <colgroup>
            <col style={{ width: "8rem" }} />
            {tage.map((t) => <col key={t} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white dark:bg-[#242526]" />
              {tage.map((t) => {
                const ft = feiertag(t);
                const frei = !istArbeitstag(t);
                return (
                  <th key={t} title={ft ? `${ft} — arbeitsfrei` : undefined}
                    className={`text-xs font-bold leading-tight py-1 rounded-md ${ft ? "bg-[#fce4ec] dark:bg-[#4a2433] text-[#ad1457] dark:text-[#f48fb1]" : ""} ${t === h ? "text-[#008BD2]" : !ft && frei ? "text-[#9aa0a6]" : !ft ? "text-[#202F61] dark:text-[#e4e6eb]" : ""}`}>
                    {WT[wochentag(t)]}<br />{t.slice(8, 10)}
                    {ft && <div className="text-[10px]" aria-label={`Feiertag: ${ft}`}>FT</div>}
                    {mehrfach.has(t) && <div className="text-[#BA7517]" aria-label="mehrere fehlen">⚠</div>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {personen.map((p) => (
              <tr key={p.id}>
                <th className="sticky left-0 z-10 bg-white dark:bg-[#242526] pr-2 text-left text-sm font-bold text-[#202F61] dark:text-[#e4e6eb] whitespace-nowrap">
                  {p.name}{p.id === meineId && <span className="text-xs font-normal text-[#008BD2]"> (du)</span>}
                </th>
                {tage.map((t) => {
                  const e = eintragAm(p.id, t);
                  const farbe = e ? FARBE[e.art as AbwesenheitArt] : null;
                  const geplant = e?.status !== "GENEHMIGT";
                  const stil = farbe
                    ? geplant
                      ? { background: `repeating-linear-gradient(135deg, ${farbe} 0 5px, ${farbe}55 5px 10px)`, outline: `2px dashed ${farbe}`, outlineOffset: "-2px" }
                      : { background: farbe }
                    : undefined;
                  const text = e
                    ? `${p.name}: ${ART_TEXT[e.art as AbwesenheitArt]} ${e.status === "GENEHMIGT" ? "(genehmigt)" : "(geplant)"} ${kurz(e.von)}–${kurz(e.bis)}${e.halberTag ? ", halber Tag" : ""}`
                    : `${p.name}, ${lang(t)}${feiertag(t) ? ` — ${feiertag(t)}` : !istArbeitstag(t) ? " — Wochenende" : ""}${p.id === meineId && istArbeitstag(t) ? ": eintragen" : ""}`;
                  // Anklickbar: vorhandene Einträge (ansehen/ändern) und leere ARBEITStage in meiner
                  // Zeile. Wochenenden und freie Tage nicht — Urlaub dort zählt 0 Tage und ist sinnlos
                  // (Frank, 29.09.2026). Leere Felder anderer Personen auch nicht.
                  const klickbar = !!e || (p.id === meineId && istArbeitstag(t));
                  return (
                    <td key={t} className="p-0">
                      <button type="button" title={text} aria-label={text} disabled={!klickbar}
                        onClick={() => (e ? onEintrag(e) : onNeu(t))}
                        className={`block w-full h-11 rounded-md ${!e ? (klickbar ? leer(t) : leer(t).replace(/hover:\S+/g, "")) : ""} ${!klickbar ? "cursor-default" : ""} ${t === h ? "ring-2 ring-[#008BD2]" : ""}`}
                        style={stil}>
                        {e?.halberTag && <span className="text-[10px] font-black text-white">½</span>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#65676b] dark:text-[#b0b3b8]">
        {ABWESENHEIT_ARTEN.map((a) => (
          <span key={a} className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: FARBE[a] }} />{ART_TEXT[a]}</span>
        ))}
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: "repeating-linear-gradient(135deg,#008BD2 0 3px,#008BD255 3px 6px)" }} />gestreift = geplant</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block bg-[#e4e6eb] dark:bg-[#3a3b3c]" />Wochenende</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block bg-[#fce4ec] dark:bg-[#4a2433] border border-[#ad1457]/40" />Feiertag (arbeitsfrei)</span>
        <span>Leeren Arbeitstag in deiner Zeile antippen = eintragen; farbiges = ansehen bzw. bei dir ändern.</span>
      </div>

      {/* Feiertage: im Monat ausgeschrieben, das ganze Jahr zum Aufklappen. */}
      <div className="rounded-xl bg-[#fce4ec]/60 dark:bg-[#4a2433]/60 px-3 py-2 text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
        <span className="font-bold text-[#ad1457] dark:text-[#f48fb1]">Freie Tage im {MONATE[monat]}:</span>{" "}
        {feiertageImMonat.length === 0 ? "keine" : feiertageImMonat.map((f) => `${lang(f.tag)} ${f.name}`).join(" · ")}
      </div>
      <details className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
        <summary className="cursor-pointer font-bold text-[#202F61] dark:text-[#e4e6eb] min-h-[44px] flex items-center">
          Alle freien Tage {jahr} ({alleFeiertage.length}) — Feiertage Thüringen und betriebsfrei, an diesen Tagen wird nicht gearbeitet
        </summary>
        <ul className="mt-1 grid gap-x-6 gap-y-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
          {alleFeiertage.map(([tag, name]) => (
            <li key={tag} className={!istArbeitstag(tag) && wochentag(tag) % 6 === 0 ? "text-[#65676b] dark:text-[#b0b3b8]" : ""}>
              <strong>{lang(tag)}</strong> {name}{wochentag(tag) % 6 === 0 ? " (fällt aufs Wochenende)" : ""}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

// ── Eintragen / Ändern ───────────────────────────────────────────────────────
function EintragDialog({ entwurf, name, onClose, onGespeichert, onLoeschen }: {
  entwurf: Entwurf; name: string;
  onClose: () => void; onGespeichert: (warnung: string | null) => void; onLoeschen: () => void;
}) {
  const [e, setE] = useState<Entwurf>(entwurf);
  const { show } = useToast();
  const set = <K extends keyof Entwurf>(k: K, v: Entwurf[K]) => setE((alt) => ({ ...alt, [k]: v }));

  // Genehmigt war ein bestimmter Zeitraum: Ändert sich Zeitraum, Person oder
  // Art, geht der Eintrag auf „geplant" zurück — genehmigen muss man neu.
  const o = e.original;
  const zeitGeaendert = !!o && (o.von !== e.von || o.bis !== e.bis || o.halberTag !== e.halberTag || o.userId !== e.userId || o.art !== e.art);
  useEffect(() => {
    if (zeitGeaendert && o?.status === "GENEHMIGT") setE((alt) => (alt.status === "GENEHMIGT" ? { ...alt, status: "GEPLANT" } : alt));
  }, [zeitGeaendert, o?.status]);

  const einTag = e.von === e.bis;
  const gueltig = !!e.von && !!e.bis && e.von <= e.bis;
  const tage = gueltig ? arbeitstage({ von: e.von, bis: e.bis, halberTag: einTag && e.halberTag }) : 0;
  // Ganz ohne Arbeitstag (nur Wochenende/Feiertag) ergibt ein Eintrag keinen Sinn.
  const ohneArbeitstag = gueltig && arbeitstage({ von: e.von, bis: e.bis }) === 0;
  const pruefen = api.urlaub.pruefen.useQuery(
    { id: e.id, userId: e.userId, von: e.von, bis: e.bis },
    { enabled: gueltig, staleTime: 5000 },
  );
  const speichern = api.urlaub.speichern.useMutation({
    onSuccess: (r) => onGespeichert(r.ueberschneidungen.length
      ? `Gespeichert — gleichzeitig weg: ${r.ueberschneidungen.map((u) => `${u.wer} (${kurz(u.von)}–${kurz(u.bis)})`).join(", ")}`
      : null),
    onError: (err) => show(err.message, "error"),
  });

  return (
    <Modal open onClose={() => { if (!speichern.isPending) onClose(); }} title={e.id ? "Eintrag ändern" : "Abwesenheit eintragen"}>
      <div className="space-y-4">
        {/* Keine Personenwahl: Eingetragen wird immer nur für das eigene Konto. */}
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Für: <strong className="text-[#202F61] dark:text-[#e4e6eb]">{name}</strong></p>
        <div>
          <span className={label}>Was?</span>
          <div className="flex flex-wrap gap-2">
            {ABWESENHEIT_ARTEN.map((a) => (
              <button key={a} type="button" aria-pressed={e.art === a} onClick={() => set("art", a)}
                className={`inline-flex items-center gap-2 px-3 rounded-xl text-sm font-bold min-h-[44px] border-2 ${e.art === a ? "border-[#202F61] dark:border-[#e4e6eb] text-[#202F61] dark:text-[#e4e6eb]" : "border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8]"}`}>
                <span className="w-3 h-3 rounded-sm" style={{ background: FARBE[a] }} aria-hidden />{ART_TEXT[a]}
              </button>
            ))}
          </div>
          {e.art !== "URLAUB" && <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1">Zählt nicht aufs Urlaubskonto.</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="u-von" className={label}>Von</label>
            <input id="u-von" type="date" className={feld} value={e.von}
              onChange={(x) => setE((alt) => ({ ...alt, von: x.target.value, bis: alt.bis < x.target.value ? x.target.value : alt.bis }))} />
          </div>
          <div>
            <label htmlFor="u-bis" className={label}>Bis</label>
            <input id="u-bis" type="date" className={feld} value={e.bis} min={e.von} onChange={(x) => set("bis", x.target.value)} />
          </div>
        </div>
        {einTag && (
          <label className="flex items-center gap-3 min-h-[44px] text-sm font-bold text-[#202F61] dark:text-[#e4e6eb]">
            <input type="checkbox" className="w-5 h-5" checked={e.halberTag} onChange={(x) => set("halberTag", x.target.checked)} />
            Nur ein halber Tag
          </label>
        )}
        <div>
          <span className={label}>Status</span>
          <div className="flex gap-2">
            {(["GEPLANT", "GENEHMIGT"] as const).map((s) => (
              <button key={s} type="button" aria-pressed={e.status === s} onClick={() => set("status", s)}
                className={`flex-1 rounded-xl text-sm font-bold min-h-[48px] border-2 ${e.status === s
                  ? s === "GENEHMIGT" ? "border-[#04B475] bg-[#04B475]/10 text-[#037A4F] dark:text-[#3ddc97]" : "border-[#BA7517] bg-[#BA7517]/10 text-[#8A5A00] dark:text-[#f7b928]"
                  : "border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8]"}`}>
                {s === "GENEHMIGT" ? "✓ genehmigt" : "○ geplant"}
              </button>
            ))}
          </div>
          {zeitGeaendert && o?.status === "GENEHMIGT" && (
            <p className="text-xs font-bold text-[#8A5A00] dark:text-[#f7b928] mt-1">Zeitraum geändert — die Genehmigung galt für den alten und muss neu gesetzt werden.</p>
          )}
        </div>
        <div>
          <label htmlFor="u-notiz" className={label}>Notiz</label>
          <input id="u-notiz" className={feld} value={e.notiz} maxLength={500} onChange={(x) => set("notiz", x.target.value)} placeholder="optional" />
        </div>

        <div className="rounded-xl bg-[#f0f2f5] dark:bg-[#18191a] px-3 py-2 text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
          {!gueltig ? "„Bis“ liegt vor „von“."
            : ohneArbeitstag ? <span className="font-bold text-[#d93025]">Im gewählten Zeitraum liegt kein Arbeitstag (nur Wochenende/freie Tage) — da muss nichts eingetragen werden.</span>
            : <><strong>{zahl(tage)}</strong> {tage === 1 ? "Arbeitstag" : "Arbeitstage"}{e.art === "URLAUB" ? " vom Urlaubskonto" : ""}</>}
        </div>
        {(pruefen.data?.length ?? 0) > 0 && (
          <div role="alert" className="rounded-xl bg-[#BA7517]/10 px-3 py-2 text-sm text-[#8A5A00] dark:text-[#f7b928]">
            ⚠ Gleichzeitig weg: {pruefen.data!.map((u) => `${u.wer} (${ART_TEXT[u.art as AbwesenheitArt] ?? u.art}, ${kurz(u.von)}–${kurz(u.bis)})`).join(", ")}
          </div>
        )}

        <div className="flex gap-3 flex-wrap">
          {e.id && (
            <button type="button" onClick={onLoeschen} disabled={speichern.isPending}
              className="px-4 rounded-xl border border-[#d93025]/40 text-[#d93025] text-sm font-bold min-h-[56px]">🗑 Löschen</button>
          )}
          <button type="button" onClick={onClose} disabled={speichern.isPending}
            className="flex-1 text-sm font-semibold border border-[#ced4da] dark:border-[#3e4042] rounded-xl text-[#65676b] dark:text-[#b0b3b8] min-h-[56px]">Abbrechen</button>
          <button type="button" disabled={!gueltig || ohneArbeitstag || speichern.isPending}
            onClick={() => speichern.mutate({
              id: e.id, userId: e.userId, art: e.art, von: e.von, bis: e.bis,
              halberTag: einTag && e.halberTag, status: e.status, notiz: e.notiz.trim() || null,
            })}
            className="flex-1 rounded-xl bg-[#008BD2] text-white text-sm font-black min-h-[56px] disabled:opacity-50">
            {speichern.isPending ? "Speichere…" : "Speichern"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Urlaubsanspruch je Jahr ──────────────────────────────────────────────────
function AnspruchDialog({ jahr, person, onClose, onGespeichert }: {
  jahr: number; person: { id: number; name: string; anspruchGesetzt: boolean; konto: { anspruch: number; uebertrag: number } };
  onClose: () => void; onGespeichert: () => void;
}) {
  const { show } = useToast();
  const [tage, setTage] = useState(person.anspruchGesetzt ? zahl(person.konto.anspruch) : "30");
  const [uebertrag, setUebertrag] = useState(person.anspruchGesetzt ? zahl(person.konto.uebertrag) : "0");
  const lies = (s: string) => Number(s.replace(",", "."));
  const ok = (s: string) => { const n = lies(s); return s.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 60 && Number.isInteger(n * 2); };
  const m = api.urlaub.anspruchSetzen.useMutation({
    onSuccess: () => { show("Anspruch gespeichert", "success"); onGespeichert(); },
    onError: (e) => show(e.message, "error"),
  });
  return (
    <Modal open onClose={onClose} title={`Urlaubsanspruch ${jahr} — ${person.name}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="a-tage" className={label}>Tage im Jahr</label>
            <input id="a-tage" inputMode="decimal" className={feld} value={tage} onChange={(x) => setTage(x.target.value)} />
          </div>
          <div>
            <label htmlFor="a-rest" className={label}>Rest aus {jahr - 1}</label>
            <input id="a-rest" inputMode="decimal" className={feld} value={uebertrag} onChange={(x) => setUebertrag(x.target.value)} />
          </div>
        </div>
        <p className="text-xs text-[#65676b] dark:text-[#b0b3b8]">Halbe Tage mit Komma, z. B. 2,5.</p>
        <div className="flex gap-3">
          <button type="button" className={`${knopfRand} flex-1 min-h-[56px]`} onClick={onClose}>Abbrechen</button>
          <button type="button" disabled={!ok(tage) || !ok(uebertrag) || m.isPending}
            onClick={() => m.mutate({ userId: person.id, jahr, tage: lies(tage), uebertrag: lies(uebertrag) })}
            className="flex-1 rounded-xl bg-[#008BD2] text-white text-sm font-black min-h-[56px] disabled:opacity-50">Speichern</button>
        </div>
      </div>
    </Modal>
  );
}

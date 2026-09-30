"use client";

// ── 3D-Druck: Auswertung „Was bringt der Druck ein?" (30.09.2026) ─────────────
// Gedruckt (Materialkosten) gegen ausgegeben (Technik + Niederlassungen).
// Regeln: src/lib/druck/auswertung.ts, Daten: src/modules/druck/auswertung.ts.
// ⚠️ „Aus dem 3D-Druck" ist rechnerisch (Anteil am Eingang je Artikel) — die
// Oberfläche sagt das an jeder Stelle dazu.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/trpc/react";

const ZEITRAEUME = [
  { tage: null, text: "Seit Beginn" },
  { tage: 365, text: "12 Monate" },
  { tage: 90, text: "90 Tage" },
  { tage: 30, text: "30 Tage" },
] as const;
const ZEIT_KEY = "druck-auswertung-tage";

const karte = "bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm";
const leise = "text-[#65676b] dark:text-[#b0b3b8]";
const knopfRand = "inline-flex items-center justify-center gap-2 px-4 rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-[#202F61] dark:text-[#e4e6eb] text-sm font-bold hover:border-[#008BD2] transition-colors min-h-[48px]";

const euro = (x: number, stellen = 2) => x.toLocaleString("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: stellen, maximumFractionDigits: stellen });
const euroRund = (x: number) => euro(x, Math.abs(x) >= 100 ? 0 : 2);
const zahl = (x: number) => x.toLocaleString("de-DE");
const MONATE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const monatText = (m: string) => { const [j, mm] = m.split("-"); return `${MONATE[Number(mm) - 1]} ${j!.slice(2)}`; };

// Farben mit ≥ 3:1 gegen Weiß UND gegen die dunkle Kartenfläche (#242526).
const FARBE_GEDRUCKT = "#0a9a64";
const FARBE_AUS_DRUCK = "#008BD2";
const FARBE_AUSGEGEBEN = "#8a939c";

export function DruckAuswertung({ darfPflegen }: { darfPflegen: boolean }) {
  const [tage, setTage] = useState<number | null>(null);
  useEffect(() => {
    try {
      const t = localStorage.getItem(ZEIT_KEY);
      if (t) setTage(t === "alle" ? null : Number(t) || null);
    } catch { /* egal */ }
  }, []);
  const waehle = (t: number | null) => { setTage(t); try { localStorage.setItem(ZEIT_KEY, t == null ? "alle" : String(t)); } catch { /* egal */ } };

  const q = api.druck.auswertung.useQuery({ tage });
  const d = q.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="Zeitraum">
        {ZEITRAEUME.map((z) => (
          <button
            key={z.text}
            type="button"
            aria-pressed={tage === z.tage}
            onClick={() => waehle(z.tage)}
            className={`px-4 rounded-xl text-sm font-bold min-h-[48px] border transition-colors ${tage === z.tage
              ? "bg-[#202F61] text-white border-[#202F61] dark:bg-[#008BD2] dark:border-[#008BD2]"
              : "bg-white dark:bg-[#242526] border-[#ced4da] dark:border-[#3e4042] text-[#202F61] dark:text-[#e4e6eb] hover:border-[#008BD2]"}`}
          >
            {z.text}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <p className={`text-sm ${leise}`}>Rechne…</p>
      ) : q.isError ? (
        <p className="text-sm text-[#d93025]">Fehler: {q.error.message} <button className="underline font-bold" onClick={() => void q.refetch()}>Erneut versuchen</button></p>
      ) : d && (
        <>
          {/* Gegenüberstellung */}
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
            <Kachel titel="Gedruckt" farbe={FARBE_GEDRUCKT}
              gross={`${zahl(d.gedruckt.stueck)} Stück`}
              zeilen={[
                <>Material <strong>{euro(d.gedruckt.material)}</strong> ({zahl(Math.round(d.gedruckt.gramm))} g Filament)</>,
                d.gedruckt.stueck > 0 ? <>≈ {euro(d.gedruckt.material / d.gedruckt.stueck)} je Stück</> : null,
              ]} />
            <Kachel titel="Ausgegeben (alle Füße)" farbe={FARBE_AUSGEGEBEN}
              gross={`${zahl(d.ausgegeben.gesamt.stueck)} Stück`}
              zeilen={[
                <>Wert <strong>{euroRund(d.ausgegeben.gesamt.wert)}</strong></>,
                <>Technik {zahl(d.ausgegeben.technik.stueck)} · Niederlassungen {zahl(d.ausgegeben.niederlassungen.stueck)}</>,
              ]} />
            <Kachel titel="Davon aus dem 3D-Druck" farbe={FARBE_AUS_DRUCK} hinweis="rechnerisch"
              gross={`${zahl(d.ausDruck.gesamt.stueck)} Stück`}
              zeilen={[
                <>Wert <strong>{euroRund(d.ausDruck.gesamt.wert)}</strong></>,
                <>Technik {zahl(d.ausDruck.technik.stueck)} · Niederlassungen {zahl(d.ausDruck.niederlassungen.stueck)}</>,
              ]} />
            <div className={`${karte} p-4 border-2 !border-[#0a9a64]`}>
              <div className="text-xs font-black uppercase tracking-wider text-[#037A4F] dark:text-[#3ddc97]">Bringt ein</div>
              <div className="text-3xl font-black text-[#037A4F] dark:text-[#3ddc97] mt-1">{euroRund(d.ergebnis)}</div>
              <div className={`text-sm mt-1 ${leise}`}>
                {euroRund(d.ausDruck.gesamt.wert)} ausgegeben − {euro(d.gedruckt.material)} Material
              </div>
              <div className="text-sm mt-2 text-[#1a1a1a] dark:text-[#e4e6eb]">
                Dazu noch auf Lager aus dem Druck: <strong>{zahl(d.lagerAusDruck.stueck)} Stück ≈ {euroRund(d.lagerAusDruck.wert)}</strong>
              </div>
            </div>
          </div>

          {d.ohnePreisStueck > 0 && (
            <p className="text-sm font-bold text-[#8a5a00] dark:text-[#f7b955]">
              ⚠ {zahl(d.ohnePreisStueck)} ausgegebene Stück ohne hinterlegten Preis — fehlen im Wert.{" "}
              <Link href="/admin/preise" className="underline">Kategorie-Preise</Link>
            </p>
          )}

          {/* Verlauf */}
          {d.monate.length > 0 && (
            <section className={`${karte} p-4 space-y-2`}>
              <h2 className="text-sm font-black uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8]">Verlauf je Monat (Stück)</h2>
              <div className="h-64 text-[#1a1a1a] dark:text-[#e4e6eb]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.monate.map((m) => ({ ...m, name: monatText(m.monat) }))} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#8a939c" strokeOpacity={0.3} vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: "currentColor" }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "currentColor" }} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v) => `${zahl(Number(v))} Stück`} />
                    <Legend wrapperStyle={{ fontSize: 12 }} itemSorter={null} />
                    <Bar dataKey="gedruckt" name="Gedruckt" fill={FARBE_GEDRUCKT} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="ausgegeben" name="Ausgegeben (alle)" fill={FARBE_AUSGEGEBEN} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="ausDruck" name="davon aus dem Druck" fill={FARBE_AUS_DRUCK} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <details className="text-sm">
                <summary className={`cursor-pointer font-bold ${leise}`}>Als Tabelle</summary>
                <Tabelle kopf={["Monat", "Gedruckt", "Ausgegeben (alle)", "davon aus dem Druck"]}
                  zeilen={d.monate.map((m) => [monatText(m.monat), zahl(m.gedruckt), zahl(m.ausgegeben), zahl(m.ausDruck)])} />
              </details>
            </section>
          )}

          {/* Je Teiltyp */}
          <section className={`${karte} p-4 space-y-2`}>
            <h2 className="text-sm font-black uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8]">Je Teiltyp</h2>
            <Tabelle
              kopf={["Teiltyp", "Gedruckt", "Material", "Ausgegeben (alle)", "davon aus dem Druck", "Wert aus dem Druck", "Auf Lager aus dem Druck"]}
              zeilen={d.teiltypen.map((z) => [z.teiltyp, zahl(z.gedruckt), euro(z.material), zahl(z.ausgegeben), zahl(z.ausDruck), euroRund(z.wertAusDruck), zahl(z.lagerAusDruck)])}
            />
          </section>

          <Rechenweg d={d} darfPflegen={darfPflegen} />
        </>
      )}
    </div>
  );
}

function Kachel({ titel, farbe, gross, zeilen, hinweis }: {
  titel: string; farbe: string; gross: string; zeilen: (React.ReactNode | null)[]; hinweis?: string;
}) {
  return (
    <div className={`${karte} p-4`} style={{ borderTop: `4px solid ${farbe}` }}>
      <div className="text-xs font-black uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8]">
        {titel}{hinweis && <span className="normal-case font-bold tracking-normal"> · {hinweis}</span>}
      </div>
      <div className="text-3xl font-black text-[#202F61] dark:text-[#e4e6eb] mt-1">{gross}</div>
      {zeilen.filter(Boolean).map((z, i) => <div key={i} className="text-sm mt-1 text-[#1a1a1a] dark:text-[#e4e6eb]">{z}</div>)}
    </div>
  );
}

function Tabelle({ kopf, zeilen }: { kopf: string[]; zeilen: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className={`text-left ${leise}`}>
            {kopf.map((k, i) => <th key={k} scope="col" className={`py-2 pr-3 font-bold ${i > 0 ? "text-right" : ""}`}>{k}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#e4e6eb] dark:divide-[#3e4042]">
          {zeilen.map((z) => (
            <tr key={z[0]} className="text-[#1a1a1a] dark:text-[#e4e6eb]">
              {z.map((c, i) => i === 0
                ? <th key={i} scope="row" className="py-2 pr-3 text-left font-bold">{c}</th>
                : <td key={i} className="py-2 pr-3 text-right tabular-nums">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Daten = { euroProKg: number; grammSchaetzung: number; gedruckt: { geschaetztStueck: number; stueck: number } };

function Rechenweg({ d, darfPflegen }: { d: Daten; darfPflegen: boolean }) {
  const utils = api.useUtils();
  const [preis, setPreis] = useState(String(d.euroProKg).replace(".", ","));
  const [geaendert, setGeaendert] = useState(false);
  // Nachgeladene Daten überschreiben keine Eingabe (Formular-Falle 1).
  useEffect(() => { if (!geaendert) setPreis(String(d.euroProKg).replace(".", ",")); }, [d.euroProKg, geaendert]);
  const speichern = api.druck.filamentPreisSetzen.useMutation({
    onSuccess: async () => { setGeaendert(false); await utils.druck.auswertung.invalidate(); },
  });
  const zahlWert = Number(preis.replace(",", "."));
  const gueltig = preis.trim() !== "" && Number.isFinite(zahlWert) && zahlWert >= 0 && zahlWert <= 1000;

  return (
    <section className={`${karte} p-4 space-y-3 text-sm text-[#1a1a1a] dark:text-[#e4e6eb]`}>
      <h2 className="text-sm font-black uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8]">So wird gerechnet</h2>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Material:</strong> Filament laut Druckdatei × Filamentpreis.
          {d.gedruckt.geschaetztStueck > 0 && <> {zahl(d.gedruckt.geschaetztStueck)} von {zahl(d.gedruckt.stueck)} Stück wurden ohne Vorlage eingelagert — für sie gilt der Durchschnitt der Vorlagen ({d.grammSchaetzung.toLocaleString("de-DE")} g je Stück).</>}
        </li>
        <li><strong>Wert:</strong> Stückpreis des Artikels, sonst der <Link href="/admin/preise" className="underline font-bold">Kategorie-Preis</Link> — derselbe wie in der Statistik „Wert ausgegeben“.</li>
        <li><strong>Ausgegeben:</strong> alle Füße, die an die Technik oder an eine Niederlassung gingen (ohne Umlagerungen) — auch nicht gedruckte.</li>
        <li><strong>Aus dem 3D-Druck (rechnerisch):</strong> Im Karton sind gedruckte und andere Füße nicht zu unterscheiden. Gezählt wird je Artikel nach seinem Anteil am Eingang: Kam die Hälfte eines Artikels aus dem Drucker, zählt die Hälfte seiner Ausgaben. Direkt-Ausgaben (am Lager vorbei) zählen nicht dazu.</li>
        <li><strong>Bringt ein:</strong> Wert der ausgegebenen gedruckten Füße minus Material der im Zeitraum gedruckten. Was gedruckt im Lager liegt, bringt erst etwas, wenn es ausgegeben wird. Strom und Arbeitszeit sind nicht eingerechnet.</li>
      </ul>
      <div className="flex items-center gap-2 flex-wrap pt-1">
        <label htmlFor="filamentpreis" className="font-bold">Filamentpreis</label>
        <input
          id="filamentpreis"
          inputMode="decimal"
          value={preis}
          disabled={!darfPflegen || speichern.isPending}
          onChange={(e) => { setPreis(e.target.value); setGeaendert(true); }}
          className="w-24 px-3 rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#18191a] text-right min-h-[48px] disabled:opacity-70"
        />
        <span>€ je kg</span>
        {darfPflegen && geaendert && (
          <button type="button" className={knopfRand} disabled={!gueltig || speichern.isPending}
            onClick={() => speichern.mutate({ euroProKg: zahlWert })}>
            {speichern.isPending ? "Speichere…" : "Speichern"}
          </button>
        )}
        {speichern.isError && <span className="text-[#d93025] font-bold">{speichern.error.message}</span>}
      </div>
    </section>
  );
}

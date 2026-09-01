"use client";
import { useRef, useState } from "react";
import Papa from "papaparse";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";

/**
 * Import A/B-Test — read-only Probelauf des Geräte-Imports.
 *
 * Nutzt denselben Upload-/Parse-Weg wie der reguläre Import (PapaParse, ; -getrennt),
 * leitet aber NACH dem Parsen in eine separate, rein lesende Auswertung (kein Import,
 * keine Modell-Neuanlage). Vergleicht A (heutiges Matching) mit B (neuer Katalog-Abgleich).
 */

const CHUNK_SIZE = 1000;

type RohZeile = { logId: string; hersteller: string; bezeichnung: string; geraeteart: string };

type ABucket = "EXAKT" | "UNSICHER" | "NEU";
type BBucket = "EXAKT" | "ERKANNT" | "KANDIDATEN" | "NEU";
type DetailRow = {
  logId: string; hersteller: string; bezeichnung: string; clean: string;
  a: ABucket; b: BBucket; topKandidat: string | null; score: number;
};

type Agg = {
  ausgewertet:             number;
  abgelehnt:               number;
  uebersprungenGeraeteart: number;
  herstellerVerteilung:    Record<string, number>;
  geraeteartVerteilung:    Record<string, number>;
  abgelehntRegel:          Record<string, number>;
  aBuckets:                { EXAKT: number; UNSICHER: number; NEU: number };
  bBuckets:                { EXAKT: number; ERKANNT: number; KANDIDATEN: number; NEU: number };
  vermiedeneNeuanlagen:    number;
  bKandidaten:             number;
  beidseitigNeu:           number;
};

const LEER_AGG: Agg = {
  ausgewertet: 0, abgelehnt: 0, uebersprungenGeraeteart: 0,
  herstellerVerteilung: {}, geraeteartVerteilung: {}, abgelehntRegel: {},
  aBuckets: { EXAKT: 0, UNSICHER: 0, NEU: 0 },
  bBuckets: { EXAKT: 0, ERKANNT: 0, KANDIDATEN: 0, NEU: 0 },
  vermiedeneNeuanlagen: 0, bKandidaten: 0, beidseitigNeu: 0,
};

const nf = new Intl.NumberFormat("de-DE");

function addRecord(ziel: Record<string, number>, quelle: Record<string, number>) {
  for (const [k, v] of Object.entries(quelle)) ziel[k] = (ziel[k] ?? 0) + v;
}

type Fidelity = {
  geprueft: number;
  uebereinstimmungen: number;
  abweichungen: { hersteller: string; bezeichnung: string; aSpiegel: string; aEcht: string }[];
} | null;

export default function ImportABTestPage() {
  const { show } = useToast();
  const fileRef  = useRef<HTMLInputElement>(null);
  const detailRef = useRef<DetailRow[]>([]);

  const [geraeteart, setGeraeteart] = useState("Notebook");
  const [dragging, setDragging]     = useState(false);
  const [fileName, setFileName]     = useState("");
  const [running, setRunning]       = useState(false);
  const [phase, setPhase]           = useState<"parse" | "eval" | "">("");
  const [total, setTotal]           = useState(0);
  const [processed, setProcessed]   = useState(0);

  const [report, setReport]     = useState<Agg | null>(null);
  const [risiko, setRisiko]     = useState<DetailRow[]>([]);
  const [fidelity, setFidelity] = useState<Fidelity>(null);

  const dryRunChunk    = api.importSandbox.dryRunChunk.useMutation();
  const dryRunFidelity = api.importSandbox.dryRunFidelity.useMutation();

  async function processFile(file: File) {
    setFileName(file.name);
    setReport(null);
    setRisiko([]);
    setFidelity(null);
    detailRef.current = [];
    setProcessed(0);
    setRunning(true);
    setPhase("parse");

    // ── Parse: identisch zum regulären Import (PapaParse, ; -getrennt) ──
    const rows = await new Promise<RohZeile[]>((resolve) => {
      const result: RohZeile[] = [];
      Papa.parse(file, {
        header:         true,
        skipEmptyLines: true,
        delimiter:      ";",
        complete(res) {
          const data = res.data as Record<string, string>[];
          for (const r of data) {
            const bezeichnung = String(r["Bezeichnung"] || "").trim();
            if (!bezeichnung) continue;
            result.push({
              logId:       String(r["LogId"]      || "").trim(),
              hersteller:  String(r["Hersteller"] || "").trim(),
              bezeichnung,
              geraeteart:  String(r["Geräteart"]  || "").trim(),
            });
          }
          resolve(result);
        },
      });
    });

    setTotal(rows.length);
    if (!rows.length) {
      show("Keine auswertbaren Zeilen in der Datei gefunden.", "warning");
      setRunning(false);
      setPhase("");
      return;
    }

    // ── Fidelity-Stichprobe (50 Zeilen, gefiltert) gegen echtes getOrCreateModell ──
    const alle = geraeteart.toLowerCase() === "alle";
    const kandidatenFidelity = rows.filter((r) => alle || r.geraeteart === geraeteart);
    const stichprobe = zufallsStichprobe(kandidatenFidelity, 50).map((r) => ({
      logId: r.logId, hersteller: r.hersteller, bezeichnung: r.bezeichnung, geraeteart: r.geraeteart,
    }));
    if (stichprobe.length > 0) {
      dryRunFidelity.mutateAsync({ rows: stichprobe })
        .then((f) => setFidelity(f))
        .catch(() => { /* Fidelity ist optional, blockiert den Lauf nicht */ });
    }

    // ── Auswertung in Chunks (read-only) ──
    setPhase("eval");
    const agg: Agg = structuredClone(LEER_AGG);

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      try {
        const res = await dryRunChunk.mutateAsync({ rows: chunk, geraeteartFilter: geraeteart });
        agg.ausgewertet             += res.ausgewertet;
        agg.abgelehnt               += res.abgelehnt;
        agg.uebersprungenGeraeteart += res.uebersprungenGeraeteart;
        agg.vermiedeneNeuanlagen    += res.vermiedeneNeuanlagen;
        agg.bKandidaten             += res.bKandidaten;
        agg.beidseitigNeu           += res.beidseitigNeu;
        agg.aBuckets.EXAKT    += res.aBuckets.EXAKT;
        agg.aBuckets.UNSICHER += res.aBuckets.UNSICHER;
        agg.aBuckets.NEU      += res.aBuckets.NEU;
        agg.bBuckets.EXAKT      += res.bBuckets.EXAKT;
        agg.bBuckets.ERKANNT    += res.bBuckets.ERKANNT;
        agg.bBuckets.KANDIDATEN += res.bBuckets.KANDIDATEN;
        agg.bBuckets.NEU        += res.bBuckets.NEU;
        addRecord(agg.herstellerVerteilung, res.herstellerVerteilung);
        addRecord(agg.geraeteartVerteilung, res.geraeteartVerteilung);
        addRecord(agg.abgelehntRegel,       res.abgelehntRegel);
        detailRef.current.push(...res.detail);
      } catch {
        show("Ein Chunk konnte nicht ausgewertet werden. Die Auswertung läuft weiter.", "error");
      }
      setProcessed(Math.min(i + CHUNK_SIZE, rows.length));
    }

    // Risiko-Stichprobe: B=ERKANNT mit knappem Score (<0.6) → mögliche Fehltreffer.
    setRisiko(detailRef.current.filter((d) => d.b === "ERKANNT" && d.score < 0.6).slice(0, 30));
    setReport(agg);
    setRunning(false);
    setPhase("");
    show(`✅ Probelauf fertig: ${nf.format(agg.ausgewertet)} Zeilen ausgewertet`, "success");
  }

  function handleFile(file: File | null) {
    if (!file) return;
    if (!file.name.endsWith(".csv")) { show("Nur CSV-Dateien erlaubt.", "error"); return; }
    processFile(file);
  }

  function downloadCsv() {
    const header = ["LogId", "hersteller", "bezeichnung", "clean", "A", "B", "Top-Kandidat", "Score"];
    const zeilen = detailRef.current.map((d) =>
      [d.logId, d.hersteller, d.bezeichnung, d.clean, d.a, d.b, d.topKandidat ?? "", String(d.score)]
        .map((f) => `"${String(f).replace(/"/g, '""')}"`)
        .join(";"),
    );
    const csv  = [header.map((h) => `"${h}"`).join(";"), ...zeilen].join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `import-ab-test_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const progress = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <div className="max-w-4xl space-y-6">
      {/* ── Kopf ── */}
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex items-center justify-center w-11 h-11 rounded-xl text-white text-xl flex-shrink-0" style={{ background: "#202F61" }}>⚖️</span>
        <div>
          <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Import A/B-Test</h1>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
            Probelauf: vergleicht das heutige Matching (A) mit dem neuen Katalog-Abgleich (B), anhand einer echten CSV.
          </p>
        </div>
      </div>

      {/* ── Banner ── */}
      <div role="note" className="flex items-start gap-3 rounded-2xl border-2 border-[#f7b928]/40 bg-[#f7b928]/10 px-5 py-4">
        <span aria-hidden className="text-xl">🛡️</span>
        <p className="text-sm font-bold text-[#9a7b0a] dark:text-[#f7b928]">
          Probelauf: es wird NICHTS importiert oder gespeichert. Es werden keine Modelle angelegt.
        </p>
      </div>

      {/* ── Geräteart-Filter ── */}
      <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-5 sm:p-6">
        <label htmlFor="ab-geraeteart" className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1.5 uppercase tracking-wider">
          Geräteart-Filter
        </label>
        <select
          id="ab-geraeteart"
          value={geraeteart}
          onChange={(e) => setGeraeteart(e.target.value)}
          disabled={running}
          className="w-full sm:w-72 min-h-[56px] px-4 rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] text-base outline-none focus:border-[#008BD2] focus:ring-2 focus:ring-[#008BD2]/40 transition-colors disabled:opacity-50"
        >
          <option value="Notebook">Notebook (Standard)</option>
          <option value="alle">alle Gerätearten</option>
        </select>
      </div>

      {/* ── Drop-Zone ── */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0] ?? null); }}
        onClick={() => !running && fileRef.current?.click()}
        className={`rounded-2xl border-2 border-dashed p-10 text-center transition-all ${
          running ? "pointer-events-none opacity-60" : "cursor-pointer"
        } ${dragging ? "border-[#008BD2] bg-[#008BD2]/5" : "border-[#ced4da] dark:border-[#3e4042] hover:border-[#008BD2]/50 hover:bg-[#f0f2f5] dark:hover:bg-[#18191a]"}`}
      >
        <div className="text-4xl mb-3" aria-hidden>📂</div>
        <p className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">CSV hier ablegen oder klicken</p>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
          Format wie beim regulären Import · Spalten: LogId, Geräteart, Hersteller, Bezeichnung
        </p>
        {fileName && <p className="mt-3 text-sm font-mono text-[#008BD2]">{fileName}</p>}
        <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
      </div>

      {/* ── Fortschritt ── */}
      {running && (
        <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
              {phase === "parse" ? "CSV wird gelesen…" : `${nf.format(processed)} von ${nf.format(total)} ausgewertet`}
            </span>
            {phase === "eval" && <span className="text-[#008BD2] font-bold">{progress}%</span>}
          </div>
          <div className="w-full bg-[#f0f2f5] dark:bg-[#18191a] rounded-full h-4 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-300" style={{ width: phase === "parse" ? "100%" : `${progress}%`, background: "#008BD2" }} />
          </div>
        </div>
      )}

      {/* ── Report ── */}
      {report && !running && <Report agg={report} risiko={risiko} fidelity={fidelity} onDownload={downloadCsv} />}
    </div>
  );
}

// ── Hilfsfunktion: Zufallsstichprobe ──
function zufallsStichprobe<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return [...arr];
  const kopie = [...arr];
  for (let i = kopie.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [kopie[i], kopie[j]] = [kopie[j], kopie[i]];
  }
  return kopie.slice(0, n);
}

// ── Report-Darstellung ──
function Report({ agg, risiko, fidelity, onDownload }: { agg: Agg; risiko: DetailRow[]; fidelity: Fidelity; onDownload: () => void }) {
  const herstellerTop = Object.entries(agg.herstellerVerteilung).sort((a, b) => b[1] - a[1]);
  const geraeteartTop = Object.entries(agg.geraeteartVerteilung).sort((a, b) => b[1] - a[1]).slice(0, 6);

  return (
    <div className="space-y-5">
      {/* Übersicht */}
      <section className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-black text-lg text-[#1a1a1a] dark:text-[#e4e6eb]">Ergebnis des Probelaufs</h2>
          <button
            onClick={onDownload}
            className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-lg text-white text-sm font-bold focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#008BD2] dark:focus:ring-offset-[#242526]"
            style={{ background: "#008BD2" }}
          >
            ⬇️ Detail-CSV herunterladen
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Kennzahl label="Ausgewertet" value={agg.ausgewertet} color="#202F61" />
          <Kennzahl label="Abgelehnt (Hersteller)" value={agg.abgelehnt} color="#fa3e3e" />
          <Kennzahl label="Übersprungen (Geräteart)" value={agg.uebersprungenGeraeteart} color="#65676b" />
        </div>

        <div className="grid sm:grid-cols-2 gap-4 pt-1">
          <Verteilung titel="Hersteller (zugelassen)" eintraege={herstellerTop} />
          <Verteilung titel="Geräteart (alle Zeilen)" eintraege={geraeteartTop} />
        </div>
        {Object.keys(agg.abgelehntRegel).length > 0 && (
          <Verteilung titel="Ablehnungs-Regeln" eintraege={Object.entries(agg.abgelehntRegel).sort((a, b) => b[1] - a[1])} />
        )}
      </section>

      {/* A vs B Buckets */}
      <section className="grid sm:grid-cols-2 gap-5">
        <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-5">
          <h3 className="font-black text-base text-[#1a1a1a] dark:text-[#e4e6eb] mb-3">A: heutiges Matching</h3>
          <BucketRow label="EXAKT (eindeutig erkannt)" value={agg.aBuckets.EXAKT} color="#04B475" />
          <BucketRow label="UNSICHER (Admin bestätigt)" value={agg.aBuckets.UNSICHER} color="#f7b928" />
          <BucketRow label="NEU (würde neu angelegt)" value={agg.aBuckets.NEU} color="#008BD2" />
        </div>
        <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-5">
          <h3 className="font-black text-base text-[#1a1a1a] dark:text-[#e4e6eb] mb-3">B: neuer Katalog-Abgleich</h3>
          <BucketRow label="EXAKT (perfekter Treffer)" value={agg.bBuckets.EXAKT} color="#04B475" />
          <BucketRow label="ERKANNT (1 Kandidat)" value={agg.bBuckets.ERKANNT} color="#04B475" />
          <BucketRow label="KANDIDATEN (mehrere)" value={agg.bBuckets.KANDIDATEN} color="#f7b928" />
          <BucketRow label="NEU (kein Treffer)" value={agg.bBuckets.NEU} color="#008BD2" />
        </div>
      </section>

      {/* Kern-Kennzahl */}
      <section className="rounded-2xl border-2 border-[#04B475]/50 bg-[#04B475]/[0.06] shadow-sm p-5 sm:p-6">
        <h3 className="font-black text-base text-[#1a1a1a] dark:text-[#e4e6eb] mb-3">Was B zusätzlich findet</h3>
        <div className="grid grid-cols-3 gap-3">
          <Kennzahl label="Vermiedene Neuanlagen (A: NEU/UNSICHER → B: erkannt)" value={agg.vermiedeneNeuanlagen} color="#04B475" />
          <Kennzahl label="B: mehrere Kandidaten" value={agg.bKandidaten} color="#f7b928" />
          <Kennzahl label="Beidseitig NEU" value={agg.beidseitigNeu} color="#008BD2" />
        </div>
      </section>

      {/* Risiko-Stichprobe */}
      <section className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-5 sm:p-6">
        <h3 className="font-black text-base text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Risiko: knappe B-Treffer (Score &lt; 60 %)</h3>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mb-3">
          B = ERKANNT, aber knapper Score. Mögliche Fehltreffer. Hier lohnt eine manuelle Kontrolle.
        </p>
        {risiko.length === 0 ? (
          <p className="text-sm text-[#04B475] font-semibold">✅ Keine knappen B-Treffer.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-[#ced4da] dark:border-[#3e4042] text-xs uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8]">
                  <th scope="col" className="px-3 py-2">Bezeichnung</th>
                  <th scope="col" className="px-3 py-2">Top-Kandidat</th>
                  <th scope="col" className="px-3 py-2 text-right">Score</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {risiko.map((d, i) => (
                  <tr key={i} className="border-b border-[#ced4da]/40 dark:border-[#3e4042]/40">
                    <td className="px-3 py-2 break-all text-[#1a1a1a] dark:text-[#e4e6eb]">{d.bezeichnung}</td>
                    <td className="px-3 py-2 break-all text-[#008BD2]">{d.topKandidat}</td>
                    <td className="px-3 py-2 text-right font-bold text-[#f7b928]">{Math.round(d.score * 100)} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Fidelity */}
      <section className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-5 sm:p-6">
        <h3 className="font-black text-base text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Fidelity-Check (A-Spiegel = echte Logik?)</h3>
        {!fidelity ? (
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Stichprobe wird geprüft…</p>
        ) : fidelity.geprueft === 0 ? (
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Keine vergleichbaren Zeilen in der Stichprobe.</p>
        ) : (
          <>
            <p className={`text-sm font-bold ${fidelity.abweichungen.length === 0 ? "text-[#04B475]" : "text-[#fa3e3e]"}`}>
              {fidelity.abweichungen.length === 0 ? "✅" : "⚠️"} {nf.format(fidelity.uebereinstimmungen)} / {nf.format(fidelity.geprueft)} Zeilen stimmen mit der echten getOrCreateModell-Logik überein
            </p>
            {fidelity.abweichungen.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs font-mono text-[#65676b] dark:text-[#b0b3b8]">
                {fidelity.abweichungen.slice(0, 10).map((a, i) => (
                  <li key={i} className="break-all">
                    {a.hersteller} · {a.bezeichnung} · Spiegel: <span className="font-bold">{a.aSpiegel}</span>, echt: <span className="font-bold">{a.aEcht}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] px-1">
        <span aria-hidden>ℹ️ </span>Reine Vorschau. Der echte Import und getOrCreateModell bleiben unberührt.
      </p>
    </div>
  );
}

function Kennzahl({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center p-3 bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl">
      <div className="text-2xl font-black" style={{ color }}>{nf.format(value)}</div>
      <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1 leading-tight">{label}</div>
    </div>
  );
}

function BucketRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-[#ced4da]/40 dark:border-[#3e4042]/40 last:border-0">
      <span className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb] flex items-center gap-2">
        <span aria-hidden className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
        {label}
      </span>
      <span className="text-sm font-black tabular-nums" style={{ color }}>{nf.format(value)}</span>
    </div>
  );
}

function Verteilung({ titel, eintraege }: { titel: string; eintraege: [string, number][] }) {
  return (
    <div>
      <p className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1.5 uppercase tracking-wider">{titel}</p>
      <ul className="space-y-1">
        {eintraege.map(([k, v]) => (
          <li key={k} className="flex items-center justify-between text-sm">
            <span className="text-[#1a1a1a] dark:text-[#e4e6eb] break-all">{k}</span>
            <span className="font-semibold tabular-nums text-[#65676b] dark:text-[#b0b3b8]">{nf.format(v)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

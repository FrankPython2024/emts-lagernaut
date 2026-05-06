"use client";
import { useRef, useState } from "react";
import Papa from "papaparse";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";

const CHUNK_SIZE = 500;

type Row = { logId: string; hersteller: string; bezeichnung: string };
type Stats = { imported: number; updated: number; errors: number };

function bereinige(bezeichnung: string): string {
  let result = bezeichnung.trim();
  let prev   = "";
  while (prev !== result) {
    prev   = result;
    result = result.replace(/\s+[A-Z0-9]{4,}[-A-Z0-9]*$/, "").trim();
  }
  return result;
}

export default function GeraeteImportPage() {
  const { show } = useToast();
  const fileRef  = useRef<HTMLInputElement>(null);
  const [dragging,   setDragging]   = useState(false);
  const [fileName,   setFileName]   = useState("");
  const [running,    setRunning]    = useState(false);
  const [total,      setTotal]      = useState(0);
  const [processed,  setProcessed]  = useState(0);
  const [stats,      setStats]      = useState<Stats | null>(null);

  const stats_q = api.geraeteLookup.getStats.useQuery();

  const importChunk = api.geraeteLookup.importChunk.useMutation();

  async function processFile(file: File) {
    setFileName(file.name);
    setStats(null);
    setProcessed(0);
    setRunning(true);

    // CSV parsen (gesamte Datei in Speicher)
    const rows = await new Promise<Row[]>((resolve) => {
      const result: Row[] = [];
      Papa.parse(file, {
        header:         true,
        skipEmptyLines: true,
        delimiter:      ";",
        complete(res) {
          const data = res.data as Record<string, string>[];
          for (const r of data) {
            const geraeteart = String(r["Geräteart"] || "").trim();
            if (geraeteart !== "Notebook") continue;

            const logId       = String(r["LogId"]       || "").trim();
            const hersteller  = String(r["Hersteller"]  || "").trim();
            const bezeichnung = String(r["Bezeichnung"] || "").trim();
            if (!logId || !bezeichnung) continue;

            result.push({ logId, hersteller, bezeichnung });
          }
          resolve(result);
        },
      });
    });

    setTotal(rows.length);
    if (!rows.length) {
      show("Keine Notebooks in der Datei gefunden.", "warning");
      setRunning(false);
      return;
    }

    const gesamt: Stats = { imported: 0, updated: 0, errors: 0 };

    // In Chunks aufteilen und sequenziell senden
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      try {
        const res = await importChunk.mutateAsync({ rows: chunk });
        gesamt.imported += res.imported;
        gesamt.updated  += res.updated;
        gesamt.errors   += res.errors;
      } catch (e) {
        gesamt.errors += chunk.length;
      }
      setProcessed(Math.min(i + CHUNK_SIZE, rows.length));
    }

    setStats(gesamt);
    setRunning(false);
    stats_q.refetch();
    show(`✅ Import abgeschlossen! ${gesamt.imported} neu, ${gesamt.updated} aktualisiert`, "success");
  }

  function handleFile(file: File | null) {
    if (!file) return;
    if (!file.name.endsWith(".csv")) { show("Nur CSV-Dateien erlaubt.", "error"); return; }
    processFile(file);
  }

  const progress = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Geräte Import</h1>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
          CSV mit LogID-Gerätedaten importieren · Nur Notebooks werden importiert
        </p>
      </div>

      {/* DB-Statistik */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-4 shadow-sm flex items-center gap-4">
        <div className="text-3xl font-black text-[#0064d2] dark:text-[#45bdff]">
          {stats_q.data?.total.toLocaleString("de-DE") ?? "–"}
        </div>
        <div>
          <div className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Geräte in Datenbank</div>
          <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">GeraeteLookup Tabelle</div>
        </div>
      </div>

      {/* Drag & Drop Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0] ?? null); }}
        onClick={() => !running && fileRef.current?.click()}
        className={`
          rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-all
          ${dragging
            ? "border-[#0064d2] bg-[#0064d2]/5"
            : "border-[#ced4da] dark:border-[#3e4042] hover:border-[#0064d2]/50 hover:bg-[#f0f2f5] dark:hover:bg-[#18191a]"
          }
          ${running ? "pointer-events-none opacity-60" : ""}
        `}
      >
        <div className="text-4xl mb-3">📂</div>
        <p className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
          CSV hier ablegen oder klicken
        </p>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
          Format: Semikolon-getrennt · Spalten: LogId, Geräteart, Hersteller, Bezeichnung
        </p>
        {fileName && (
          <p className="mt-3 text-sm font-mono text-[#0064d2] dark:text-[#45bdff]">{fileName}</p>
        )}
        <input ref={fileRef} type="file" accept=".csv" className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
      </div>

      {/* Fortschritt */}
      {(running || stats) && (
        <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm space-y-4">
          {running && (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
                  {processed.toLocaleString("de-DE")} von {total.toLocaleString("de-DE")} verarbeitet
                </span>
                <span className="text-[#0064d2] dark:text-[#45bdff] font-bold">{progress}%</span>
              </div>
              <div className="w-full bg-[#f0f2f5] dark:bg-[#18191a] rounded-full h-4 overflow-hidden">
                <div
                  className="h-full bg-[#0064d2] dark:bg-[#45bdff] rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] text-center">
                {Math.ceil((total - processed) / CHUNK_SIZE)} Chunks verbleibend…
              </p>
            </>
          )}

          {stats && !running && (
            <>
              <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Import abgeschlossen ✅</h2>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Neu importiert", value: stats.imported, color: "text-[#00a400]" },
                  { label: "Aktualisiert",   value: stats.updated,  color: "text-[#0064d2] dark:text-[#45bdff]" },
                  { label: "Fehler",         value: stats.errors,   color: "text-[#fa3e3e]" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="text-center p-3 bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl">
                    <div className={`text-2xl font-black ${color}`}>{value.toLocaleString("de-DE")}</div>
                    <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1">{label}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Format-Hilfe */}
      <div className="bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl p-4 text-xs font-mono text-[#65676b] dark:text-[#b0b3b8] space-y-1">
        <p className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-2">Erwartetes CSV-Format:</p>
        <p>"LogId";"Geräteart";"Hersteller";"Bezeichnung"</p>
        <p>"212.826.176";"Notebook";"Lenovo";"ThinkPad T14 Gen 2i 20W1S06V00"</p>
        <p className="mt-2 text-[#65676b] dark:text-[#b0b3b8]">
          → Interne Codes (z.B. "20W1S06V00") werden automatisch entfernt<br />
          → LogId wird normalisiert: "212.826.176" → "212826176"
        </p>
      </div>
    </div>
  );
}

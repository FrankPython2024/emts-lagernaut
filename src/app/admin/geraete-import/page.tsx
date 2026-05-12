"use client";
import { useRef, useState, useEffect } from "react";
import { useRouter }  from "next/navigation";
import Papa           from "papaparse";
import { api }        from "@/trpc/react";
import { useToast }   from "@/components/ui/Toast";
import { STANDARD_TEILTYPEN } from "@/lib/constants/teiltypen";

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

type GeneratorPhase = "idle" | "confirm" | "running" | "done";

type GenProgress = {
  progress:       number;
  modelsProcessed: number;
  totalModels:    number;
  artikelCreated: number;
  artikelSkipped: number;
  currentModel:   string;
};

export default function GeraeteImportPage() {
  const router    = useRouter();
  const { show }  = useToast();
  const fileRef   = useRef<HTMLInputElement>(null);

  // ── Import-State ─────────────────────────────────────────────────────────
  const [dragging,   setDragging]   = useState(false);
  const [fileName,   setFileName]   = useState("");
  const [running,    setRunning]    = useState(false);
  const [total,      setTotal]      = useState(0);
  const [processed,  setProcessed]  = useState(0);
  const [stats,      setStats]      = useState<Stats | null>(null);

  // ── Generator-State ──────────────────────────────────────────────────────
  const [genPhase,   setGenPhase]   = useState<GeneratorPhase>("idle");
  const [genJobId,   setGenJobId]   = useState<string | null>(null);
  const [genResult,  setGenResult]  = useState<{ totalModels: number; artikelCreated: number; artikelSkipped: number } | null>(null);

  const stats_q        = api.geraeteLookup.getStats.useQuery();
  const genPreviewQ    = api.geraeteLookup.getArtikelGeneratorPreview.useQuery(undefined, { staleTime: 15_000 });

  const genStatusQ = api.geraeteLookup.getArtikelGeneratorStatus.useQuery(
    { jobId: genJobId ?? "" },
    { enabled: !!genJobId && genPhase === "running", refetchInterval: 2_000, staleTime: 0 },
  );

  // Job-Abschluss überwachen
  useEffect(() => {
    if (!genStatusQ.data) return;
    if (genStatusQ.data.state === "completed" && genStatusQ.data.result) {
      setGenResult(genStatusQ.data.result);
      setGenPhase("done");
      genPreviewQ.refetch();
      show("✅ Artikel-Generator abgeschlossen!", "success");
    } else if (genStatusQ.data.state === "failed") {
      show(`Generator-Fehler: ${genStatusQ.data.failedReason ?? "unbekannt"}`, "error");
      setGenPhase("idle");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genStatusQ.data?.state]);

  const startGeneratorMutation = api.geraeteLookup.generiereArtikelFuerAlleModelle.useMutation({
    onSuccess: (data) => {
      setGenJobId(data.jobId);
      setGenPhase("running");
      show(`⚙️ Generator gestartet — ${data.modelle} Modelle × ${data.teile} Teile`, "info");
    },
    onError: (e) => show(`Fehler: ${e.message}`, "error"),
  });

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

      {/* ── Artikel-Generator ─────────────────────────────────────────────── */}
      <div className="border-2 border-dashed border-[#0064d2]/40 dark:border-[#45bdff]/30 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 bg-[#0064d2]/8 dark:bg-[#45bdff]/8 border-b border-[#0064d2]/20 dark:border-[#45bdff]/20">
          <span className="text-lg">⚙️</span>
          <div>
            <span className="font-bold text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
              Schritt 2 (optional) — Artikel automatisch generieren
            </span>
            <p className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
              {STANDARD_TEILTYPEN.length} Standard-Teile pro Modell anlegen · Bestand: 0 · Idempotent (sicher mehrfach starten)
            </p>
          </div>
        </div>

        <div className="p-5">

          {/* ── Phase: idle ── */}
          {genPhase === "idle" && (
            <>
              {genPreviewQ.data && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                  {[
                    { label: "Modelle in DB",    value: genPreviewQ.data.modelle.toLocaleString("de-DE"),         color: "text-[#0064d2] dark:text-[#45bdff]" },
                    { label: "Teile pro Modell", value: STANDARD_TEILTYPEN.length,                                 color: "text-[#1a1a1a] dark:text-[#e4e6eb]" },
                    { label: "Erwartet gesamt",  value: genPreviewQ.data.erwartet.toLocaleString("de-DE"),         color: "text-[#f7b928]" },
                    { label: "Artikel in DB",    value: genPreviewQ.data.existingArtikel.toLocaleString("de-DE"),  color: "text-[#00a400]" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl p-3 text-center">
                      <div className={`text-2xl font-black ${color}`}>{value}</div>
                      <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-0.5">{label}</div>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => setGenPhase("confirm")}
                disabled={!genPreviewQ.data || genPreviewQ.data.modelle === 0}
                className="flex items-center gap-2 px-5 py-3 bg-[#0064d2] dark:bg-[#45bdff] text-white font-bold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity text-sm"
              >
                ⚙️ Artikel generieren
              </button>
              {genPreviewQ.data?.modelle === 0 && (
                <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-2">
                  Zuerst Geräte importieren (Schritt 1).
                </p>
              )}
            </>
          )}

          {/* ── Phase: confirm ── */}
          {genPhase === "confirm" && genPreviewQ.data && (
            <div>
              <h3 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-3">
                ❓ Artikel-Generator starten?
              </h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm mb-4 text-[#65676b] dark:text-[#b0b3b8]">
                {STANDARD_TEILTYPEN.map((t) => (
                  <div key={t.name} className="flex items-center gap-1.5">
                    <span>{t.icon}</span>
                    <span className={t.pflicht ? "text-[#1a1a1a] dark:text-[#e4e6eb]" : "opacity-70"}>
                      {t.name}{!t.pflicht && " (optional)"}
                    </span>
                  </div>
                ))}
              </div>
              <div className="bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl p-4 mb-4 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-[#65676b] dark:text-[#b0b3b8]">Modelle:</span>
                  <span className="font-bold">{genPreviewQ.data.modelle.toLocaleString("de-DE")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#65676b] dark:text-[#b0b3b8]">Teile pro Modell:</span>
                  <span className="font-bold">{STANDARD_TEILTYPEN.length}</span>
                </div>
                <div className="flex justify-between border-t border-[#ced4da] dark:border-[#3e4042] pt-1 mt-1">
                  <span className="text-[#65676b] dark:text-[#b0b3b8]">Neue Artikel (max.):</span>
                  <span className="font-bold text-[#f7b928]">{genPreviewQ.data.erwartet.toLocaleString("de-DE")}</span>
                </div>
                <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] pt-1">
                  Bestehende Artikel werden nicht überschrieben. Dauer: ~3–5 Min.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setGenPhase("idle")}
                  className="flex-1 py-2.5 text-sm font-semibold rounded-xl border border-[#ced4da] dark:border-[#3e4042] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors"
                >
                  ❌ Abbrechen
                </button>
                <button
                  onClick={() => startGeneratorMutation.mutate()}
                  disabled={startGeneratorMutation.isPending}
                  className="flex-1 py-2.5 bg-[#0064d2] dark:bg-[#45bdff] text-white text-sm font-bold rounded-xl hover:opacity-90 disabled:opacity-60 transition-opacity"
                >
                  {startGeneratorMutation.isPending ? "⏳ Starte…" : "✅ Jetzt starten"}
                </button>
              </div>
            </div>
          )}

          {/* ── Phase: running ── */}
          {genPhase === "running" && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">⚙️ Artikel werden erstellt…</h3>
                <div className="text-sm font-bold text-[#0064d2] dark:text-[#45bdff]">
                  {typeof genStatusQ.data?.progress === "object" && genStatusQ.data.progress !== null
                    ? `${(genStatusQ.data.progress as GenProgress).progress ?? 0}%`
                    : "…"}
                </div>
              </div>

              {(() => {
                const p = (typeof genStatusQ.data?.progress === "object" ? genStatusQ.data?.progress : null) as GenProgress | null;
                const pct = p?.progress ?? 0;
                return (
                  <>
                    <div className="w-full bg-[#f0f2f5] dark:bg-[#18191a] rounded-full h-4 overflow-hidden mb-4">
                      <div
                        className="h-full bg-[#0064d2] dark:bg-[#45bdff] rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {p && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                        {[
                          { label: "Modelle",    value: `${p.modelsProcessed} / ${p.totalModels}` },
                          { label: "Erstellt",   value: p.artikelCreated.toLocaleString("de-DE") },
                          { label: "Übersprungen", value: p.artikelSkipped.toLocaleString("de-DE") },
                          { label: "Fortschritt", value: `${pct}%` },
                        ].map(({ label, value }) => (
                          <div key={label} className="bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl p-3 text-center">
                            <div className="text-lg font-black text-[#0064d2] dark:text-[#45bdff]">{value}</div>
                            <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-0.5">{label}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {p?.currentModel && (
                      <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] truncate">
                        Aktuell: <span className="font-mono">{p.currentModel}</span>
                      </p>
                    )}
                    <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-2">
                      Du kannst diese Seite verlassen — der Generator läuft im Hintergrund weiter.
                    </p>
                  </>
                );
              })()}
            </div>
          )}

          {/* ── Phase: done ── */}
          {genPhase === "done" && genResult && (
            <div>
              <div className="text-center mb-5">
                <div className="text-4xl mb-2">🎉</div>
                <h3 className="text-xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">
                  Artikel erfolgreich erstellt!
                </h3>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  { label: "Modelle verarbeitet", value: genResult.totalModels.toLocaleString("de-DE"),    color: "text-[#0064d2] dark:text-[#45bdff]" },
                  { label: "Artikel erstellt",     value: genResult.artikelCreated.toLocaleString("de-DE"), color: "text-[#00a400]" },
                  { label: "Übersprungen",         value: genResult.artikelSkipped.toLocaleString("de-DE"), color: "text-[#f7b928]" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl p-3 text-center">
                    <div className={`text-2xl font-black ${color}`}>{value}</div>
                    <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-0.5">{label}</div>
                  </div>
                ))}
              </div>
              <div className="flex gap-3 flex-wrap">
                <button
                  onClick={() => router.push("/admin/einlagern")}
                  className="flex-1 py-2.5 bg-[#0064d2] dark:bg-[#45bdff] text-white text-sm font-bold rounded-xl hover:opacity-90 transition-opacity"
                >
                  📦 Einlager-Assistent
                </button>
                <button
                  onClick={() => router.push("/admin/artikel")}
                  className="flex-1 py-2.5 border border-[#ced4da] dark:border-[#3e4042] text-sm font-semibold rounded-xl hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors"
                >
                  📋 Artikel-Liste
                </button>
                <button
                  onClick={() => { setGenPhase("idle"); setGenResult(null); setGenJobId(null); genPreviewQ.refetch(); }}
                  className="py-2.5 px-4 text-sm text-[#65676b] dark:text-[#b0b3b8] hover:text-[#1a1a1a] dark:hover:text-[#e4e6eb] transition-colors"
                >
                  Nochmal starten
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

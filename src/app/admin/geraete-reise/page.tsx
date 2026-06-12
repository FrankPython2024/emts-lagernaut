"use client";
import { useRef, useState } from "react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";

// Geräte-Reise (LogID-Tracking) — S1-UI: Datei-Upload + Liste der Importe.
// KEINE Geräte-Reise-Ansicht / kein Aggregat-Dashboard (das ist S2/S3).

function fmtDatum(d: Date | string): string {
  return new Date(d).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

const STATUS: Record<string, { label: string; cls: string }> = {
  "läuft":  { label: "läuft",  cls: "bg-[#fff4d6] text-[#a06a00] dark:bg-[#3a2f10] dark:text-[#f7b928]" },
  "fertig": { label: "fertig", cls: "bg-[#d9f7e6] text-[#00723f] dark:bg-[#10301f] dark:text-[#04B475]" },
  "fehler": { label: "fehler", cls: "bg-[#ffe0e0] text-[#b3261e] dark:bg-[#3a1414] dark:text-[#ff8a8a]" },
};

export default function GeraeteReisePage() {
  const { show } = useToast();
  const fileRef  = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  const importeQ = api.geraeteReise.listImports.useQuery(undefined, {
    // Solange ein Import läuft, alle 2s nachladen (Fortschritt/Status).
    refetchInterval: (q) =>
      (q.state.data ?? []).some((i) => i.status === "läuft") ? 2_000 : false,
  });

  async function uploadFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      show("Nur CSV-Dateien erlaubt.", "error");
      return;
    }
    setUploading(true);
    try {
      const res = await fetch(`/api/geraete-reise/upload?name=${encodeURIComponent(file.name)}`, {
        method: "POST",
        body:   file,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Fehler ${res.status}`);
      }
      show("✅ Upload gestartet — Import läuft im Hintergrund.", "success");
      importeQ.refetch();
    } catch (e) {
      show(`Upload fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function handleFile(file: File | null) {
    if (file) uploadFile(file);
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">🧭 Geräte-Reise</h1>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
          ReForm-LogID-Export hochladen · je LogID wird der aktuelle Stand gepflegt,
          Änderungen werden als Bewegungen festgehalten. Reine Auswertung — kein Bestandseffekt.
        </p>
      </div>

      {/* Drag & Drop / Upload */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0] ?? null); }}
        onClick={() => !uploading && fileRef.current?.click()}
        className={`rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-all ${
          dragging
            ? "border-[#0064d2] bg-[#0064d2]/5"
            : "border-[#ced4da] dark:border-[#3e4042] hover:border-[#0064d2]/50 hover:bg-[#f0f2f5] dark:hover:bg-[#18191a]"
        } ${uploading ? "pointer-events-none opacity-60" : ""}`}
      >
        <div className="text-4xl mb-3">{uploading ? "⏳" : "📂"}</div>
        <p className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
          {uploading ? "Wird hochgeladen…" : "CSV hier ablegen oder klicken"}
        </p>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
          Format: Semikolon-getrennt, UTF-8, Felder in Anführungszeichen
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
        />
      </div>

      {/* Import-Liste */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042] flex items-center justify-between">
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Importe</h2>
          <button
            onClick={() => importeQ.refetch()}
            className="text-xs font-semibold text-[#0064d2] dark:text-[#45bdff] hover:underline"
          >
            ↻ Aktualisieren
          </button>
        </div>

        {importeQ.isLoading ? (
          <div className="p-8 text-center text-[#65676b] dark:text-[#b0b3b8]">Lädt…</div>
        ) : (importeQ.data?.length ?? 0) === 0 ? (
          <div className="p-8 text-center text-[#65676b] dark:text-[#b0b3b8]">
            Noch keine Importe. Lade oben eine Datei hoch.
          </div>
        ) : (
          <div className="divide-y divide-[#ced4da] dark:divide-[#3e4042]">
            {importeQ.data!.map((imp) => {
              const st = STATUS[imp.status] ?? { label: imp.status, cls: "bg-gray-100 text-gray-600" };
              const pct = imp.anzahlZeilen > 0
                ? Math.round((imp.verarbeitet / imp.anzahlZeilen) * 100)
                : null;
              return (
                <div key={imp.id} className="px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] truncate" title={imp.dateiname}>
                        {imp.dateiname}
                      </div>
                      <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
                        #{imp.id} · {fmtDatum(imp.importiertAm)}
                      </div>
                    </div>
                    <span className={`flex-shrink-0 text-xs font-black px-2.5 py-1 rounded-full ${st.cls}`}>
                      {st.label}
                    </span>
                  </div>

                  {/* Fortschritt während des Laufs */}
                  {imp.status === "läuft" && (
                    <div className="mt-3">
                      <div className="w-full bg-[#f0f2f5] dark:bg-[#18191a] rounded-full h-2.5 overflow-hidden">
                        <div
                          className="h-full bg-[#f7b928] rounded-full transition-all duration-500"
                          style={{ width: pct !== null ? `${pct}%` : "100%" }}
                        />
                      </div>
                      <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1">
                        {imp.verarbeitet.toLocaleString("de-DE")} Zeilen verarbeitet
                        {pct !== null && ` · ${pct}%`}
                      </div>
                    </div>
                  )}

                  {/* Zähler nach Abschluss */}
                  {imp.status === "fertig" && (
                    <div className="grid grid-cols-4 gap-2 mt-3">
                      {[
                        { label: "Zeilen",      value: imp.anzahlZeilen },
                        { label: "Neu",         value: imp.anzahlNeu },
                        { label: "Aktualisiert", value: imp.anzahlAktualisiert },
                        { label: "Bewegungen",  value: imp.anzahlBewegungen },
                      ].map(({ label, value }) => (
                        <div key={label} className="bg-[#f0f2f5] dark:bg-[#18191a] rounded-lg p-2 text-center">
                          <div className="text-lg font-black text-[#0064d2] dark:text-[#45bdff]">
                            {value.toLocaleString("de-DE")}
                          </div>
                          <div className="text-[11px] text-[#65676b] dark:text-[#b0b3b8]">{label}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Fehlertext */}
                  {imp.status === "fehler" && imp.fehlerText && (
                    <div className="mt-3 text-xs text-[#b3261e] dark:text-[#ff8a8a] bg-[#ffe0e0] dark:bg-[#3a1414] rounded-lg px-3 py-2 break-words">
                      {imp.fehlerText}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

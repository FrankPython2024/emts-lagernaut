"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { parsePickupCsv, type PickupImportResult } from "@/lib/pickup/csvImport";
import { formatLogId } from "@/lib/pickup/logId";

function heuteISO(): string {
  return new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function PickupNeuPage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfManage = has("PICKUP_MANAGE");

  const router = useRouter();
  const { show } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName]       = useState(`Pickup ${heuteISO()}`);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [result, setResult]   = useState<PickupImportResult | null>(null);

  const colliAnzahl = useMemo(() => {
    if (!result) return 0;
    return new Set(result.positionen.map((p) => p.colli ?? "—")).size;
  }, [result]);

  const erstellen = api.pickup.erstellen.useMutation({
    onSuccess: (r) => { show("✅ Pickup-Auftrag angelegt", "success"); router.push(`/admin/pickup/${r.id}`); },
    onError:   (e) => show(e.message, "error"),
  });

  if (permsLoading) {
    return <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">Lade Berechtigungen…</div>;
  }
  if (!darfManage) {
    return (
      <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">
        Kein Zugriff auf Pickup. Bitte das Recht <strong>PICKUP_MANAGE</strong> bei der Rolle aktivieren.
      </div>
    );
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) { show("Nur CSV-Dateien erlaubt.", "error"); return; }
    setFileName(file.name);
    setResult(null);
    setParsing(true);
    try {
      const r = await parsePickupCsv(file);
      setResult(r);
      if (r.total === 0) show("Keine gültigen Positionen (LogId) gefunden.", "warning");
    } catch {
      show("CSV konnte nicht gelesen werden.", "error");
    } finally {
      setParsing(false);
    }
  }

  function anlegen() {
    if (!result || result.total === 0 || !name.trim()) return;
    erstellen.mutate({
      name: name.trim(),
      positionen: result.positionen.map((p) => ({
        logId: p.logId, colli: p.colli, stellplatz: p.stellplatz, bezeichnung: p.bezeichnung,
      })),
    });
  }

  const vorschau = result?.positionen.slice(0, 20) ?? [];

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push("/admin/pickup")} className="text-[#65676b] hover:text-[#008BD2] text-sm">← Zurück</button>
        <h1 className="text-2xl font-black text-[#202F61] dark:text-[#e4e6eb]">Neuer Pickup-Auftrag</h1>
      </div>

      {/* Eingabe */}
      <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-5 space-y-4">
        <div>
          <label htmlFor="pickup-name" className="block text-sm font-bold text-[#202F61] dark:text-[#e4e6eb] mb-1">
            Name <span className="text-[#fa3e3e]">*</span>
          </label>
          <input
            id="pickup-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            className="w-full px-4 rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#202F61] dark:text-[#e4e6eb] text-sm outline-none focus:border-[#008BD2] focus:ring-2 focus:ring-[#008BD2]/30 transition-colors min-h-[56px]"
          />
        </div>

        <div>
          <label className="block text-sm font-bold text-[#202F61] dark:text-[#e4e6eb] mb-1">CSV-Datei (AfB-Geräte-Export)</label>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            className="hidden"
            aria-label="CSV-Datei auswählen"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 px-5 rounded-xl border-2 border-dashed border-[#008BD2]/40 bg-[#008BD2]/5 text-[#008BD2] dark:text-[#45bdff] text-sm font-bold hover:bg-[#008BD2]/10 transition-colors min-h-[56px]"
          >
            📄 {fileName ? `Datei: ${fileName} — andere wählen` : "CSV auswählen"}
          </button>
          <p className="text-xs text-[#90939a] dark:text-[#6b6e73] mt-1">
            Wird direkt im Browser gelesen. Erwartete Spalten: LogId, Colli, Stellplatz, Bezeichnung.
          </p>
        </div>

        {parsing && <div className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Lese CSV…</div>}

        {/* Vorschau */}
        {result && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="px-3 py-1.5 rounded-lg bg-[#04B475]/10 text-[#04B475] font-bold">{result.total} Positionen</span>
              <span className="px-3 py-1.5 rounded-lg bg-[#f0f2f5] dark:bg-[#18191a] text-[#65676b] dark:text-[#b0b3b8] font-semibold">{result.skipped} übersprungen (kein LogId)</span>
              <span className="px-3 py-1.5 rounded-lg bg-[#f0f2f5] dark:bg-[#18191a] text-[#65676b] dark:text-[#b0b3b8] font-semibold">{result.duplicates} Duplikate entfernt</span>
              <span className="px-3 py-1.5 rounded-lg bg-[#008BD2]/10 text-[#008BD2] dark:text-[#45bdff] font-bold">{colliAnzahl} Colli</span>
            </div>

            {vorschau.length > 0 && (
              <div className="border border-[#ced4da] dark:border-[#3e4042] rounded-xl overflow-hidden">
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-[#f0f2f5] dark:bg-[#18191a]">
                      <tr className="text-[#65676b] dark:text-[#b0b3b8] border-b border-[#ced4da] dark:border-[#3e4042]">
                        <th scope="col" className="text-left py-2 px-3">LogID</th>
                        <th scope="col" className="text-left py-2 px-3">Colli</th>
                        <th scope="col" className="text-left py-2 px-3">Stellplatz</th>
                        <th scope="col" className="text-left py-2 px-3">Bezeichnung</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vorschau.map((p, i) => (
                        <tr key={i} className="border-b border-[#f0f2f5] dark:border-[#3e4042]">
                          <td className="py-2 px-3 font-mono font-bold text-[#202F61] dark:text-[#e4e6eb]">{formatLogId(p.logId)}</td>
                          <td className="py-2 px-3 text-[#65676b] dark:text-[#b0b3b8]">{p.colli ?? "—"}</td>
                          <td className="py-2 px-3 text-[#65676b] dark:text-[#b0b3b8]">{p.stellplatz ?? "—"}</td>
                          <td className="py-2 px-3 text-[#65676b] dark:text-[#b0b3b8] truncate max-w-[260px]" title={p.bezeichnung ?? ""}>{p.bezeichnung ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {result.total > vorschau.length && (
                  <div className="px-3 py-2 text-xs text-center text-[#65676b] dark:text-[#b0b3b8] bg-[#f0f2f5] dark:bg-[#18191a]">
                    … und {result.total - vorschau.length} weitere
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={anlegen}
            disabled={!result || result.total === 0 || !name.trim() || erstellen.isPending}
            className="inline-flex items-center gap-2 px-6 rounded-xl bg-[#008BD2] text-white text-sm font-bold hover:bg-[#0077b5] disabled:opacity-40 transition-colors shadow-sm min-h-[56px]"
          >
            {erstellen.isPending ? "Lege an…" : "Auftrag anlegen"}
          </button>
        </div>
      </div>
    </div>
  );
}

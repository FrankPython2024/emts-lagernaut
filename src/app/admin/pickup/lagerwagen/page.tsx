"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { parseLagerwagenDatei, type LagerwagenImportResult } from "@/lib/lagerwagen/import";

function fmtDatum(d: Date | string): string {
  return new Date(d).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function LagerwagenPage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfManage = has("PICKUP_MANAGE");

  const router = useRouter();
  const { show } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing]   = useState(false);
  const [res, setRes]           = useState<LagerwagenImportResult | null>(null);

  const statusQ = api.lagerwagen.status.useQuery(undefined, { enabled: !permsLoading && darfManage });
  const utils   = api.useUtils();

  const importieren = api.lagerwagen.importieren.useMutation({
    onSuccess: (r) => {
      show(`✅ Import übernommen: ${r.wagen} Wagen · ${r.untercollis} Untercollis`, "success");
      setRes(null); setFileName(null);
      if (fileRef.current) fileRef.current.value = "";
      void utils.lagerwagen.status.invalidate();
    },
    onError: (e) => show(e.message, "error"),
  });

  if (permsLoading) {
    return <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">Lade Berechtigungen…</div>;
  }
  if (!darfManage) {
    return (
      <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">
        Kein Zugriff. Bitte das Recht <strong>PICKUP_MANAGE</strong> bei der Rolle aktivieren.
      </div>
    );
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".csv")) {
      show("Nur .xlsx- oder .csv-Dateien erlaubt.", "error");
      return;
    }
    setFileName(file.name);
    setRes(null);
    setParsing(true);
    try {
      const r = await parseLagerwagenDatei(file);
      setRes(r);
      if (r.untercollis === 0) show("Keine gültigen Zeilen (Nummer/Hauptcolli) gefunden.", "warning");
    } catch (e) {
      show(`Datei konnte nicht gelesen werden: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setParsing(false);
    }
  }

  const kannImportieren = !!res && res.untercollis > 0 && !importieren.isPending;

  function anlegen() {
    if (!kannImportieren || !res) return;
    importieren.mutate({ zeilen: res.zeilen });
  }

  const akzent = "#008BD2";

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push("/admin/pickup")} className="text-[#65676b] hover:text-[#008BD2] text-sm">← Zurück</button>
        <h1 className="text-2xl font-black text-[#202F61] dark:text-[#e4e6eb]">🛒 Lagerwagen-Zuordnung</h1>
      </div>

      <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
        ReForm-"Stellplatz"-Übersicht der mobilen Lagerwagen hochladen. Ordnet jedes Untercolli seinem
        Hauptcolli (vorderes Colli des Wagens) + Stellplatz zu. Grundlage für den Hauptcolli-Vorabscan im
        Pickup. Jeder Import <strong>ersetzt</strong> den kompletten Stand. Die Datei ist der vollständige
        aktuelle Stand. Reine Zuordnung, kein Bestandseffekt.
      </p>

      {/* Aktueller Stand */}
      <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-5">
        <h2 className="text-sm font-black uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8] mb-3">Aktueller Stand</h2>
        {statusQ.isLoading ? (
          <div className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Lädt…</div>
        ) : (statusQ.data?.untercollis ?? 0) === 0 ? (
          <div className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Noch keine Zuordnung importiert.</div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="px-3 py-1.5 rounded-lg bg-[#008BD2]/10 text-[#008BD2] dark:text-[#45bdff] font-bold">{statusQ.data!.wagen} Wagen</span>
            <span className="px-3 py-1.5 rounded-lg bg-[#04B475]/10 text-[#04B475] font-bold">{statusQ.data!.untercollis} Untercollis</span>
            {statusQ.data!.aktualisiertAm && (
              <span className="text-xs text-[#90939a] dark:text-[#6b6e73]">Stand: {fmtDatum(statusQ.data!.aktualisiertAm)}</span>
            )}
          </div>
        )}
      </div>

      {/* Upload + Vorschau */}
      <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-5 space-y-4">
        <div>
          <label className="block text-sm font-bold text-[#202F61] dark:text-[#e4e6eb] mb-1">Datei (.xlsx oder .csv)</label>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            className="hidden"
            aria-label="Datei auswählen"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 px-5 rounded-xl border-2 border-dashed text-sm font-bold transition-colors min-h-[56px]"
            style={{ borderColor: `${akzent}66`, background: `${akzent}0d`, color: akzent }}
          >
            📄 {fileName ? `Datei: ${fileName} (andere wählen)` : "Datei auswählen"}
          </button>
          <p className="text-xs text-[#90939a] dark:text-[#6b6e73] mt-1">
            Wird direkt im Browser gelesen. .xlsx: Tabellenblatt "Stellplatz". Spalten: Nummer, Hauptcolli, Stellplatz, Lagernummer.
          </p>
        </div>

        {parsing && <div className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Lese Datei…</div>}

        {res && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="px-3 py-1.5 rounded-lg bg-[#008BD2]/10 text-[#008BD2] dark:text-[#45bdff] font-bold">{res.wagen} Wagen</span>
              <span className="px-3 py-1.5 rounded-lg bg-[#04B475]/10 text-[#04B475] font-bold">{res.untercollis} Untercollis</span>
              <span className="px-3 py-1.5 rounded-lg bg-[#f0f2f5] dark:bg-[#18191a] text-[#65676b] dark:text-[#b0b3b8] font-semibold">{res.skipped} übersprungen (keine Nummer/Hauptcolli)</span>
              <span className="px-3 py-1.5 rounded-lg bg-[#f0f2f5] dark:bg-[#18191a] text-[#65676b] dark:text-[#b0b3b8] font-semibold">{res.duplicates} Duplikate entfernt</span>
            </div>

            {res.zeilen.length > 0 && (
              <div className="border border-[#ced4da] dark:border-[#3e4042] rounded-xl overflow-hidden">
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-[#f0f2f5] dark:bg-[#18191a]">
                      <tr className="text-[#65676b] dark:text-[#b0b3b8] border-b border-[#ced4da] dark:border-[#3e4042]">
                        <th scope="col" className="text-left py-2 px-3">Untercolli</th>
                        <th scope="col" className="text-left py-2 px-3">Hauptcolli</th>
                        <th scope="col" className="text-left py-2 px-3">Stellplatz</th>
                        <th scope="col" className="text-left py-2 px-3">Lagernummer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {res.zeilen.slice(0, 20).map((z) => (
                        <tr key={z.untercolli} className="border-b border-[#f0f2f5] dark:border-[#3e4042]">
                          <td className="py-2 px-3 font-mono font-bold text-[#202F61] dark:text-[#e4e6eb]">{z.untercolli}</td>
                          <td className="py-2 px-3 font-mono text-[#008BD2] dark:text-[#45bdff]">{z.hauptcolli}</td>
                          <td className="py-2 px-3 text-[#65676b] dark:text-[#b0b3b8]">{z.stellplatz ?? "—"}</td>
                          <td className="py-2 px-3 text-[#65676b] dark:text-[#b0b3b8]">{z.lagernummer ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {res.untercollis > 20 && (
                  <div className="px-3 py-2 text-xs text-center text-[#65676b] dark:text-[#b0b3b8] bg-[#f0f2f5] dark:bg-[#18191a]">… und {res.untercollis - 20} weitere</div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 pt-1 flex-wrap">
              <p className="text-xs text-[#BA7517]">
                ⚠️ Übernehmen ersetzt den kompletten bisherigen Stand
                {statusQ.data && statusQ.data.untercollis > 0 ? ` (${statusQ.data.untercollis} Untercollis)` : ""}.
              </p>
              <button
                type="button"
                onClick={anlegen}
                disabled={!kannImportieren}
                className="inline-flex items-center gap-2 px-6 rounded-xl text-white text-sm font-bold disabled:opacity-40 transition-colors shadow-sm min-h-[56px]"
                style={{ background: akzent }}
              >
                {importieren.isPending ? "Importiere…" : "Stand ersetzen & importieren"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

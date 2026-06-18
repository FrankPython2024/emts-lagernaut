"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/trpc/react";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/components/ui/Toast";
import { parseVerbrauchsmaterialDatei, type VMImportResult } from "@/lib/verbrauchsmaterial/import";

const AKZENT = "#008BD2";

export default function VerbrauchsmaterialImportPage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfVerwalten = has("MATERIAL_MANAGE");

  const router  = useRouter();
  const { show } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing]   = useState(false);
  const [res, setRes]           = useState<VMImportResult | null>(null);

  const importieren = api.verbrauchsmaterial.importBestand.useMutation({
    onSuccess: (r) => {
      show(`✅ Import übernommen — ${r.neu} neu, ${r.aktualisiert} aktualisiert, ${r.uebersprungen} übersprungen`, "success");
      setRes(null); setFileName(null);
      if (fileRef.current) fileRef.current.value = "";
    },
    onError: (e) => show(e.message, "error"),
  });

  if (permsLoading) {
    return <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">Lade Berechtigungen…</div>;
  }
  if (!darfVerwalten) {
    return (
      <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">
        Kein Zugriff. Bitte das Recht <strong>MATERIAL_MANAGE</strong> bei der Rolle aktivieren.
      </div>
    );
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) { show("Nur .xlsx-Dateien erlaubt.", "error"); return; }
    setFileName(file.name);
    setRes(null);
    setParsing(true);
    try {
      const r = await parseVerbrauchsmaterialDatei(file);
      setRes(r);
      if (r.total === 0) show("Keine Zeilen mit Artikelname gefunden.", "warning");
    } catch (e) {
      show(`Datei konnte nicht gelesen werden: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setParsing(false);
    }
  }

  const kannImportieren = !!res && res.total > 0 && !importieren.isPending;

  function anlegen() {
    if (!kannImportieren || !res) return;
    importieren.mutate({ zeilen: res.zeilen });
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push("/admin/verbrauchsmaterial")} className="text-[#65676b] hover:text-[#008BD2] text-sm">← Zurück</button>
        <h1 className="text-2xl font-black text-[#202F61] dark:text-[#e4e6eb]">📥 Verbrauchsmaterial — Excel-Import</h1>
      </div>

      <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
        Aktuelle Bestandsliste hochladen (.xlsx, Tabellenblatt <strong>"Lager"</strong>). Bestehende Artikel werden
        per <strong>Name</strong> erkannt und aktualisiert, neue Artikel werden angelegt (Code automatisch).
        Der Standort kommt nicht aus der Excel und bleibt unverändert. Reine Materialwirtschaft, kein Bestandseffekt
        im Geräte-/Teile-Lager.
      </p>

      <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-5 space-y-4">
        <div>
          <label className="block text-sm font-bold text-[#202F61] dark:text-[#e4e6eb] mb-1">Datei (.xlsx)</label>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            className="hidden"
            aria-label="Excel-Datei auswählen"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 px-5 rounded-xl border-2 border-dashed text-sm font-bold transition-colors min-h-[56px]"
            style={{ borderColor: `${AKZENT}66`, background: `${AKZENT}0d`, color: AKZENT }}
          >
            📄 {fileName ? `Datei: ${fileName} — andere wählen` : "Excel auswählen"}
          </button>
          <p className="text-xs text-[#90939a] dark:text-[#6b6e73] mt-1">
            Spalten (tolerant): Artikelname, Merkmale, Mindestbestand, „Aktueller Bestand", Kategorie, AAN, Stückzahl, Bemerkung.
            Header- und Leerzeilen werden übersprungen.
          </p>
        </div>

        {parsing && <div className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Lese Datei…</div>}

        {res && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="px-3 py-1.5 rounded-lg bg-[#008BD2]/10 text-[#008BD2] dark:text-[#45bdff] font-bold">{res.total} Zeilen erkannt</span>
              <span className="px-3 py-1.5 rounded-lg bg-[#f0f2f5] dark:bg-[#18191a] text-[#65676b] dark:text-[#b0b3b8] font-semibold">{res.skipped} übersprungen (kein Artikelname)</span>
            </div>

            {res.zeilen.length > 0 && (
              <div className="border border-[#ced4da] dark:border-[#3e4042] rounded-xl overflow-hidden">
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-[#f0f2f5] dark:bg-[#18191a]">
                      <tr className="text-[#65676b] dark:text-[#b0b3b8] border-b border-[#ced4da] dark:border-[#3e4042]">
                        <th scope="col" className="text-left py-2 px-3">Artikelname</th>
                        <th scope="col" className="text-left py-2 px-3">Kategorie</th>
                        <th scope="col" className="text-right py-2 px-3">Bestand</th>
                        <th scope="col" className="text-right py-2 px-3">Mindest</th>
                        <th scope="col" className="text-left py-2 px-3">AAN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {res.zeilen.slice(0, 25).map((z, i) => (
                        <tr key={i} className="border-b border-[#f0f2f5] dark:border-[#3e4042]">
                          <td className="py-2 px-3 font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">{z.name}</td>
                          <td className="py-2 px-3 text-[#65676b] dark:text-[#b0b3b8]">{z.kategorie ?? "—"}</td>
                          <td className="py-2 px-3 text-right tabular-nums text-[#1a1a1a] dark:text-[#e4e6eb]">{z.aktuellerBestand}</td>
                          <td className="py-2 px-3 text-right tabular-nums text-[#65676b] dark:text-[#b0b3b8]">{z.mindestbestand}</td>
                          <td className="py-2 px-3 text-[#65676b] dark:text-[#b0b3b8]">{z.aan ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {res.total > 25 && (
                  <div className="px-3 py-2 text-xs text-center text-[#65676b] dark:text-[#b0b3b8] bg-[#f0f2f5] dark:bg-[#18191a]">… und {res.total - 25} weitere</div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={anlegen}
                disabled={!kannImportieren}
                className="inline-flex items-center gap-2 px-6 rounded-xl text-white text-sm font-bold disabled:opacity-40 transition-colors shadow-sm min-h-[56px]"
                style={{ background: AKZENT }}
              >
                {importieren.isPending ? "Importiere…" : `${res.total} Zeilen importieren`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

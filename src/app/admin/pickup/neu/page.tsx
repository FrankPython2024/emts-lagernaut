"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { parsePickupCsv, type PickupImportResult } from "@/lib/pickup/csvImport";
import { parseColliPruefungCsv, type ColliPruefungResult, type ColliZeile } from "@/lib/pickup/colliPruefung";
import { formatLogId } from "@/lib/pickup/logId";

type Typ = "LOGID" | "COLLI";

function heuteISO(): string {
  return new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function defaultName(typ: Typ): string {
  return typ === "COLLI" ? `Stellplatz-Prüfung ${heuteISO()}` : `Pickup ${heuteISO()}`;
}
function istDefaultName(n: string): boolean {
  return n === `Pickup ${heuteISO()}` || n === `Stellplatz-Prüfung ${heuteISO()}`;
}

// Colli → bezeichnung: "Art · N Teile" (Anzeige im Scan / Nachweis).
function colliBezeichnung(c: ColliZeile): string | null {
  return [c.art, c.anzahlTeile ? `${c.anzahlTeile} Teile` : null].filter(Boolean).join(" · ") || null;
}

export default function PickupNeuPage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfManage = has("PICKUP_MANAGE");

  const router = useRouter();
  const { show } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [typ, setTyp]         = useState<Typ>("LOGID");
  const [name, setName]       = useState(defaultName("LOGID"));
  const [bemerkung, setBemerkung] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [logRes, setLogRes]   = useState<PickupImportResult | null>(null);
  const [colliRes, setColliRes] = useState<ColliPruefungResult | null>(null);

  const colliAnzahlLog = useMemo(() => {
    if (!logRes) return 0;
    return new Set(logRes.positionen.map((p) => p.colli ?? "—")).size;
  }, [logRes]);

  const erstellen = api.pickup.erstellen.useMutation({
    onSuccess: (r) => { show("✅ Pickup-Auftrag angelegt", "success"); router.push(`/admin/pickup/${r.id}`); },
    onError:   (e) => show(e.message, "error"),
  });

  function wechsleTyp(neu: Typ) {
    if (neu === typ) return;
    setTyp(neu);
    setLogRes(null); setColliRes(null); setFileName(null);
    if (fileRef.current) fileRef.current.value = "";
    setName((prev) => (istDefaultName(prev) ? defaultName(neu) : prev));
  }

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
    setLogRes(null); setColliRes(null);
    setParsing(true);
    try {
      if (typ === "COLLI") {
        const r = await parseColliPruefungCsv(file);
        setColliRes(r);
        if (r.total === 0) show("Keine gültigen Collis (Nummer) gefunden.", "warning");
      } else {
        const r = await parsePickupCsv(file);
        setLogRes(r);
        if (r.total === 0) show("Keine gültigen Positionen (LogId) gefunden.", "warning");
      }
    } catch {
      show("CSV konnte nicht gelesen werden.", "error");
    } finally {
      setParsing(false);
    }
  }

  const total = typ === "COLLI" ? (colliRes?.total ?? 0) : (logRes?.total ?? 0);
  const kannAnlegen = total > 0 && !!name.trim() && !erstellen.isPending;

  function anlegen() {
    if (!kannAnlegen) return;
    const positionen =
      typ === "COLLI"
        ? (colliRes?.stellplaetze ?? []).flatMap((sp) =>
            sp.collis.map((c) => ({
              logId:       c.nummerDigits,   // normalisierte Colli-Nummer → bestehender Matcher
              colli:       c.nummer,         // formatierte Nummer (Anzeige)
              stellplatz:  c.stellplatz,
              bezeichnung: colliBezeichnung(c),
            })),
          )
        : (logRes?.positionen ?? []).map((p) => ({
            logId: p.logId, colli: p.colli, stellplatz: p.stellplatz, bezeichnung: p.bezeichnung,
          }));
    erstellen.mutate({ name: name.trim(), typ, bemerkung: bemerkung.trim() || undefined, positionen });
  }

  const akzent = typ === "COLLI" ? "#7c3aed" : "#008BD2";

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push("/admin/pickup")} className="text-[#65676b] hover:text-[#008BD2] text-sm">← Zurück</button>
        <h1 className="text-2xl font-black text-[#202F61] dark:text-[#e4e6eb]">Neuer Pickup-Auftrag</h1>
      </div>

      <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-5 space-y-4">
        {/* Typ-Auswahl */}
        <div>
          <span className="block text-sm font-bold text-[#202F61] dark:text-[#e4e6eb] mb-1">Typ</span>
          <div role="group" aria-label="Auftragstyp" className="inline-flex rounded-xl overflow-hidden border border-[#ced4da] dark:border-[#3e4042]">
            <button
              type="button"
              aria-pressed={typ === "LOGID"}
              onClick={() => wechsleTyp("LOGID")}
              className={`px-5 text-sm font-bold transition-colors min-h-[48px] ${typ === "LOGID" ? "bg-[#008BD2] text-white" : "bg-white dark:bg-[#242526] text-[#65676b] dark:text-[#b0b3b8]"}`}
            >
              🏷️ LogID-Suche
            </button>
            <button
              type="button"
              aria-pressed={typ === "COLLI"}
              onClick={() => wechsleTyp("COLLI")}
              className={`px-5 text-sm font-bold border-l border-[#ced4da] dark:border-[#3e4042] transition-colors min-h-[48px] ${typ === "COLLI" ? "bg-[#7c3aed] text-white" : "bg-white dark:bg-[#242526] text-[#65676b] dark:text-[#b0b3b8]"}`}
            >
              🧭 Colli-Suche (Stellplatz)
            </button>
          </div>
          <p className="text-xs text-[#90939a] dark:text-[#6b6e73] mt-1">
            {typ === "COLLI"
              ? "Stellplatz-Export: prüft, ob die Collis am Stellplatz liegen. Gescannt wird die Colli-Nummer."
              : "Geräte-Export: gescannt werden die LogIDs der Geräte."}
          </p>
        </div>

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
          <label htmlFor="pickup-bemerkung" className="block text-sm font-bold text-[#202F61] dark:text-[#e4e6eb] mb-1">
            Bemerkung (optional)
          </label>
          <textarea
            id="pickup-bemerkung"
            value={bemerkung}
            onChange={(e) => setBemerkung(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={typ === "COLLI" ? "z.B. Inventur-Lauf / Standort" : "z.B. Verkäufer-Reservierungsnummer"}
            className="w-full px-4 py-3 rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#202F61] dark:text-[#e4e6eb] text-sm outline-none focus:border-[#008BD2] focus:ring-2 focus:ring-[#008BD2]/30 transition-colors resize-y min-h-[56px]"
          />
        </div>

        <div>
          <label className="block text-sm font-bold text-[#202F61] dark:text-[#e4e6eb] mb-1">
            {typ === "COLLI" ? "CSV-Datei (Stellplatz-Export)" : "CSV-Datei (AfB-Geräte-Export)"}
          </label>
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
            className="w-full flex items-center justify-center gap-2 px-5 rounded-xl border-2 border-dashed text-sm font-bold transition-colors min-h-[56px]"
            style={{ borderColor: `${akzent}66`, background: `${akzent}0d`, color: akzent }}
          >
            📄 {fileName ? `Datei: ${fileName} (andere wählen)` : "CSV auswählen"}
          </button>
          <p className="text-xs text-[#90939a] dark:text-[#6b6e73] mt-1">
            Wird direkt im Browser gelesen. {typ === "COLLI"
              ? "Spalten: Nummer, Art, Stellplatz, Anzahl Teile, Bearbeitungsstatus."
              : "Spalten: LogId, Colli, Stellplatz, Bezeichnung."}
          </p>
        </div>

        {parsing && <div className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Lese CSV…</div>}

        {/* Vorschau — LogID */}
        {typ === "LOGID" && logRes && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="px-3 py-1.5 rounded-lg bg-[#04B475]/10 text-[#04B475] font-bold">{logRes.total} Positionen</span>
              <span className="px-3 py-1.5 rounded-lg bg-[#f0f2f5] dark:bg-[#18191a] text-[#65676b] dark:text-[#b0b3b8] font-semibold">{logRes.skipped} übersprungen (kein LogId)</span>
              <span className="px-3 py-1.5 rounded-lg bg-[#f0f2f5] dark:bg-[#18191a] text-[#65676b] dark:text-[#b0b3b8] font-semibold">{logRes.duplicates} Duplikate entfernt</span>
              <span className="px-3 py-1.5 rounded-lg bg-[#008BD2]/10 text-[#008BD2] dark:text-[#45bdff] font-bold">{colliAnzahlLog} Colli</span>
            </div>
            {logRes.positionen.length > 0 && (
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
                      {logRes.positionen.slice(0, 20).map((p, i) => (
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
                {logRes.total > 20 && (
                  <div className="px-3 py-2 text-xs text-center text-[#65676b] dark:text-[#b0b3b8] bg-[#f0f2f5] dark:bg-[#18191a]">… und {logRes.total - 20} weitere</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Vorschau — Colli (je Stellplatz gruppiert) */}
        {typ === "COLLI" && colliRes && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="px-3 py-1.5 rounded-lg bg-[#04B475]/10 text-[#04B475] font-bold">{colliRes.total} Collis</span>
              <span className="px-3 py-1.5 rounded-lg bg-[#7c3aed]/10 text-[#7c3aed] dark:text-[#b794f6] font-bold">{colliRes.stellplaetze.length} Stellplatz/-plätze</span>
              <span className="px-3 py-1.5 rounded-lg bg-[#f0f2f5] dark:bg-[#18191a] text-[#65676b] dark:text-[#b0b3b8] font-semibold">{colliRes.skipped} übersprungen (keine Nummer)</span>
              <span className="px-3 py-1.5 rounded-lg bg-[#f0f2f5] dark:bg-[#18191a] text-[#65676b] dark:text-[#b0b3b8] font-semibold">{colliRes.duplicates} Duplikate entfernt</span>
            </div>
            <div className="space-y-3 max-h-[28rem] overflow-y-auto">
              {colliRes.stellplaetze.map((sp) => (
                <div key={sp.stellplatz} className="border border-[#ced4da] dark:border-[#3e4042] rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between gap-2 px-3 py-2 bg-[#7c3aed]/5 border-b border-[#ced4da] dark:border-[#3e4042]">
                    <span className="font-black text-xs text-[#7c3aed] dark:text-[#b794f6]">🧭 {sp.stellplatz}</span>
                    <span className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8]">{sp.collis.length} Collis</span>
                  </div>
                  <table className="w-full text-xs">
                    <tbody>
                      {sp.collis.slice(0, 15).map((c) => (
                        <tr key={c.nummerDigits || c.nummer} className="border-b border-[#f0f2f5] dark:border-[#3e4042]">
                          <td className="py-1.5 px-3 font-mono font-bold text-[#202F61] dark:text-[#e4e6eb]">{c.nummer}</td>
                          <td className="py-1.5 px-3 text-[#65676b] dark:text-[#b0b3b8]">{c.art ?? "—"}</td>
                          <td className="py-1.5 px-3 text-[#65676b] dark:text-[#b0b3b8]">{c.anzahlTeile ? `${c.anzahlTeile} Teile` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {sp.collis.length > 15 && (
                    <div className="px-3 py-1.5 text-xs text-center text-[#65676b] dark:text-[#b0b3b8] bg-[#f0f2f5] dark:bg-[#18191a]">… und {sp.collis.length - 15} weitere</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={anlegen}
            disabled={!kannAnlegen}
            className="inline-flex items-center gap-2 px-6 rounded-xl text-white text-sm font-bold disabled:opacity-40 transition-colors shadow-sm min-h-[56px]"
            style={{ background: akzent }}
          >
            {erstellen.isPending ? "Lege an…" : "Auftrag anlegen"}
          </button>
        </div>
      </div>
    </div>
  );
}

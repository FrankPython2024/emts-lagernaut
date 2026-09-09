"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { formatLogId } from "@/lib/pickup/logId";
import { parseTechnikCsv, type TechnikImportResult } from "@/lib/pickup/technikImport";
import {
  teileAuf, zaehleZustaende, leseGeneration,
  type GruppenSchluessel, type TechnikZeile,
} from "@/lib/pickup/technikGruppen";

// ── Abholung aus der Technik ─────────────────────────────────────────────────
//
// Der mobile Lagerwagen holt Geräte ab, die es nicht in den Verkauf geschafft
// haben. Der ReForm-Export wird eingelesen und in drei Abholaufträge zerlegt:
// Zustand H zuerst, danach der Rest nach Prozessorgeneration.
//
// Der Import läuft immer wieder mit einer frischen Datei. Deshalb wird vor dem
// Anlegen geprüft, welche Geräte schon auf einem offenen Auftrag stehen.

function heuteISO(): string {
  return new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const FARBE: Record<GruppenSchluessel, { rand: string; flaeche: string; text: string }> = {
  ZUSTAND_H: { rand: "#BA7517", flaeche: "rgba(186,117,23,0.08)", text: "#8A5A00" },
  GEN_ALT:   { rand: "#0064d2", flaeche: "rgba(0,100,210,0.06)",  text: "#0064d2" },
  GEN_NEU:   { rand: "#04B475", flaeche: "rgba(4,180,117,0.07)",  text: "#038F5C" },
};

export default function TechnikPickupPage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfManage = has("PICKUP_MANAGE");

  const router = useRouter();
  const { show } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName]   = useState<string | null>(null);
  const [parsing, setParsing]     = useState(false);
  const [res, setRes]             = useState<TechnikImportResult | null>(null);
  const [praefix, setPraefix]     = useState(`Technik ${heuteISO()}`);
  const [ueberspringen, setUeberspringen] = useState(true);
  const [laeuft, setLaeuft]       = useState(false);
  const [angelegt, setAngelegt]   = useState<{ id: number; name: string; anzahl: number }[] | null>(null);

  const aufteilung = useMemo(() => (res ? teileAuf(res.zeilen) : null), [res]);
  const zustaende  = useMemo(() => (res ? zaehleZustaende(res.zeilen) : []), [res]);

  // Welche LogIDs stehen schon auf einem offenen Auftrag?
  const alleLogIds = useMemo(() => res?.zeilen.map((z) => z.logId) ?? [], [res]);
  const offenQ = api.pickup.bereitsOffen.useQuery(
    { logIds: alleLogIds },
    { enabled: alleLogIds.length > 0 },
  );
  const schonEingeplant = useMemo(() => {
    const m = new Map<string, { auftrag: string; auftragId: number; schonGefunden: boolean }>();
    for (const t of offenQ.data?.treffer ?? []) m.set(t.logId, t);
    return m;
  }, [offenQ.data]);

  const erstellen = api.pickup.erstellen.useMutation();

  /** Zeilen einer Gruppe nach Abzug der schon eingeplanten Geräte. */
  function zuAnlegen(zeilen: TechnikZeile[]): TechnikZeile[] {
    return ueberspringen ? zeilen.filter((z) => !schonEingeplant.has(z.logId)) : zeilen;
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
    setRes(null); setAngelegt(null);
    setParsing(true);
    try {
      const r = await parseTechnikCsv(file);
      if (r.fehlendeSpalten.length > 0) {
        show(`Spalte fehlt: ${r.fehlendeSpalten.join(", ")}. Ist das der richtige Export?`, "error");
        setRes(null);
        return;
      }
      setRes(r);
      if (r.total === 0) show("Keine Zeile mit LogID gefunden.", "warning");
    } catch {
      show("Datei konnte nicht gelesen werden.", "error");
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function auftraegeAnlegen() {
    if (!aufteilung) return;
    setLaeuft(true);
    const ergebnis: { id: number; name: string; anzahl: number }[] = [];
    try {
      for (const g of aufteilung.gruppen) {
        const zeilen = zuAnlegen(g.zeilen);
        // Leere Gruppe = kein Auftrag. Ein Abholauftrag ohne Position wäre nur
        // eine Karteileiche in der Liste.
        if (zeilen.length === 0) continue;
        const name = `${praefix.trim()} · ${g.titel}`;
        const r = await erstellen.mutateAsync({
          name:      name.slice(0, 200),
          typ:       "LOGID",
          bemerkung: `Automatisch aus dem Technik-Export erzeugt (${fileName ?? "CSV"}). Regel: ${g.erklaerung}.`,
          positionen: zeilen.map((z) => ({
            logId:       z.logId,
            colli:       z.colli,
            stellplatz:  z.stellplatz,
            bezeichnung: z.bezeichnung,
          })),
        });
        ergebnis.push({ id: r.id, name, anzahl: zeilen.length });
      }
      if (ergebnis.length === 0) {
        show("Nichts anzulegen — alle Geräte stehen schon auf offenen Aufträgen.", "warning");
      } else {
        show(`✅ ${ergebnis.length} Auftrag${ergebnis.length === 1 ? "" : "e"} angelegt`, "success");
        setAngelegt(ergebnis);
      }
    } catch (e) {
      show(e instanceof Error ? e.message : "Anlegen fehlgeschlagen", "error");
    } finally {
      setLaeuft(false);
    }
  }

  const gesamtAnzulegen = aufteilung
    ? aufteilung.gruppen.reduce((s, g) => s + zuAnlegen(g.zeilen).length, 0)
    : 0;

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">🛒 Abholung aus der Technik</h1>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
            Export einlesen und daraus drei Abholaufträge für den Lagerwagen erzeugen.
          </p>
        </div>
        <Link href="/admin/pickup" className="text-sm font-bold text-[#0064d2] dark:text-[#45bdff] hover:underline min-h-[44px] flex items-center">
          → Alle Pickup-Aufträge
        </Link>
      </div>

      {/* ── Regel, damit nachvollziehbar bleibt, was gleich passiert ────── */}
      <div className="rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] p-4 text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
        <div className="font-bold mb-1">So wird aufgeteilt</div>
        <ol className="list-decimal ml-5 space-y-0.5 text-[#65676b] dark:text-[#b0b3b8]">
          <li><b className="text-[#8A5A00] dark:text-[#f7b928]">Zustand H</b> — kommt zuerst, unabhängig vom Prozessor.</li>
          <li><b className="text-[#0064d2] dark:text-[#45bdff]">Generation bis 9</b> — von den übrigen Geräten.</li>
          <li><b className="text-[#037A4F] dark:text-[#04B475]">Generation ab 10</b> — der Rest.</li>
        </ol>
        <p className="mt-2 text-xs text-[#65676b] dark:text-[#b0b3b8]">
          Jedes Gerät steht auf genau einer Liste. Ein Gerät kann nur einmal abgeholt werden.
        </p>
      </div>

      {/* ── Datei wählen ───────────────────────────────────────────────── */}
      <div className="rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] p-5 space-y-3">
        <label className="block">
          <span className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Export-Datei (CSV)</span>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-[#65676b] dark:text-[#b0b3b8] file:mr-3 file:px-4 file:py-3 file:rounded-lg file:border-0 file:bg-[#0064d2] file:text-white file:font-bold file:text-sm file:cursor-pointer"
          />
        </label>
        {fileName && (
          <p className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
            {parsing ? "Wird gelesen…" : `Gelesen: ${fileName}`}
          </p>
        )}
      </div>

      {res && aufteilung && (
        <>
          {/* ── Was steckt in der Datei ─────────────────────────────────── */}
          <div className="rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] p-5 space-y-3">
            <div className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
              {res.total} Gerät{res.total === 1 ? "" : "e"} in der Datei
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {zustaende.map((z) => (
                <span key={z.wert} className="px-2.5 py-1 rounded-full bg-[#f0f2f5] dark:bg-[#18191a] text-[#65676b] dark:text-[#b0b3b8] font-semibold">
                  Zustand {z.wert}: <b className="text-[#1a1a1a] dark:text-[#e4e6eb]">{z.anzahl}</b>
                </span>
              ))}
            </div>
            {(res.skipped > 0 || res.duplicates > 0) && (
              <p className="text-xs text-[#8A5A00] dark:text-[#f7b928]">
                {res.skipped > 0 && <>{res.skipped} Zeile(n) ohne LogID übersprungen. </>}
                {res.duplicates > 0 && <>{res.duplicates} doppelte LogID(s) entfernt.</>}
              </p>
            )}
          </div>

          {/* ── Nicht zuzuordnen ────────────────────────────────────────── */}
          {aufteilung.ohneZuordnung.length > 0 && (
            <div className="rounded-xl border-2 border-[#fa3e3e] bg-[#fa3e3e]/6 p-5">
              <div className="font-black text-[#b3261e] dark:text-[#ff8a8a]">
                ⚠ {aufteilung.ohneZuordnung.length} Gerät(e) ohne Prozessorgeneration
              </div>
              <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
                Diese Geräte sind nicht „H" und haben keine lesbare Generationsangabe.
                Sie kommen auf <b>keinen</b> Auftrag — sonst landeten sie auf einer Liste,
                auf die sie vielleicht nicht gehören. Bitte in ReForm nachtragen und neu einlesen.
              </p>
              <ul className="mt-2 text-sm font-mono text-[#b3261e] dark:text-[#ff8a8a] space-y-0.5">
                {aufteilung.ohneZuordnung.slice(0, 20).map((z) => (
                  <li key={z.logId}>{formatLogId(z.logId)} · Zustand {z.zustand ?? "—"}</li>
                ))}
                {aufteilung.ohneZuordnung.length > 20 && <li>… und {aufteilung.ohneZuordnung.length - 20} weitere</li>}
              </ul>
            </div>
          )}

          {/* ── Schon eingeplant ────────────────────────────────────────── */}
          {schonEingeplant.size > 0 && (
            <div className="rounded-xl border-2 border-[#f7b928] bg-[#f7b928]/8 p-5 space-y-2">
              <div className="font-black text-[#8A5A00] dark:text-[#f7b928]">
                {schonEingeplant.size} Gerät(e) stehen schon auf einem offenen Auftrag
              </div>
              <label className="flex items-start gap-3 cursor-pointer min-h-[44px]">
                <input
                  type="checkbox"
                  checked={ueberspringen}
                  onChange={(e) => setUeberspringen(e.target.checked)}
                  className="mt-1 w-5 h-5 accent-[#0064d2] shrink-0"
                />
                <span className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
                  Diese Geräte überspringen
                  <span className="block text-xs text-[#65676b] dark:text-[#b0b3b8]">
                    Sonst steht dasselbe Gerät auf zwei Abhollisten und jemand läuft umsonst.
                  </span>
                </span>
              </label>
              <ul className="text-xs text-[#65676b] dark:text-[#b0b3b8] space-y-0.5 max-h-32 overflow-y-auto">
                {[...schonEingeplant.entries()].slice(0, 15).map(([logId, t]) => (
                  <li key={logId}>
                    <span className="font-mono">{formatLogId(logId)}</span> — {t.auftrag}
                    {t.schonGefunden && <b className="text-[#037A4F] dark:text-[#04B475]"> · liegt schon auf dem Wagen</b>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Die drei Aufträge ───────────────────────────────────────── */}
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            {aufteilung.gruppen.map((g) => {
              const f = FARBE[g.key];
              const anzulegen = zuAnlegen(g.zeilen);
              const abgezogen = g.zeilen.length - anzulegen.length;
              return (
                <div key={g.key} className="rounded-xl border-2 p-4" style={{ borderColor: f.rand, background: f.flaeche }}>
                  <div className="font-black text-base" style={{ color: f.text }}>{g.titel}</div>
                  <div className="text-3xl font-black tabular-nums mt-1 text-[#1a1a1a] dark:text-[#e4e6eb]">
                    {anzulegen.length}
                  </div>
                  <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
                    {abgezogen > 0
                      ? <>von {g.zeilen.length} · {abgezogen} übersprungen</>
                      : <>Geräte</>}
                  </div>
                  <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-2">{g.erklaerung}</p>
                  {anzulegen.length > 0 && (
                    <ul className="mt-2 text-xs font-mono text-[#65676b] dark:text-[#b0b3b8] space-y-0.5 max-h-28 overflow-y-auto">
                      {anzulegen.slice(0, 8).map((z) => (
                        <li key={z.logId}>
                          {formatLogId(z.logId)}
                          <span className="ml-1 opacity-70">
                            Gen {leseGeneration(z.generation) ?? "—"} · {z.zustand ?? "—"}
                          </span>
                        </li>
                      ))}
                      {anzulegen.length > 8 && <li className="opacity-70">… und {anzulegen.length - 8} weitere</li>}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Anlegen ─────────────────────────────────────────────────── */}
          {!angelegt && (
            <div className="rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] p-5 space-y-3">
              <label className="block">
                <span className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Name der Aufträge</span>
                <input
                  value={praefix}
                  onChange={(e) => setPraefix(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border-2 border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] min-h-[56px]"
                />
                <span className="block text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1">
                  Wird je Auftrag ergänzt, z. B. „{praefix.trim() || "Technik"} · Zustand H".
                </span>
              </label>
              <button
                onClick={() => void auftraegeAnlegen()}
                disabled={laeuft || gesamtAnzulegen === 0 || praefix.trim().length < 2}
                className="px-6 py-3 rounded-xl bg-[#037A4F] text-white font-bold text-base min-h-[56px] disabled:opacity-50"
              >
                {laeuft ? "Wird angelegt…" : `${gesamtAnzulegen} Gerät(e) auf Aufträge verteilen`}
              </button>
              {gesamtAnzulegen === 0 && (
                <p className="text-sm text-[#8A5A00] dark:text-[#f7b928]">
                  Nichts anzulegen — alle Geräte stehen schon auf offenen Aufträgen.
                </p>
              )}
            </div>
          )}

          {/* ── Ergebnis ────────────────────────────────────────────────── */}
          {angelegt && (
            <div className="rounded-xl border-2 border-[#04B475] bg-[#04B475]/8 p-5 space-y-2">
              <div className="font-black text-[#037A4F] dark:text-[#04B475]">✅ Aufträge angelegt</div>
              <ul className="space-y-1">
                {angelegt.map((a) => (
                  <li key={a.id}>
                    <Link href={`/admin/pickup/${a.id}`} className="text-[#0064d2] dark:text-[#45bdff] font-bold hover:underline">
                      {a.name}
                    </Link>
                    <span className="text-sm text-[#65676b] dark:text-[#b0b3b8]"> · {a.anzahl} Gerät(e)</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => { setRes(null); setFileName(null); setAngelegt(null); }}
                className="mt-2 px-5 py-3 rounded-xl border-2 border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-bold min-h-[56px]"
              >
                Nächste Datei einlesen
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

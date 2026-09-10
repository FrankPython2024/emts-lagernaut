"use client";

import { useRef, useState } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { PageHeader } from "@/components/ui/PageHeader";

// ── Teilespender — Import des ReForm-Verwertungs-Exports ─────────────────────
//
// Voll-Snapshot: Was in der Datei fehlt, hat das Verwertungslager verlassen und
// verschwindet aus der Teilesuche. Kein Bestandseffekt.

const STATUS: Record<string, { label: string; cls: string }> = {
  laeuft: { label: "läuft", cls: "bg-[#fff4d6] text-[#a06a00] dark:bg-[#3a2f10] dark:text-[#f7b928]" },
  fertig: { label: "fertig", cls: "bg-[#d9f7e6] text-[#00723f] dark:bg-[#10301f] dark:text-[#04B475]" },
  fehler: { label: "Fehler", cls: "bg-[#ffe0e0] text-[#b3261e] dark:bg-[#3a1414] dark:text-[#ff8a8a]" },
};

const karte =
  "bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-4";

export default function TeilespenderImportPage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfImportieren = has("TEILESPENDER_IMPORT");
  const { show } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [laedt, setLaedt] = useState(false);

  const importeQ = api.teilespender.importe.useQuery(
    { limit: 10 },
    {
      enabled: darfImportieren,
      refetchInterval: (q) => ((q.state.data ?? []).some((i) => i.status === "laeuft") ? 2_000 : false),
    },
  );

  async function hochladen(file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      show("Nur CSV-Dateien erlaubt.", "error");
      return;
    }
    setLaedt(true);
    try {
      const res = await fetch(`/api/teilespender/upload?name=${encodeURIComponent(file.name)}`, {
        method: "POST",
        body: file,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Fehler ${res.status}`);
      }
      show("Upload gestartet. Der Import läuft im Hintergrund.", "success");
      await importeQ.refetch();
    } catch (e) {
      show(`Upload fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setLaedt(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (permsLoading) return <div className="p-6 text-[#65676b]">Lädt…</div>;
  if (!darfImportieren) {
    return (
      <div className="p-6">
        <div className="bg-[#fff3cd] dark:bg-[#3d3016] border border-[#ffe69c] dark:border-[#665012] rounded-xl p-4 text-[#664d03] dark:text-[#ffda6a]">
          Für den Import fehlt das Recht <strong>TEILESPENDER_IMPORT</strong>.
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
      <PageHeader
        title="Teilespender — Import"
        subtitle="ReForm-Verwertungs-Export einlesen"
        breadcrumb={[
          { label: "Verwaltung", href: "/admin" },
          { label: "Teilespender", href: "/admin/teilespender" },
          { label: "Import" },
        ]}
      />

      <div className={karte}>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mb-3">
          Gebraucht wird der ReForm-Export der Geräte, die es nicht in den Verkauf geschafft haben —
          erkennbar an den Spalten <strong>Defekte</strong> und{" "}
          <strong>Refurbishment nicht möglich</strong>. Der reguläre Lagerfuchs-Export gehört auf die
          Seite Geräte-Reise; er wird hier abgelehnt.
        </p>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mb-4">
          Der Import ist ein <strong>Voll-Snapshot</strong>: Geräte, die nicht mehr in der Datei
          stehen, gelten als abgegangen und verschwinden aus der Teilesuche. Auf den Bestand wirkt
          sich nichts aus.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          disabled={laedt}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void hochladen(f);
          }}
          className="block w-full text-sm min-h-[48px] file:mr-3 file:px-4 file:py-2.5 file:rounded-lg file:border-0 file:bg-[#202F61] file:text-white file:font-semibold"
        />
        {laedt && <p className="mt-2 text-sm text-[#65676b]">Lädt hoch…</p>}
      </div>

      <div>
        <h2 className="text-lg font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-3">Letzte Importe</h2>
        <div className="space-y-2">
          {(importeQ.data ?? []).length === 0 && (
            <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Noch kein Import gelaufen.</p>
          )}
          {(importeQ.data ?? []).map((i) => {
            const s = STATUS[i.status] ?? STATUS.laeuft!;
            return (
              <div key={i.id} className={karte}>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className={`text-xs px-2 py-0.5 rounded font-semibold ${s.cls}`}>{s.label}</span>
                  <span className="font-semibold text-[#1a1a1a] dark:text-[#e4e6eb] truncate">
                    {i.dateiname}
                  </span>
                  <span className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
                    {new Date(i.importiertAm).toLocaleString("de-DE")}
                  </span>
                </div>
                <div className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
                  {i.anzahlZeilen.toLocaleString("de-DE")} Zeilen · {i.anzahlNeu} neu ·{" "}
                  {i.anzahlAktualisiert} geändert · {i.anzahlAusgeschieden} abgegangen
                </div>
                {i.fehlerText && (
                  <p className="mt-2 text-sm text-[#b3261e] dark:text-[#ff8a8a]">{i.fehlerText}</p>
                )}
                {/* Unbekannte Defekt-Begriffe gehören sichtbar gemacht: ReForm kann
                    die Auswahlliste erweitern, und ein neuer Begriff, den unsere
                    Zuordnung nicht kennt, würde ein Gerät als Spender ausweisen,
                    obwohl genau das gesuchte Teil hin ist. */}
                {i.unbekannteBegriffe && (
                  <details className="mt-2">
                    <summary className="text-sm text-[#a06a00] dark:text-[#f7b928] cursor-pointer font-semibold">
                      ⚠ Unbekannte Defekt-Begriffe — bitte melden
                    </summary>
                    <ul className="mt-1 text-sm text-[#65676b] dark:text-[#b0b3b8] list-disc pl-5">
                      {i.unbekannteBegriffe.split("\n").map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                    <p className="mt-1 text-xs text-[#65676b] dark:text-[#b0b3b8]">
                      Diese Begriffe ordnen aktuell kein Teil zu. Bis sie eingetragen sind, gelten
                      betroffene Geräte für das jeweilige Teil als unauffällig.
                    </p>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

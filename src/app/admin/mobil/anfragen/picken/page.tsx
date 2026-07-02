"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/trpc/react";
import { usePermissions } from "@/hooks/usePermissions";
import { useScannerMode } from "@/lib/pickup/useScannerMode";
import { playScanErfolg, playScanNichtBenoetigt, playNegativeSound } from "@/lib/pickup/scanSound";

// Handheld-Pick-Liste für Mobil-Anfragen: offene Anfragen live, per Scan der Teil-LogID
// abhaken — PRO STÜCK (Menge>1 = mehrere Scans), die gescannten LogIDs werden erfasst.
// Ausbuchen (Umbuchen) passiert am PC in der Anfragen-Liste über die erfassten LogIDs.

type Bereich = "ALLE" | "STANDARD" | "DIGITAL_EDUCATION";
const BEREICH_TABS: { key: Bereich; label: string }[] = [
  { key: "ALLE",             label: "Alle" },
  { key: "STANDARD",         label: "Standard" },
  { key: "DIGITAL_EDUCATION", label: "digital Education" },
];
const bezLabel = (b: string) => (b === "DIGITAL_EDUCATION" ? "digital Education" : "Standard");

type Feedback = { kind: "ok" | "warn" | "error"; text: string };

export default function MobilPickListePage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfSehen  = has("MOBIL_VIEW");
  const darfPicken = has("MOBIL_MANAGE");

  const utils = api.useUtils();
  const { onInputKeyDown } = useScannerMode();

  const [bereich, setBereich]   = useState<Bereich>("ALLE");
  const [eingabe, setEingabe]   = useState("");
  const [busy, setBusy]         = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const listeQ = api.mobilAnfrage.pickliste.useQuery(
    { bereich },
    { enabled: darfSehen, refetchInterval: 8_000 },
  );

  const pickScan  = api.mobilAnfrage.pickScan.useMutation();
  const entfernen = api.mobilAnfrage.pickEntfernen.useMutation({
    onSuccess: () => void utils.mobilAnfrage.pickliste.invalidate(),
  });
  const setGef = api.mobilAnfrage.setGefunden.useMutation({
    onSuccess: () => void utils.mobilAnfrage.pickliste.invalidate(),
  });

  useEffect(() => { if (darfPicken) scanRef.current?.focus(); }, [darfPicken]);

  async function scan(logId: string) {
    const c = logId.trim();
    if (!c || busy) return;
    setBusy(true);
    try {
      const res = await pickScan.mutateAsync({ logId: c, bereich });
      if (res.status === "gefunden") {
        const a = res.anfrage;
        setFeedback({ kind: "ok", text: `✓ ${a.modell} · ${a.teiltyp} (${a.gefunden}/${a.menge})${a.komplett ? " — komplett" : ""}` });
        playScanErfolg();
        void utils.mobilAnfrage.pickliste.invalidate();
      } else if (res.status === "schonErfasst") {
        setFeedback({ kind: "warn", text: `LogID „${c}" ist bereits erfasst` });
        playScanNichtBenoetigt();
      } else if (res.status === "keinBedarf") {
        setFeedback({ kind: "warn", text: `Kein offener Bedarf für „${res.teiltyp}" in diesem Bereich` });
        playScanNichtBenoetigt();
      } else if (res.status === "andererBereich") {
        setFeedback({ kind: "warn", text: `Teil gehört zu Bereich „${bezLabel(res.bereich)}" — dort picken` });
        playScanNichtBenoetigt();
      } else {
        setFeedback({ kind: "error", text: `LogID „${c}" unbekannt oder nicht mehr auf Lager` });
        playNegativeSound();
      }
    } catch {
      setFeedback({ kind: "error", text: "Fehler beim Scannen — nochmal versuchen" });
      playNegativeSound();
    } finally {
      setEingabe("");
      setBusy(false);
      setTimeout(() => scanRef.current?.focus(), 40);
    }
  }

  if (permsLoading) {
    return <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Lade Berechtigungen…</div>;
  }
  if (!darfSehen) {
    return <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Kein Zugriff (MOBIL_VIEW erforderlich).</div>;
  }

  const d = listeQ.data;
  const fbColor =
    feedback?.kind === "ok"   ? { bg: "#dcfce7", fg: "#15803d" } :
    feedback?.kind === "warn" ? { bg: "#fef3c7", fg: "#92400e" } :
                                { bg: "#fee2e2", fg: "#b91c1c" };

  return (
    <div className="max-w-2xl mx-auto pb-24">
      <header className="mb-3 flex items-center gap-3 flex-wrap">
        <Link href="/admin/mobil/anfragen" className="text-sm font-semibold text-[#65676b] hover:text-[#008BD2] dark:text-[#b0b3b8]">← Anfragen</Link>
        <h1 className="text-2xl font-black text-[#202F61] dark:text-[#e4e6eb]">📲 Pick-Liste</h1>
        {d && <span className="rounded-full bg-[#04B475] text-white text-sm font-bold px-3 py-1 tabular-nums">{d.komplett} / {d.gesamt} fertig</span>}
      </header>

      {/* Bereich-Reiter */}
      <div className="mb-3 flex flex-wrap gap-1 rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-1 w-fit">
        {BEREICH_TABS.map((t) => {
          const aktiv = bereich === t.key;
          return (
            <button key={t.key} type="button" onClick={() => setBereich(t.key)}
              className={`px-4 min-h-[44px] rounded-lg text-sm font-bold transition-colors ${aktiv ? "text-white" : "text-[#202F61] dark:text-[#e4e6eb] hover:bg-[#f0f2f5] dark:hover:bg-[#3a3b3c]"}`}
              style={aktiv ? { background: "#008BD2" } : undefined}>
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Scan-Feld (sticky, groß) */}
      {darfPicken && (
        <div className="sticky top-0 z-10 bg-[#f0f2f5] dark:bg-[#18191a] pt-1 pb-2">
          <input
            ref={scanRef}
            value={eingabe}
            onChange={(e) => setEingabe(e.target.value)}
            onKeyDown={(e) => { onInputKeyDown(e); if (e.key === "Enter") { e.preventDefault(); void scan(eingabe); } }}
            inputMode="numeric"
            autoFocus
            placeholder="LogID scannen oder eintippen…"
            className="w-full min-h-[60px] rounded-xl border-2 border-[#008BD2] bg-white dark:bg-[#242526] px-4 text-lg font-semibold text-[#202F61] dark:text-[#e4e6eb] outline-none"
          />
          {feedback && (
            <div className="mt-2 rounded-xl px-4 py-3 text-base font-bold" style={{ background: fbColor.bg, color: fbColor.fg }}>
              {feedback.text}
            </div>
          )}
        </div>
      )}

      {/* Liste */}
      {listeQ.isLoading ? (
        <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Lade…</div>
      ) : !d || d.zeilen.length === 0 ? (
        <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Keine offenen Anfragen. 🎉</div>
      ) : (
        <ul className="space-y-2 mt-1">
          {d.zeilen.map((z) => (
            <li key={z.id} className={`rounded-2xl border px-3 py-3 ${
              z.komplett ? "border-[#04B475]/40 bg-[#04B475]/10" : "border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526]"
            }`}>
              <div className="flex items-center gap-3">
                {/* Manuell komplett abhaken (Tap-Fallback ohne Scan) */}
                <button
                  type="button"
                  disabled={!darfPicken || setGef.isPending}
                  onClick={() => setGef.mutate({ id: z.id, gefunden: !z.manuell })}
                  aria-label="Manuell als komplett markieren"
                  className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-lg font-black ${
                    z.komplett ? "bg-[#04B475] text-white" : "border-2 border-[#ced4da] dark:border-[#3e4042] text-transparent"
                  }`}
                >✓</button>
                <div className="flex-1 min-w-0">
                  <div className={`text-lg font-bold ${z.komplett ? "text-[#65676b] dark:text-[#b0b3b8]" : "text-[#202F61] dark:text-[#e4e6eb]"}`}>
                    {z.modell} <span className="font-medium text-[#65676b] dark:text-[#b0b3b8]">· {z.teiltyp}</span>
                  </div>
                  <div className="text-sm text-[#90939a]">
                    {bezLabel(z.bereich)} · {z.techniker}{z.kommentar ? ` · ${z.kommentar}` : ""}
                  </div>
                </div>
                <span className={`flex-shrink-0 text-xl font-black tabular-nums ${z.gefundenAnzahl >= z.menge ? "text-[#04B475]" : "text-[#202F61] dark:text-[#e4e6eb]"}`}>
                  {z.gefundenAnzahl}/{z.menge}
                </span>
              </div>

              {/* Erfasste LogIDs (antippen = entfernen) */}
              {z.logIds.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5 pl-12">
                  {z.logIds.map((lid) => (
                    <button
                      key={lid}
                      type="button"
                      disabled={!darfPicken || entfernen.isPending}
                      onClick={() => entfernen.mutate({ anfrageId: z.id, logId: lid })}
                      title="Antippen zum Entfernen (Fehlscan)"
                      className="inline-flex items-center gap-1 rounded-md border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#3a3b3c] px-2 py-1 text-xs font-mono text-[#202F61] dark:text-[#e4e6eb]"
                    >
                      {lid} <span className="text-[#b91c1c] font-black">✕</span>
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {!darfPicken && (
        <p className="mt-4 text-sm text-[#90939a]">Nur-Lese-Zugriff — zum Scannen/Abhaken fehlt das Recht „Mobil verwalten" (MOBIL_MANAGE).</p>
      )}
    </div>
  );
}

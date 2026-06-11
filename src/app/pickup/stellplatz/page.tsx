"use client";

// STELLPLATZ-PRÜFUNG (Colli-Suche) — prüft, ob ein Stellplatz physisch die
// Collis enthält, die laut System dort liegen sollen. REINE Browser-Session:
// kein DB, keine Buchung, kein Bestandseffekt. Gating wie der restliche
// Pickup-Bereich (PICKUP_PICK).

import { useEffect, useMemo, useRef, useState } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import {
  parseColliPruefungCsv, colliKey, normalizeColliNummer,
  type ColliPruefungResult, type ColliZeile,
} from "@/lib/pickup/colliPruefung";
import { playScanSound } from "@/lib/pickup/scanSound";
import { useScannerMode } from "@/lib/pickup/useScannerMode";
import { ModusBanner, GeraeteUmschalter } from "@/components/pickup/ModusBanner";

type ScanHinweis = { kind: "treffer" | "schon" | "fremd"; text: string } | null;

export default function StellplatzPruefungPage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfPick = has("PICKUP_PICK");

  const fileRef  = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { mode, setMode, onInputKeyDown } = useScannerMode();

  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing]   = useState(false);
  const [result, setResult]     = useState<ColliPruefungResult | null>(null);
  const [gefunden, setGefunden] = useState<Set<string>>(new Set());
  const [eingabe, setEingabe]   = useState("");
  const [hinweis, setHinweis]   = useState<ScanHinweis>(null);

  // Lookup: roh (lowercased) UND Ziffern → Colli. So passen Scanner mit/ohne Punkte.
  const lookup = useMemo(() => {
    const map = new Map<string, ColliZeile>();
    for (const sp of result?.stellplaetze ?? []) {
      for (const c of sp.collis) {
        if (c.nummerDigits) map.set(c.nummerDigits, c);
        map.set(c.nummer.trim().toLowerCase(), c);
      }
    }
    return map;
  }, [result]);

  const total       = result?.total ?? 0;
  const gefundenAnz = gefunden.size;
  const fehlendAnz  = Math.max(0, total - gefundenAnz);

  // Handscanner: Fokus im Feld halten. Nach jedem Scan-Hinweis zurückfokussieren.
  useEffect(() => { if (result && mode === "handscanner") inputRef.current?.focus(); }, [result, mode, hinweis]);

  async function handleFile(file: File | null) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) { setHinweis({ kind: "fremd", text: "Nur CSV-Dateien erlaubt." }); return; }
    setFileName(file.name);
    setResult(null);
    setGefunden(new Set());
    setHinweis(null);
    setParsing(true);
    try {
      const r = await parseColliPruefungCsv(file);
      setResult(r);
    } catch {
      setHinweis({ kind: "fremd", text: "CSV konnte nicht gelesen werden." });
    } finally {
      setParsing(false);
    }
  }

  function handleScan() {
    const v = eingabe.trim();
    setEingabe("");
    if (!v) return;
    // tolerant: erst Ziffern, dann roh (lowercased)
    const treffer = lookup.get(normalizeColliNummer(v)) ?? lookup.get(v.toLowerCase());
    if (!treffer) {
      setHinweis({ kind: "fremd", text: `„${v}" ist nicht in dieser Liste.` });
      return;
    }
    const key = colliKey(treffer);
    if (gefunden.has(key)) {
      setHinweis({ kind: "schon", text: `Colli ${treffer.nummer} war bereits gefunden.` });
      playScanSound("SCHON");
      return;
    }
    setGefunden((prev) => { const next = new Set(prev); next.add(key); return next; });
    setHinweis({ kind: "treffer", text: `Colli ${treffer.nummer} gefunden.` });
    playScanSound("GEFUNDEN");
  }

  // ── Report / Export ─────────────────────────────────────────────────────────
  const fehlende: ColliZeile[] = useMemo(() => {
    const out: ColliZeile[] = [];
    for (const sp of result?.stellplaetze ?? []) {
      for (const c of sp.collis) if (!gefunden.has(colliKey(c))) out.push(c);
    }
    return out;
  }, [result, gefunden]);

  function exportCsv() {
    const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const header = ["Nummer", "Art", "Anzahl Teile", "Stellplatz"];
    const zeilen = fehlende.map((c) => [c.nummer, c.art ?? "", c.anzahlTeile ?? "", c.stellplatz].map(esc).join(";"));
    const csv = [header.map(esc).join(";"), ...zeilen].join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "stellplatz-pruefung-fehlend.csv";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function drucken() {
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) return;
    const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const datum = new Date().toLocaleString("de-DE");
    const rows = fehlende.map((c) =>
      `<tr><td class="mono">${esc(c.nummer)}</td><td>${esc(c.art ?? "—")}</td><td>${esc(c.anzahlTeile ?? "—")}</td><td>${esc(c.stellplatz)}</td></tr>`,
    ).join("");
    const css = `
      * { box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; }
      body { margin: 24px; color: #111; }
      h1 { font-size: 18pt; margin: 0 0 4px; }
      .meta { color: #555; font-size: 10pt; margin-bottom: 16px; }
      .kpis { display: flex; gap: 12px; margin-bottom: 16px; }
      .kpi { border: 1px solid #ccc; border-radius: 8px; padding: 8px 14px; }
      .kpi b { display: block; font-size: 20pt; }
      .kpi span { font-size: 9pt; color: #555; text-transform: uppercase; letter-spacing: .04em; }
      table { width: 100%; border-collapse: collapse; font-size: 10pt; }
      th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
      th { background: #f0f2f5; }
      .mono { font-family: "Courier New", monospace; font-weight: bold; }
      .ok { color: #04713f; font-weight: bold; }
    `;
    const body = fehlende.length === 0
      ? `<p class="ok">✓ Alle erwarteten Collis wurden gefunden — keine Fehlbestände.</p>`
      : `<table><thead><tr><th>Nummer</th><th>Art</th><th>Anzahl Teile</th><th>Stellplatz</th></tr></thead><tbody>${rows}</tbody></table>`;
    w.document.write(
      `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Stellplatz-Prüfung</title><style>${css}</style></head><body>` +
      `<h1>Stellplatz-Prüfung — fehlende Collis</h1>` +
      `<div class="meta">Erstellt: ${esc(datum)}${fileName ? ` · Quelle: ${esc(fileName)}` : ""}</div>` +
      `<div class="kpis">` +
        `<div class="kpi"><b>${total}</b><span>erwartet</span></div>` +
        `<div class="kpi"><b>${gefundenAnz}</b><span>gefunden</span></div>` +
        `<div class="kpi"><b>${fehlendAnz}</b><span>fehlend</span></div>` +
      `</div>${body}` +
      `<script>(function(){function p(){window.focus();window.print();}document.readyState==='complete'?p():window.addEventListener('load',p);})();<\/script>` +
      `</body></html>`,
    );
    w.document.close();
  }

  function ruecksetzen() {
    setResult(null); setGefunden(new Set()); setFileName(null); setHinweis(null); setEingabe("");
    if (fileRef.current) fileRef.current.value = "";
  }

  // ── Gating ────────────────────────────────────────────────────────────────
  if (permsLoading) {
    return <div className="py-16 text-center text-[#65676b] dark:text-[#b0b3b8]">Lade Berechtigungen…</div>;
  }
  if (!darfPick) {
    return (
      <div className="py-16 text-center text-[#65676b] dark:text-[#b0b3b8]">
        Kein Zugriff auf die Scan-Ansicht. Bitte das Recht <strong className="mx-1">PICKUP_PICK</strong> bei der Rolle aktivieren.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ModusBanner modus="colli" switchHref="/pickup" switchLabel="LogID-Suche" />

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-[#202F61] dark:text-[#e4e6eb]">Stellplatz-Prüfung</h1>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">Colli-Liste eines Stellplatzes per CSV laden und durch Scannen abgleichen.</p>
        </div>
        <GeraeteUmschalter device={mode} onChange={setMode} className="flex-shrink-0" />
      </div>

      {/* CSV laden */}
      {!result && (
        <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-5 space-y-3">
          <label className="block text-sm font-bold text-[#202F61] dark:text-[#e4e6eb]">Stellplatz-Export (CSV)</label>
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
            className="w-full flex items-center justify-center gap-2 px-5 rounded-xl border-2 border-dashed border-[#7c3aed]/40 bg-[#7c3aed]/5 text-[#7c3aed] dark:text-[#b794f6] text-sm font-bold hover:bg-[#7c3aed]/10 transition-colors min-h-[56px]"
          >
            📄 {fileName ? `Datei: ${fileName} — andere wählen` : "CSV auswählen"}
          </button>
          <p className="text-xs text-[#90939a] dark:text-[#6b6e73]">
            Wird direkt im Browser gelesen (kein Upload, keine Buchung). Spalten: Nummer, Art, Stellplatz, Anzahl Teile, Bearbeitungsstatus.
          </p>
          {parsing && <div className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Lese CSV…</div>}
          {hinweis?.kind === "fremd" && !parsing && (
            <div className="text-sm text-[#b3261e] font-semibold">{hinweis.text}</div>
          )}
        </div>
      )}

      {result && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] p-4 text-center">
              <div className="text-3xl font-black text-[#202F61] dark:text-[#e4e6eb] leading-none">{total}</div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8] mt-1">erwartet</div>
            </div>
            <div className="bg-white dark:bg-[#242526] rounded-2xl border-2 p-4 text-center" style={{ borderColor: "#04B475" }}>
              <div className="text-3xl font-black leading-none" style={{ color: "#04713f" }}>{gefundenAnz}</div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8] mt-1">gefunden</div>
            </div>
            <div className="bg-white dark:bg-[#242526] rounded-2xl border-2 p-4 text-center" style={{ borderColor: fehlendAnz > 0 ? "#fa3e3e" : "#ced4da" }}>
              <div className="text-3xl font-black leading-none" style={{ color: fehlendAnz > 0 ? "#b3261e" : undefined }}>{fehlendAnz}</div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8] mt-1">fehlend</div>
            </div>
          </div>

          {/* Scan-Feld */}
          <form onSubmit={(e) => { e.preventDefault(); handleScan(); }} className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] p-4 space-y-2">
            <label htmlFor="colli-scan" className="text-sm font-bold text-[#202F61] dark:text-[#e4e6eb]">Colli-Nummer scannen</label>
            <div className="flex gap-2">
              <input
                id="colli-scan"
                ref={inputRef}
                value={eingabe}
                onChange={(e) => setEingabe(e.target.value)}
                onKeyDown={onInputKeyDown}
                autoFocus
                autoComplete="off"
                inputMode={mode === "mobil" ? "text" : "none"}
                enterKeyHint="done"
                spellCheck={false}
                placeholder="Colli-Nummer scannen…"
                className="flex-1 min-w-0 px-4 rounded-xl border-2 border-[#7c3aed]/40 bg-[#f0f2f5] dark:bg-[#18191a] text-2xl font-mono font-bold text-[#202F61] dark:text-[#e4e6eb] outline-none focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/30 transition-colors min-h-[56px]"
              />
              {mode === "mobil" && (
                <button type="submit" disabled={!eingabe.trim()} className="px-6 rounded-xl bg-[#7c3aed] text-white text-base font-bold hover:bg-[#6d28d9] disabled:opacity-40 transition-colors min-h-[56px]">
                  Prüfen
                </button>
              )}
            </div>
            {hinweis && (
              <div
                role="status"
                aria-live="polite"
                className={`text-sm font-semibold ${hinweis.kind === "treffer" ? "text-[#04713f]" : hinweis.kind === "schon" ? "text-[#BA7517]" : "text-[#65676b] dark:text-[#b0b3b8]"}`}
              >
                {hinweis.kind === "treffer" ? "✓ " : hinweis.kind === "schon" ? "⚠ " : "• "}{hinweis.text}
              </div>
            )}
          </form>

          {/* Aktionen */}
          <div className="flex flex-wrap gap-2">
            <button onClick={drucken} className="inline-flex items-center gap-1.5 px-4 rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-[#202F61] dark:text-[#e4e6eb] text-sm font-bold hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors min-h-[44px]">🖨️ Report drucken</button>
            <button onClick={exportCsv} className="inline-flex items-center gap-1.5 px-4 rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-[#202F61] dark:text-[#e4e6eb] text-sm font-bold hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors min-h-[44px]">⬇️ Fehlende als CSV</button>
            <button onClick={ruecksetzen} className="inline-flex items-center gap-1.5 px-4 rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] text-sm font-bold hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors min-h-[44px]">Neue Liste laden</button>
          </div>

          {/* Liste je Stellplatz */}
          <div className="space-y-4">
            {result.stellplaetze.map((sp) => {
              const gef = sp.collis.filter((c) => gefunden.has(colliKey(c))).length;
              return (
                <div key={sp.stellplatz} className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between gap-2 px-5 py-3 bg-[#f0f2f5] dark:bg-[#18191a] border-b border-[#ced4da] dark:border-[#3e4042]">
                    <h2 className="font-black text-sm text-[#202F61] dark:text-[#e4e6eb]">🧭 Stellplatz {sp.stellplatz}</h2>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#7c3aed]/10 text-[#7c3aed] dark:text-[#b794f6]">{gef}/{sp.collis.length} gefunden</span>
                  </div>
                  <div className="divide-y divide-[#f0f2f5] dark:divide-[#3e4042]">
                    {sp.collis.map((c) => {
                      const ok = gefunden.has(colliKey(c));
                      return (
                        <div key={colliKey(c)} className={`flex items-center gap-3 px-5 py-3 flex-wrap gap-y-1 ${ok ? "bg-[#04B475]/5" : ""}`}>
                          <span className="text-lg w-6 text-center" aria-hidden>{ok ? "✓" : "○"}</span>
                          <div className="font-mono font-black text-base min-w-[120px]" style={{ color: ok ? "#04713f" : undefined }}>{c.nummer}</div>
                          <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] min-w-[120px]">{c.art ?? "—"}</div>
                          <div className="flex-1 min-w-0 text-sm text-[#65676b] dark:text-[#b0b3b8]">{c.anzahlTeile ? `${c.anzahlTeile} Teile` : "—"}</div>
                          {ok
                            ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#04B475]/15 text-[#04713f]">Gefunden</span>
                            : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#65676b]/10 text-[#65676b] dark:text-[#b0b3b8]">Offen</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

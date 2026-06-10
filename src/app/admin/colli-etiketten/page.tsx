"use client";

import { useId, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Printer, Plus } from "lucide-react";
import {
  printColliEtiketten,
  writeSchrankBeschriftung,
  writeTextLabel,
  type SchrankOrientierung,
} from "@/lib/print/colliEtikett";
import { SchrankEditor } from "@/components/ui/SchrankEditor";
import { usePermissions } from "@/hooks/usePermissions";
import { api } from "@/trpc/react";

type Modus = "colli" | "text" | "schrank";

// Hat das WYSIWYG-HTML echten Inhalt? (Tags/Whitespace ignorieren.)
function htmlHasContent(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim().length > 0;
}

// Colli-Nummern: eine pro Zeile, zusätzlich Komma/Semikolon als Trenner.
function parseColli(input: string): string[] {
  return input.split(/[\n,;]+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

// ── Colli-Etikett (55:30) — QR links, rechts optional Zusatztext + Nummer ──────
function ColliEtikett({ nummer, zusatz, onPrint }: { nummer: string; zusatz: string; onPrint: () => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="img"
        aria-label={`Colli-Etikett ${nummer}${zusatz ? `, Zusatz ${zusatz}` : ""}`}
        className="bg-white border border-[#ced4da] rounded-md overflow-hidden"
        style={{ aspectRatio: "55 / 30" }}
      >
        <div className="flex h-full w-full items-center gap-2 p-2">
          <div className="h-full aspect-square flex-shrink-0">
            <QRCodeSVG
              value={nummer}
              level="M"
              marginSize={2}
              bgColor="#ffffff"
              fgColor="#000000"
              title={`QR-Code ${nummer}`}
              style={{ width: "100%", height: "100%", display: "block" }}
            />
          </div>
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            {zusatz && (
              <div className="self-end mb-1 inline-block max-w-full truncate bg-black text-white font-bold text-[10px] leading-none px-1.5 py-1 rounded">
                {zusatz}
              </div>
            )}
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#444]">
              Colli-Nummer
            </div>
            <div className="font-mono font-bold text-black leading-tight break-all text-base">
              {nummer}
            </div>
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onPrint}
        aria-label={`Etikett ${nummer} drucken`}
        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#0064d2] dark:text-[#45bdff] text-xs font-bold hover:bg-[#0064d2]/10 transition-colors min-h-[40px]"
      >
        <Printer size={14} aria-hidden /> Drucken
      </button>
    </div>
  );
}

export default function ColliEtikettenPage() {
  const { has, isLoading: permsLoading } = usePermissions();

  // Druck-Nutzung protokollieren — fire-and-forget, darf den Druck NIE blockieren.
  const protokolliere = api.colliEtiketten.protokolliereDruck.useMutation({
    onError: () => { /* Logging-Fehler still verschlucken */ },
  });
  function logDruck(m: Modus, n: number) {
    if (n <= 0) return;
    try { protokolliere.mutate({ modus: m, anzahl: n }); } catch { /* still */ }
  }

  // Schrank-HTML wird VOR dem Druck serverseitig sanitized.
  const sanitizeSchrank = api.colliEtiketten.sanitizeSchrank.useMutation();

  const [modus, setModus] = useState<Modus>("colli");

  // Colli-Modus
  const [text, setText]           = useState("");
  const [zusatzAktiv, setZusatzAktiv] = useState(false);
  const [zusatz, setZusatz]       = useState("");
  const nummern   = useMemo(() => parseColli(text), [text]);
  const effZusatz = zusatzAktiv ? zusatz.trim() : "";

  // Text-Modus (WYSIWYG-Freitext-Label, 55×30 mm — ein Label)
  const [textHtml, setTextHtml] = useState("");
  const [textResetKey, setTextResetKey] = useState(0);
  const textBereit = htmlHasContent(textHtml);

  // Schrank-Modus
  const [schrankHtml, setSchrankHtml] = useState("");
  const [schrankOrient, setSchrankOrient] = useState<SchrankOrientierung>("quer");
  const [schrankResetKey, setSchrankResetKey] = useState(0);
  const schrankBereit = htmlHasContent(schrankHtml);

  const taId       = useId();
  const zusatzId   = useId();

  const anzahl =
    modus === "colli" ? nummern.length :
    modus === "text"  ? (textBereit ? 1 : 0) :
    schrankBereit ? 1 : 0;

  // Zugriff: eigenes Recht COLLI_ETIKETTEN_VIEW (ADMIN via SYSTEM_ADMIN inklusive).
  // Rein clientseitig — keine Schreib-/adminProcedure.
  if (permsLoading) {
    return <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">Lade Berechtigungen…</div>;
  }
  if (!has("COLLI_ETIKETTEN_VIEW")) {
    return (
      <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">
        Kein Zugriff auf Colli-Etiketten. Bitte das Recht <strong>COLLI_ETIKETTEN_VIEW</strong> bei der Rolle aktivieren.
      </div>
    );
  }

  // WYSIWYG-Druck (Schrank & Text): Fenster SYNCHRON öffnen (Popup-Blocker),
  // dann serverseitig sanitizen (gleiche Allowlist), erst danach ins Fenster
  // schreiben.
  async function druckeSchrank() {
    if (!schrankBereit) return;
    const w = window.open("", "_blank", "width=640,height=520");
    if (!w) { console.warn("Popup blockiert — Popup-Blocker deaktivieren"); return; }
    try {
      const { html } = await sanitizeSchrank.mutateAsync({ html: schrankHtml });
      writeSchrankBeschriftung(w, html, schrankOrient);
      logDruck("schrank", 1);
    } catch {
      w.close();
    }
  }

  async function druckeText() {
    if (!textBereit) return;
    const w = window.open("", "_blank", "width=400,height=250");
    if (!w) { console.warn("Popup blockiert — Popup-Blocker deaktivieren"); return; }
    try {
      const { html } = await sanitizeSchrank.mutateAsync({ html: textHtml });
      writeTextLabel(w, html);
      logDruck("text", 1);
    } catch {
      w.close();
    }
  }

  function druckeAlle() {
    if (modus === "colli") { printColliEtiketten(nummern, effZusatz); logDruck("colli", nummern.length); }
    else if (modus === "text") { void druckeText(); }
    else { void druckeSchrank(); }
  }

  return (
    <div className="space-y-5">
      {/* Titel + Stapeldruck */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">🏷️ Label Tool</h1>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
            {modus === "schrank"
              ? "Schrank-Beschriftung 15 × 12 cm (gleicher Drucker wie die Etiketten)."
              : "55 × 30 mm-Label-Format (gleicher Drucker wie die Auslagerbelege)."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            aria-live="polite"
            className="px-3 py-2 rounded-xl bg-[#0064d2]/10 text-[#0064d2] dark:text-[#45bdff] text-sm font-bold"
          >
            {modus === "schrank"
              ? (anzahl === 1 ? "1 Beschriftung" : "Keine Beschriftung")
              : `${anzahl} ${anzahl === 1 ? "Etikett" : "Etiketten"}`}
          </span>
          <button
            type="button"
            onClick={druckeAlle}
            disabled={anzahl === 0}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0064d2] text-white text-sm font-bold hover:bg-[#0056b3] disabled:opacity-40 transition-colors shadow-sm min-h-[44px]"
          >
            <Printer size={16} aria-hidden /> Drucken{anzahl > 0 ? ` (${anzahl})` : ""}
          </button>
        </div>
      </div>

      {/* Modus-Umschalter */}
      <div role="group" aria-label="Etiketten-Modus" className="inline-flex rounded-xl overflow-hidden border border-[#ced4da] dark:border-[#3e4042]">
        <button
          type="button"
          aria-pressed={modus === "colli"}
          onClick={() => setModus("colli")}
          className={`px-5 text-sm font-bold transition-colors min-h-[56px] ${modus === "colli" ? "bg-[#0064d2] text-white" : "bg-white dark:bg-[#242526] text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"}`}
        >
          🏷️ Colli-Etiketten
        </button>
        <button
          type="button"
          aria-pressed={modus === "text"}
          onClick={() => setModus("text")}
          className={`px-5 text-sm font-bold border-l border-[#ced4da] dark:border-[#3e4042] transition-colors min-h-[56px] ${modus === "text" ? "bg-[#0064d2] text-white" : "bg-white dark:bg-[#242526] text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"}`}
        >
          📝 Text-Etikett
        </button>
        <button
          type="button"
          aria-pressed={modus === "schrank"}
          onClick={() => setModus("schrank")}
          className={`px-5 text-sm font-bold border-l border-[#ced4da] dark:border-[#3e4042] transition-colors min-h-[56px] ${modus === "schrank" ? "bg-[#0064d2] text-white" : "bg-white dark:bg-[#242526] text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"}`}
        >
          🗄️ Schrank-Beschriftung
        </button>
      </div>

      {/* Eingabe */}
      {modus === "schrank" ? (
        <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-5 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
                Schrank-Beschriftung (15 × 12 cm)
              </h2>
              <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1">
                Freitext zum Auflisten von Gegenständen / Ersatzteilen. Druckt als ganze 150 × 120 mm-Seite mit Schnittkanten-Rahmen.
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setSchrankHtml(""); setSchrankResetKey((k) => k + 1); }}
              disabled={!schrankBereit}
              className="px-4 py-2.5 rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] text-sm font-semibold hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] disabled:opacity-40 transition-colors min-h-[44px]"
            >
              Leeren
            </button>
          </div>
          <SchrankEditor
            key={schrankResetKey}
            html={schrankHtml}
            onHtmlChange={setSchrankHtml}
            toolbar="voll"
            previewKind="schrank"
            orientierung={schrankOrient}
            onOrientierung={setSchrankOrient}
          />
        </div>
      ) : modus === "colli" ? (
        <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-5 space-y-3">
          <label htmlFor={taId} className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
            Colli-Nummern eingeben
          </label>
          <p className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
            Eine Nummer pro Zeile. Komma oder Semikolon werden ebenfalls als Trenner erkannt.
          </p>
          <textarea
            id={taId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            spellCheck={false}
            autoComplete="off"
            placeholder={"COL-0001\nCOL-0002\nCOL-0003"}
            className="w-full px-4 py-3 rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] font-mono text-sm outline-none focus:border-[#0064d2] focus:ring-2 focus:ring-[#0064d2]/30 transition-colors resize-y min-h-[140px]"
          />

          {/* Zusatztext-Toggle */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => setZusatzAktiv((v) => !v)}
              aria-pressed={zusatzAktiv}
              aria-controls={zusatzId}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-colors min-h-[44px] ${zusatzAktiv ? "bg-[#0064d2]/10 border-[#0064d2] text-[#0064d2] dark:text-[#45bdff]" : "border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"}`}
            >
              <Plus size={16} aria-hidden /> {zusatzAktiv ? "Text ausblenden" : "Text hinzufügen"}
            </button>
            <button
              type="button"
              onClick={() => setText("")}
              disabled={text.length === 0}
              className="px-4 py-2.5 rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] text-sm font-semibold hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] disabled:opacity-40 transition-colors min-h-[44px]"
            >
              Leeren
            </button>
          </div>

          {zusatzAktiv && (
            <div id={zusatzId} className="space-y-1">
              <label htmlFor={`${zusatzId}-input`} className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
                Zusatztext (auf allen Etiketten)
              </label>
              <input
                id={`${zusatzId}-input`}
                value={zusatz}
                onChange={(e) => setZusatz(e.target.value)}
                maxLength={40}
                spellCheck={false}
                autoComplete="off"
                placeholder="z. B. Prio"
                className="w-full px-4 py-3 rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] text-sm outline-none focus:border-[#0064d2] focus:ring-2 focus:ring-[#0064d2]/30 transition-colors min-h-[44px]"
              />
              <p className="text-xs text-[#90939a] dark:text-[#6b6e73]">
                Erscheint oben rechts als dunkle Markierung. Leer = nichts anzeigen.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-5 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
                Freitext-Label (55 × 30 mm)
              </h2>
              <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1">
                Ein Label mit formatiertem Freitext (kein QR/keine Nummer). Fett, kursiv und Schriftgröße möglich.
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setTextHtml(""); setTextResetKey((k) => k + 1); }}
              disabled={!textBereit}
              className="px-4 py-2.5 rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] text-sm font-semibold hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] disabled:opacity-40 transition-colors min-h-[44px]"
            >
              Leeren
            </button>
          </div>
          <SchrankEditor
            key={textResetKey}
            html={textHtml}
            onHtmlChange={setTextHtml}
            toolbar="reduziert"
            previewKind="text"
          />
        </div>
      )}

      {/* Live-Vorschau (Text- & Schrank-Modus bringen ihre eigene 1:1-Vorschau mit) */}
      {modus === "colli" && (
      <div className="space-y-3">
        <h2 className="text-sm font-black uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8]">
          Vorschau
        </h2>
        {anzahl === 0 ? (
          <div className="text-center py-16 text-[#65676b] dark:text-[#b0b3b8] border border-dashed border-[#ced4da] dark:border-[#3e4042] rounded-2xl">
            Noch keine Colli-Nummern — oben eingeben, um Etiketten zu sehen.
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
            {nummern.map((nr, i) => (
              <ColliEtikett
                key={`${i}-${nr}`}
                nummer={nr}
                zusatz={effZusatz}
                onPrint={() => { printColliEtiketten([nr], effZusatz); logDruck("colli", 1); }}
              />
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

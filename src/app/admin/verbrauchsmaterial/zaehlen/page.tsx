"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/trpc/react";
import { usePermissions } from "@/hooks/usePermissions";
import { useScannerMode } from "@/lib/pickup/useScannerMode";
import { GeraeteUmschalter } from "@/components/pickup/ModusBanner";
import { playScanSound, playNegativeSound } from "@/lib/pickup/scanSound";

const CYAN = "#008BD2";

// Aktiver Artikel im Zählflow — Vereinigung aus Scan (artikelByCode) und Suche (liste).
type AktivArtikel = {
  id:                number;
  code:              string;
  name:              string;
  kategorie:         string | null;
  standort:          string | null;
  aktuellerBestand:  number; // = letzter Bestand
  mindestbestand:    number;
  letztesZaehldatum: Date | string | null;
  status:            "OK" | "NACHBESTELLEN";
};

type Feedback =
  | { kind: "gespeichert"; name: string; code: string; vorher: number; neu: number; verbrauch: number }
  | { kind: "nichtGefunden"; code: string }
  | null;

function fmtDatum(d: Date | string | null): string {
  if (!d) return "noch nie gezählt";
  return new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtZeit(d: Date | string): string {
  return new Date(d).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

export default function ZaehlenPage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfZaehlen = has("MATERIAL_MANAGE");

  const utils = api.useUtils();
  const { mode, setMode, onInputKeyDown } = useScannerMode();
  const tastatur = mode === "mobil";

  const scanRef    = useRef<HTMLInputElement>(null);
  const bestandRef = useRef<HTMLInputElement>(null);

  const [eingabe, setEingabe]   = useState("");
  const [aktiv, setAktiv]       = useState<AktivArtikel | null>(null);
  const [bestand, setBestand]   = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy]         = useState(false);
  const [sucheText, setSucheText] = useState("");

  const dieseWocheQ = api.verbrauchsmaterial.dieseWoche.useQuery(undefined, {
    enabled: !permsLoading && has("MATERIAL_VIEW"),
  });
  const sucheQ = api.verbrauchsmaterial.liste.useQuery(
    { suche: sucheText.trim(), nurAktive: true },
    { enabled: sucheText.trim().length >= 2 },
  );

  const zaehlen = api.verbrauchsmaterial.zaehlen.useMutation({
    onSuccess: (r, vars) => {
      const art = aktiv;
      setFeedback({
        kind: "gespeichert",
        name: art?.name ?? "",
        code: art?.code ?? "",
        vorher: r.vorher, neu: r.neu, verbrauch: r.verbrauch,
      });
      playScanSound("GEFUNDEN");
      setAktiv(null); setBestand(""); setEingabe("");
      void utils.verbrauchsmaterial.dieseWoche.invalidate();
      void vars;
      setTimeout(() => scanRef.current?.focus(), 50);
    },
    onError: () => { playNegativeSound(); },
  });

  // Beim Aktivieren eines Artikels ins Bestandsfeld fokussieren (Hardware-Tastatur
  // tippt direkt; die Soft-Tastatur bleibt via inputMode='none' aus → On-Screen-Numpad).
  useEffect(() => { if (aktiv) bestandRef.current?.focus(); }, [aktiv]);

  if (permsLoading) {
    return <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">Lade Berechtigungen…</div>;
  }
  if (!darfZaehlen) {
    return (
      <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">
        Kein Zugriff. Bitte das Recht <strong>MATERIAL_MANAGE</strong> bei der Rolle aktivieren.
      </div>
    );
  }

  async function ladeCode(code: string) {
    const c = code.trim();
    if (!c || busy) return;
    setBusy(true);
    try {
      const res = await utils.verbrauchsmaterial.artikelByCode.fetch({ code: c });
      if (res.gefunden) {
        setAktiv(res.artikel);
        setBestand("");
        setFeedback(null);
        playScanSound("GEFUNDEN");
      } else {
        setAktiv(null);
        setFeedback({ kind: "nichtGefunden", code: res.code });
        playNegativeSound();
        setTimeout(() => scanRef.current?.focus(), 50);
      }
    } catch {
      playNegativeSound();
      setFeedback({ kind: "nichtGefunden", code: c });
    } finally {
      setEingabe("");
      setBusy(false);
    }
  }

  function waehleAusSuche(a: {
    id: number; code: string; name: string; kategorie: string | null; standort: string | null;
    aktuellerBestand: number; mindestbestand: number; status: "OK" | "NACHBESTELLEN";
  }) {
    setAktiv({ ...a, letztesZaehldatum: null });
    setBestand("");
    setFeedback(null);
    setSucheText("");
  }

  function speichern() {
    if (!aktiv) return;
    const n = parseInt(bestand, 10);
    if (!Number.isFinite(n) || n < 0) { playNegativeSound(); return; }
    zaehlen.mutate({ artikelId: aktiv.id, bestand: n });
  }

  // Numpad-Tasten — On-Screen für Mobil/Touch (Hardware-Tastatur funktioniert parallel).
  function tippe(d: string) { setBestand((v) => (v + d).replace(/^0+(?=\d)/, "").slice(0, 7)); }
  function loesche()        { setBestand((v) => v.slice(0, -1)); }
  function leere()          { setBestand(""); }

  const gewaehltN = bestand.trim() === "" ? null : parseInt(bestand, 10);
  const vorschau =
    aktiv && gewaehltN != null && Number.isFinite(gewaehltN)
      ? gewaehltN < aktiv.aktuellerBestand
        ? { txt: `Verbrauch ${aktiv.aktuellerBestand - gewaehltN}`, farbe: "#BA7517", icon: "▼" }
        : gewaehltN > aktiv.aktuellerBestand
          ? { txt: `aufgefüllt +${gewaehltN - aktiv.aktuellerBestand}`, farbe: "#04713f", icon: "▲" }
          : { txt: "unverändert", farbe: "#65676b", icon: "=" }
      : null;

  return (
    <div className="max-w-xl mx-auto space-y-4">
      {/* Kopf */}
      <div className="flex items-center justify-between gap-2">
        <Link href="/admin/verbrauchsmaterial" className="inline-flex items-center gap-1 text-[#65676b] dark:text-[#b0b3b8] hover:text-[#008BD2] text-sm font-semibold min-h-[44px]">← Verbrauchsmaterial</Link>
        <GeraeteUmschalter device={mode} onChange={(d) => { setMode(d); scanRef.current?.focus(); }} />
      </div>
      <h1 className="text-2xl font-black text-[#202F61] dark:text-[#e4e6eb]">📲 Zählen</h1>

      {/* Scan-Feld */}
      <form
        onSubmit={(e) => { e.preventDefault(); void ladeCode(eingabe); }}
        className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] p-3 space-y-2"
      >
        <label htmlFor="scan-input" className="text-sm font-bold text-[#202F61] dark:text-[#e4e6eb]">
          QR/Code scannen
        </label>
        <div className="flex gap-2">
          <input
            id="scan-input"
            ref={scanRef}
            value={eingabe}
            onChange={(e) => setEingabe(e.target.value)}
            onKeyDown={onInputKeyDown}
            autoFocus
            autoComplete="off"
            inputMode={tastatur ? "text" : "none"}
            enterKeyHint="done"
            spellCheck={false}
            placeholder="z. B. VM-0001 scannen…"
            className="flex-1 min-w-0 px-4 rounded-xl border-2 bg-[#f0f2f5] dark:bg-[#18191a] text-2xl font-mono font-bold text-[#202F61] dark:text-[#e4e6eb] outline-none min-h-[56px]"
            style={{ borderColor: CYAN }}
          />
          {tastatur && (
            <button
              type="submit"
              disabled={!eingabe.trim() || busy}
              className="px-6 rounded-xl text-white text-base font-bold disabled:opacity-40 min-h-[56px] min-w-[72px]"
              style={{ background: CYAN }}
            >
              OK
            </button>
          )}
        </div>
        <p className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
          Etikett scannen → letzter Bestand erscheint → neuen Bestand eintragen → speichern → nächstes.
        </p>
      </form>

      {/* Feedback: gespeichert / nicht gefunden */}
      {feedback?.kind === "gespeichert" && (
        <div role="status" aria-live="assertive" className="rounded-2xl border-2 p-4" style={{ borderColor: "#04B475", background: "rgba(4,180,117,0.10)" }}>
          <div className="flex items-center gap-3">
            <span className="text-4xl" aria-hidden>✓</span>
            <div className="min-w-0">
              <div className="text-lg font-black" style={{ color: "#04713f" }}>Gespeichert</div>
              <div className="text-sm font-bold text-[#202F61] dark:text-[#e4e6eb] truncate">{feedback.name} · {feedback.code}</div>
              <div className="text-base text-[#1a1a1a] dark:text-[#e4e6eb]">
                {feedback.vorher} → <strong>{feedback.neu}</strong>
                {feedback.verbrauch > 0
                  ? <> · Verbrauch <strong>{feedback.verbrauch}</strong></>
                  : feedback.neu > feedback.vorher
                    ? <> · aufgefüllt <strong>+{feedback.neu - feedback.vorher}</strong></>
                    : <> · unverändert</>}
              </div>
            </div>
          </div>
        </div>
      )}
      {feedback?.kind === "nichtGefunden" && (
        <div role="status" aria-live="assertive" className="rounded-2xl border-2 p-4" style={{ borderColor: "#fa3e3e", background: "rgba(250,62,62,0.10)" }}>
          <div className="flex items-center gap-3">
            <span className="text-4xl" aria-hidden>✗</span>
            <div className="min-w-0">
              <div className="text-lg font-black" style={{ color: "#b3261e" }}>Code nicht gefunden</div>
              <div className="text-base font-mono font-bold text-[#202F61] dark:text-[#e4e6eb]">{feedback.code || "—"}</div>
              <div className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">Erneut scannen oder unten per Suche wählen.</div>
            </div>
          </div>
        </div>
      )}

      {/* Aktiver Artikel + Bestandseingabe */}
      {aktiv && (
        <div className="bg-white dark:bg-[#242526] rounded-2xl border-2 border-[#008BD2]/50 shadow-sm p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xl font-black text-[#202F61] dark:text-[#e4e6eb] break-words">{aktiv.name}</div>
              <div className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
                {[aktiv.kategorie, aktiv.standort].filter(Boolean).join(" · ") || "—"}
              </div>
              <div className="text-xs font-mono text-[#008BD2] dark:text-[#45bdff] mt-0.5">{aktiv.code}</div>
            </div>
            <button
              onClick={() => { setAktiv(null); setBestand(""); scanRef.current?.focus(); }}
              aria-label="Abbrechen"
              className="w-10 h-10 rounded-lg text-[#65676b] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] flex-shrink-0"
            >×</button>
          </div>

          {/* Letzter Bestand — groß */}
          <div className="flex items-center justify-between gap-3 rounded-xl bg-[#f0f2f5] dark:bg-[#18191a] px-4 py-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8]">Letzter Bestand</div>
              <div className="text-xs text-[#90939a] dark:text-[#6b6e73]">Stand: {fmtDatum(aktiv.letztesZaehldatum)}</div>
            </div>
            <div className="text-4xl font-black text-[#202F61] dark:text-[#e4e6eb] tabular-nums">{aktiv.aktuellerBestand}</div>
          </div>

          {/* Neuer Bestand */}
          <div>
            <label htmlFor="bestand-input" className="block text-xs font-bold uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8] mb-1">Neuer Bestand (gezählt)</label>
            <input
              id="bestand-input"
              ref={bestandRef}
              value={bestand}
              onChange={(e) => setBestand(e.target.value.replace(/\D/g, "").slice(0, 7))}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); speichern(); } }}
              inputMode="none"
              autoComplete="off"
              placeholder="0"
              className="w-full px-4 rounded-xl border-2 border-[#008BD2] bg-white dark:bg-[#18191a] text-center text-5xl font-black text-[#202F61] dark:text-[#e4e6eb] outline-none min-h-[72px] tabular-nums"
            />
            {vorschau && (
              <div className="mt-1.5 text-center text-sm font-bold" style={{ color: vorschau.farbe }}>
                <span aria-hidden>{vorschau.icon}</span> {vorschau.txt}
              </div>
            )}
          </div>

          {/* On-Screen-Numpad */}
          <div className="grid grid-cols-3 gap-2">
            {["1","2","3","4","5","6","7","8","9"].map((d) => (
              <button key={d} type="button" onClick={() => tippe(d)}
                className="min-h-[56px] rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-2xl font-black text-[#202F61] dark:text-[#e4e6eb] hover:bg-[#e4e6eb] dark:hover:bg-[#3e4042]">
                {d}
              </button>
            ))}
            <button type="button" onClick={leere} aria-label="Eingabe löschen"
              className="min-h-[56px] rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-lg font-black text-[#b3261e] hover:bg-[#e4e6eb] dark:hover:bg-[#3e4042]">
              C
            </button>
            <button type="button" onClick={() => tippe("0")}
              className="min-h-[56px] rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-2xl font-black text-[#202F61] dark:text-[#e4e6eb] hover:bg-[#e4e6eb] dark:hover:bg-[#3e4042]">
              0
            </button>
            <button type="button" onClick={loesche} aria-label="Letzte Ziffer löschen"
              className="min-h-[56px] rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-2xl font-black text-[#202F61] dark:text-[#e4e6eb] hover:bg-[#e4e6eb] dark:hover:bg-[#3e4042]">
              ⌫
            </button>
          </div>

          <button
            onClick={speichern}
            disabled={bestand.trim() === "" || zaehlen.isPending}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl text-white text-lg font-black disabled:opacity-40 min-h-[56px]"
            style={{ background: "#04B475" }}
          >
            {zaehlen.isPending ? "Speichere…" : "✓ Speichern & weiter"}
          </button>
        </div>
      )}

      {/* Fallback: Suche (Etikett beschädigt) */}
      {!aktiv && (
        <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-3 space-y-2">
          <label htmlFor="suche-input" className="text-sm font-bold text-[#202F61] dark:text-[#e4e6eb]">🔍 Ohne QR: Artikel suchen</label>
          <input
            id="suche-input"
            value={sucheText}
            onChange={(e) => setSucheText(e.target.value)}
            placeholder="Name, Code, AAN…"
            className="w-full px-3 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] min-h-[48px]"
          />
          {sucheText.trim().length >= 2 && (
            <div className="max-h-64 overflow-y-auto divide-y divide-[#f0f2f5] dark:divide-[#3e4042] rounded-lg border border-[#f0f2f5] dark:border-[#3e4042]">
              {sucheQ.isLoading ? (
                <div className="px-3 py-4 text-sm text-center text-[#65676b] dark:text-[#b0b3b8]">Suche…</div>
              ) : (sucheQ.data ?? []).length === 0 ? (
                <div className="px-3 py-4 text-sm text-center text-[#65676b] dark:text-[#b0b3b8]">Nichts gefunden.</div>
              ) : (
                (sucheQ.data ?? []).map((a) => (
                  <button
                    key={a.id}
                    onClick={() => waehleAusSuche(a)}
                    className="w-full text-left px-3 py-2.5 hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] flex items-center justify-between gap-3 min-h-[48px]"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold text-[#1a1a1a] dark:text-[#e4e6eb] truncate">{a.name}</span>
                      <span className="block text-xs font-mono text-[#008BD2] dark:text-[#45bdff]">{a.code}</span>
                    </span>
                    <span className="text-sm font-bold text-[#65676b] dark:text-[#b0b3b8] tabular-nums flex-shrink-0">{a.aktuellerBestand}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Diese Woche erfasst */}
      <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-[#f0f2f5] dark:bg-[#18191a] border-b border-[#ced4da] dark:border-[#3e4042] flex items-center justify-between">
          <h2 className="font-black text-sm uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8]">📅 Diese Woche erfasst</h2>
          {dieseWocheQ.data && (
            <span className="text-sm font-bold text-[#008BD2] dark:text-[#45bdff]">
              {dieseWocheQ.data.anzahl} / {dieseWocheQ.data.aktiveGesamt}
            </span>
          )}
        </div>
        {dieseWocheQ.isLoading ? (
          <div className="px-4 py-6 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">Lädt…</div>
        ) : (dieseWocheQ.data?.erfasst.length ?? 0) === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">Diese Woche noch nichts gezählt.</div>
        ) : (
          <ul className="divide-y divide-[#f0f2f5] dark:divide-[#3e4042] max-h-72 overflow-y-auto">
            {dieseWocheQ.data!.erfasst.map((e) => (
              <li key={e.artikelId} className="flex items-center gap-3 px-4 py-2.5">
                <span className="text-[#04B475]" aria-hidden>✓</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[#1a1a1a] dark:text-[#e4e6eb] truncate">{e.name}</span>
                  <span className="block text-xs text-[#65676b] dark:text-[#b0b3b8]">
                    {fmtZeit(e.datum)}{e.benutzer ? ` · ${e.benutzer}` : ""}{e.verbrauch > 0 ? ` · Verbrauch ${e.verbrauch}` : ""}
                  </span>
                </span>
                <span className="text-base font-black text-[#202F61] dark:text-[#e4e6eb] tabular-nums flex-shrink-0">{e.bestand}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

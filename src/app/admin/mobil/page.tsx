"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import FocusTrap from "focus-trap-react";
import { api } from "@/trpc/react";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/components/ui/Toast";
import {
  baueZwischenablage, kopiereText,
  type MobilExportZeile,
} from "@/lib/mobil/export";

const AKZENT = "#008BD2";
const HERSTELLER = ["Apple", "Samsung", "Google", "Xiaomi"] as const;

type MobilBereich = "STANDARD" | "DIGITAL_EDUCATION";
const BEREICH_TABS: { key: MobilBereich; label: string }[] = [
  { key: "STANDARD",          label: "Standard" },
  { key: "DIGITAL_EDUCATION", label: "digital Education" },
];

export default function MobilPage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfSehen     = has("MOBIL_VIEW");
  const darfVerwalten = has("MOBIL_MANAGE");

  // Browsing-Auswahl: Hersteller (Schritt 1) → Modell (Schritt 2) → Teile (Modal).
  const [selHersteller, setSelHersteller] = useState<string | null>(null);
  const [offenesModell, setOffenesModell] = useState<{ id: number; name: string } | null>(null);
  // Kostenstelle/Bereich (Reiter). Wechsel setzt die Browsing-Auswahl zurück.
  const [bereich, setBereich] = useState<MobilBereich>("STANDARD");

  const [unterOffen, setUnterOffen] = useState(false);

  const herstellerQ = api.mobil.hersteller.useQuery({ bereich }, { enabled: darfSehen });
  const unterQ = api.mobil.mobilUnterMindestbestand.useQuery({ bereich }, { enabled: darfSehen });
  const statsQ = api.mobil.stats.useQuery({ bereich }, { enabled: darfSehen });
  const reviewOffen = statsQ.data?.review ?? 0;
  const modelleQ = api.mobil.modelle.useQuery(
    { hersteller: selHersteller ?? "", bereich },
    { enabled: darfSehen && !!selHersteller },
  );

  if (permsLoading) {
    return <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Lade Berechtigungen…</div>;
  }
  if (!darfSehen) {
    return (
      <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">
        Kein Zugriff. Bitte das Recht <strong>MOBIL_VIEW</strong> bei der Rolle aktivieren.
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-[#202F61] dark:text-[#e4e6eb]">📱 Mobil-Ersatzteile</h1>
          <p className="mt-2 text-base text-[#65676b] dark:text-[#b0b3b8]">
            Smartphone- und Tablet-Teile mit LogID. Hersteller → Modell → Teile durchsuchen und exportieren.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/mobil/anfragen"
            className="inline-flex items-center gap-2 px-4 rounded-xl text-base font-bold shadow-sm min-h-[44px] border border-[#ced4da] dark:border-[#3e4042] text-[#202F61] dark:text-[#e4e6eb] hover:bg-[#f0f2f5] dark:hover:bg-[#3a3b3c] transition-colors"
          >
            🔔 Anfragen
          </Link>
          {darfVerwalten && reviewOffen > 0 && (
            <Link
              href={`/admin/mobil/review?bereich=${bereich}`}
              className="inline-flex items-center gap-2 px-4 rounded-xl text-base font-bold shadow-sm min-h-[44px] border border-[#b25e00]/50 bg-[#b25e00]/10 text-[#b25e00] dark:text-[#ffb74d] hover:bg-[#b25e00]/20 transition-colors"
            >
              🔍 Review
              <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-[#b25e00] text-white text-xs font-black tabular-nums">
                {reviewOffen}
              </span>
            </Link>
          )}
          <Link
            href={`/admin/mobil/statistik?bereich=${bereich}`}
            className="inline-flex items-center gap-2 px-4 rounded-xl text-base font-bold shadow-sm min-h-[44px] border border-[#ced4da] dark:border-[#3e4042] text-[#202F61] dark:text-[#e4e6eb] hover:bg-[#f0f2f5] dark:hover:bg-[#3a3b3c] transition-colors"
          >
            📊 Statistik
          </Link>
          {darfVerwalten && (
            <Link
              href={`/admin/mobil/import?bereich=${bereich}`}
              className="inline-flex items-center gap-2 px-4 rounded-xl text-white text-base font-bold shadow-sm min-h-[44px]"
              style={{ background: AKZENT }}
            >
              📥 Import
            </Link>
          )}
        </div>
      </header>

      {/* Reiter: Kostenstelle/Bereich — schaltet die ganze Ansicht um */}
      <div className="flex gap-1 rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-1 w-fit">
        {BEREICH_TABS.map(({ key, label }) => {
          const aktiv = bereich === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={aktiv}
              onClick={() => { setBereich(key); setSelHersteller(null); setOffenesModell(null); }}
              className={`px-4 min-h-[44px] rounded-lg text-base font-bold transition-colors ${aktiv ? "text-white" : "text-[#202F61] dark:text-[#e4e6eb] hover:bg-[#f0f2f5] dark:hover:bg-[#3a3b3c]"}`}
              style={aktiv ? { background: AKZENT } : undefined}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Übersicht: Gruppen unter Mindestbestand (dezent) */}
      {unterQ.data && (unterQ.data.anzahl > 0 ? (
        <div className="rounded-xl border border-[#b25e00]/40 bg-[#b25e00]/10 dark:bg-[#ffb74d]/10 overflow-hidden">
          <button
            type="button"
            onClick={() => setUnterOffen((o) => !o)}
            aria-expanded={unterOffen}
            className="w-full flex items-center justify-between gap-3 px-4 min-h-[52px] text-left"
          >
            <span className="text-base font-bold text-[#b25e00] dark:text-[#ffb74d]">
              ⚠️ {unterQ.data.anzahl} {unterQ.data.anzahl === 1 ? "Ersatzteil-Gruppe" : "Ersatzteil-Gruppen"} unter Mindestbestand
            </span>
            <span aria-hidden className="text-[#b25e00] dark:text-[#ffb74d]">{unterOffen ? "▲" : "▼"}</span>
          </button>
          {unterOffen && (
            <ul className="px-4 pb-3 pt-1 space-y-1 border-t border-[#b25e00]/20">
              {unterQ.data.gruppen.map((g) => (
                <li key={`${g.hersteller}-${g.modell}-${g.teiltyp}`} className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                  <span className="text-[#1a1a1a] dark:text-[#e4e6eb]">
                    <strong>{g.modell}</strong> <span className="text-[#65676b] dark:text-[#b0b3b8]">· {g.teiltyp}</span>
                  </span>
                  <span className="tabular-nums text-[#b25e00] dark:text-[#ffb74d] font-semibold">
                    {g.ist} / {g.soll} · {g.fehlt} fehlen
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="text-sm text-[#2e7d32] dark:text-[#7bc67e]">✓ Alle gepflegten Mindestbestände erfüllt.</div>
      ))}

      {/* Schritt 1: Hersteller */}
      <div className="space-y-2">
        <Schrittkopf nr={1} text="Hersteller wählen" />
        {herstellerQ.isLoading ? (
          <Laden />
        ) : !herstellerQ.data?.length ? (
          <Leer text={darfVerwalten
            ? "Noch keine Teile importiert. Oben rechts über »Import« eine CSV hochladen."
            : "Noch keine Teile importiert."} />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {herstellerQ.data.map((h) => {
              const aktiv = selHersteller === h.hersteller;
              return (
                <button
                  key={h.hersteller}
                  type="button"
                  aria-pressed={aktiv}
                  onClick={() => { setSelHersteller(h.hersteller); setOffenesModell(null); }}
                  className="text-left rounded-2xl border-2 p-4 min-h-[88px] transition-colors"
                  style={{ borderColor: aktiv ? AKZENT : "#ced4da66", background: aktiv ? `${AKZENT}14` : "transparent" }}
                >
                  <div className="text-xl font-black text-[#202F61] dark:text-[#e4e6eb]">{h.hersteller}</div>
                  <div className="mt-1 text-sm text-[#65676b] dark:text-[#b0b3b8]">
                    {h.modelle} {h.modelle === 1 ? "Modell" : "Modelle"} · <strong>{h.teile}</strong> Teile
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Schritt 2: Modelle */}
      {selHersteller && (
        <div className="space-y-2">
          <Schrittkopf nr={2} text={`Modell wählen: ${selHersteller}`} />
          {modelleQ.isLoading ? (
            <Laden />
          ) : !modelleQ.data?.length ? (
            <Leer text="Keine Modelle mit Teilen." />
          ) : (
            <div className="grid sm:grid-cols-2 gap-2">
              {modelleQ.data.map((m) => {
                const aktiv = offenesModell?.id === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={aktiv}
                    aria-haspopup="dialog"
                    onClick={() => setOffenesModell({ id: m.id, name: m.modell })}
                    className="flex items-center justify-between gap-3 rounded-xl border-2 px-4 min-h-[56px] transition-colors"
                    style={{ borderColor: aktiv ? AKZENT : "#ced4da66", background: aktiv ? `${AKZENT}14` : "transparent" }}
                  >
                    <span className="text-base font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{m.modell}</span>
                    <span className="flex-shrink-0 rounded-lg px-3 py-1 text-sm font-bold tabular-nums" style={{ background: `${AKZENT}1a`, color: AKZENT }}>
                      {m.stueck} Stück
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Schritt 3: Teile-Übersicht des gewählten Modells — als zentriertes Modal. */}
      {offenesModell && selHersteller && (
        <MobilModellModal
          hersteller={selHersteller}
          modellId={offenesModell.id}
          modellName={offenesModell.name}
          bereich={bereich}
          darfVerwalten={darfVerwalten}
          onClose={() => setOffenesModell(null)}
        />
      )}
    </div>
  );
}

// ── Modell-Modal: Teile-Übersicht eines Modells (Kopf fest, Body scrollt) ──────
// Gleiches Look/Verhalten wie das Lagerfuchs-/ui-Modal (zentriert, max-h-[90vh],
// Overlay, role="dialog" + aria-modal, Schließen via X / Escape / Overlay-Klick,
// FocusTrap). Auf schmalem Viewport Vollbild.
function MobilModellModal({
  hersteller, modellId, modellName, bereich, darfVerwalten, onClose,
}: {
  hersteller: string;
  modellId: number;
  modellName: string;
  bereich: MobilBereich;
  darfVerwalten: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    // Hintergrund-Scroll sperren, solange das Modal offen ist (wie die anderen Modals).
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const teileQ = api.mobil.teileProModell.useQuery({ modellId, bereich });

  return (
    <FocusTrap
      focusTrapOptions={{
        escapeDeactivates:       false, // Escape behandelt der keydown-Handler oben
        clickOutsideDeactivates: false,
        returnFocusOnDeactivate: true,  // Fokus zurück auf den Modell-Button
      }}
    >
      <div
        className="fixed inset-0 z-[9999] flex items-stretch sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="mobil-modell-title"
          onClick={(e) => e.stopPropagation()}
          className="relative w-full sm:max-w-3xl bg-white dark:bg-[#242526] sm:rounded-2xl shadow-2xl border border-[#ced4da] dark:border-[#3e4042] flex flex-col h-full sm:h-auto max-h-[100vh] sm:max-h-[90vh]"
        >
          {/* Kopf — fest */}
          <div className="flex items-start justify-between gap-3 px-5 sm:px-6 py-4 border-b border-[#ced4da] dark:border-[#3e4042] flex-shrink-0">
            <div className="min-w-0">
              <h3 id="mobil-modell-title" className="text-xl sm:text-2xl font-black text-[#202F61] dark:text-[#e4e6eb] truncate">
                {modellName}
                {teileQ.data ? <span className="text-[#65676b] dark:text-[#b0b3b8] font-bold"> · {teileQ.data.gesamt} Stück gesamt</span> : null}
              </h3>
              <p className="mt-0.5 text-sm text-[#65676b] dark:text-[#b0b3b8]">
                Hersteller: {hersteller}
                {teileQ.data && teileQ.data.ausgeschieden > 0 && (
                  <span className="text-[#90939a] dark:text-[#8a8d91]"> · {teileQ.data.ausgeschieden} ausgeschieden (nicht im Bestand)</span>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Schließen"
              className="text-[#65676b] hover:text-[#fa3e3e] text-2xl leading-none w-11 h-11 flex items-center justify-center rounded-lg hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors flex-shrink-0"
            >
              ×
            </button>
          </div>

          {/* Body — scrollt */}
          <div className="px-4 sm:px-6 py-5 overflow-y-auto flex-1 space-y-3">
            {teileQ.isLoading ? (
              <Laden text="Teile werden geladen…" />
            ) : !teileQ.data?.teiltypen.length ? (
              <Leer text="Keine Teile für dieses Modell." />
            ) : (
              teileQ.data.teiltypen.map((g) => (
                <TeiltypCard
                  key={g.teiltyp}
                  modellId={modellId}
                  hersteller={hersteller}
                  modellName={modellName}
                  bereich={bereich}
                  teiltyp={g.teiltyp}
                  stueck={g.stueck}
                  soll={g.soll}
                  darfVerwalten={darfVerwalten}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </FocusTrap>
  );
}

// ── Teiltyp-Karte: Kopf mit Stückzahl + Export, aufklappbare LogID-Liste ────────
function TeiltypCard({
  modellId, hersteller, modellName, bereich, teiltyp, stueck, soll, darfVerwalten,
}: {
  modellId: number;
  hersteller: string;
  modellName: string;
  bereich: MobilBereich;
  teiltyp: string;
  stueck: number;
  soll: number | null;
  darfVerwalten: boolean;
}) {
  const { show } = useToast();
  const utils = api.useUtils();
  const [offen, setOffen] = useState(false);
  const [editLogId, setEditLogId] = useState<string | null>(null);

  // Mindestbestand (Soll) setzen — nur MOBIL_MANAGE.
  const [sollInput, setSollInput] = useState<string>(soll != null ? String(soll) : "");
  useEffect(() => { setSollInput(soll != null ? String(soll) : ""); }, [soll]);
  const setMin = api.mobil.setMindestbestand.useMutation({
    onSuccess: () => {
      show("✅ Mindestbestand gespeichert", "success");
      void utils.mobil.teileProModell.invalidate({ modellId });
      void utils.mobil.mobilUnterMindestbestand.invalidate();
    },
    onError: (e) => show(e.message, "error"),
  });
  function speichern() {
    const n = parseInt(sollInput, 10);
    if (Number.isNaN(n) || n < 0) { show("Bitte eine Zahl ≥ 0 eingeben.", "error"); return; }
    setMin.mutate({ modellId, teiltyp, sollMenge: n, bereich });
  }
  const sollId = `soll-${modellId}-${teiltyp.replace(/\s+/g, "-")}`;

  // Immer laden (nicht erst beim Aufklappen), damit der Export die Zeilen SYNCHRON
  // aus dem Cache nehmen kann — ein async-Nachladen im Klick-Handler würde die
  // User-Geste verlieren und den Download still blockieren.
  const logIdsQ = api.mobil.logIdsProTeiltyp.useQuery({ modellId, teiltyp, bereich });

  // LogIDs nach Colli gruppieren (Liste ist bereits nach colli, logId sortiert).
  const gruppen = useMemo(() => {
    const rows = logIdsQ.data ?? [];
    const map = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = r.colli ?? "ohne Colli";
      const arr = map.get(k) ?? [];
      arr.push(r);
      map.set(k, arr);
    }
    return [...map.entries()];
  }, [logIdsQ.data]);

  // Export: die BEREITS geladenen Zeilen synchron aus dem Cache (logIdsQ.data) mappen
  // — kein async-Nachladen im Klick-Handler (das würde die User-Geste verlieren).
  function holeRows(): MobilExportZeile[] {
    return (logIdsQ.data ?? []).map((r) => ({
      logId: r.logId, colli: r.colli, stellplatz: r.stellplatz, farbe: r.farbe,
      aan: r.aan, ek: r.ek, lieferant: r.lieferant, bezeichnung: r.bezeichnung,
    }));
  }
  const exportBereit = !!logIdsQ.data; // Zeilen im Cache → Kopieren möglich

  // CSV/XLSX laufen über einen echten Server-Download-Link (Content-Disposition),
  // NICHT über programmatischen Blob-Klick — das lädt zuverlässig in jedem Browser
  // / auf jedem Gerät. Braucht nur modellId + teiltyp, keine vorgeladenen Client-Daten.
  const exportUrl = (format: "csv" | "xlsx") =>
    `/api/mobil/export?format=${format}&modellId=${modellId}&teiltyp=${encodeURIComponent(teiltyp)}&bereich=${bereich}`;

  // Fehler NICHT verschlucken: sichtbarer Toast + console.error (Clipboard-Pfad).
  function meldeFehler(e: unknown) {
    console.error("Mobil-Export fehlgeschlagen:", e);
    show("Export fehlgeschlagen: " + (e instanceof Error ? e.message : String(e)), "error");
  }

  // Zwischenablage: nur die LogIDs. Clipboard-API toleriert das await nach der Geste.
  async function onCopy() {
    try {
      const rows = holeRows();
      if (!rows.length) { show("Keine LogIDs zum Kopieren.", "warning"); return; }
      const ok = await kopiereText(baueZwischenablage(rows));
      show(ok ? `${rows.length} LogIDs kopiert` : "Kopieren fehlgeschlagen.", ok ? "success" : "error");
    } catch (e) { meldeFehler(e); }
  }

  const btn = "inline-flex items-center justify-center gap-1 rounded-lg px-3 min-h-[44px] text-sm font-bold border border-[#ced4da] dark:border-[#3e4042] text-[#202F61] dark:text-[#e4e6eb] hover:bg-[#f0f2f5] dark:hover:bg-[#3a3b3c] disabled:opacity-40 transition-colors";

  return (
    <div className="rounded-2xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          onClick={() => setOffen((o) => !o)}
          aria-expanded={offen}
          className="flex-1 flex items-center justify-between gap-3 min-h-[44px] px-1 text-left"
        >
          <span className="text-lg font-bold text-[#202F61] dark:text-[#e4e6eb]">
            <span aria-hidden className="inline-block w-4 text-[#90939a]">{offen ? "▾" : "▸"}</span> {teiltyp}
          </span>
          <span className="text-lg font-black tabular-nums text-[#202F61] dark:text-[#e4e6eb]">{stueck} Stück</span>
        </button>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button type="button" aria-label={`${teiltyp}: LogIDs in die Zwischenablage kopieren`} title={exportBereit ? "LogIDs kopieren (eine pro Zeile)" : "Lädt…"} onClick={onCopy} disabled={!exportBereit} className={btn}>📋</button>
          <a href={exportUrl("csv")} aria-label={`${teiltyp} als CSV herunterladen`} title="CSV (alle Spalten)" className={btn}>⬇ CSV</a>
          <a href={exportUrl("xlsx")} aria-label={`${teiltyp} als Excel herunterladen`} title="Excel .xlsx (alle Spalten)" className={btn}>⬇ XLSX</a>
        </div>
      </div>

      {/* Ist / Soll (Mindestbestand) + Eingabe (nur MOBIL_MANAGE) */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3 -mt-1">
        <div className="text-sm">
          {soll == null ? (
            <span className="text-[#90939a] dark:text-[#6b6e73]">Mindestbestand: —</span>
          ) : stueck >= soll ? (
            <span className="font-semibold text-[#2e7d32] dark:text-[#7bc67e]">✓ <span className="tabular-nums">{stueck} / {soll}</span> erfüllt</span>
          ) : (
            <span className="font-semibold text-[#b25e00] dark:text-[#ffb74d]">⚠️ <span className="tabular-nums">{stueck} / {soll}</span> · {soll - stueck} fehlen</span>
          )}
        </div>
        {darfVerwalten && (
          <div className="flex items-center gap-1.5">
            <label htmlFor={sollId} className="text-xs text-[#65676b] dark:text-[#b0b3b8]">Mindestbestand</label>
            <input
              id={sollId}
              type="number"
              min={0}
              inputMode="numeric"
              value={sollInput}
              onChange={(e) => setSollInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") speichern(); }}
              aria-label={`Mindestbestand für ${teiltyp}`}
              className="w-20 px-2 min-h-[44px] rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] text-base tabular-nums outline-none focus:border-[#008BD2]"
            />
            <button
              type="button"
              onClick={speichern}
              disabled={setMin.isPending}
              className="inline-flex items-center justify-center min-h-[44px] px-3 rounded-lg text-sm font-bold text-white disabled:opacity-40"
              style={{ background: AKZENT }}
            >
              {setMin.isPending ? "…" : "Speichern"}
            </button>
          </div>
        )}
      </div>

      {offen && (
        <div className="border-t border-[#ced4da] dark:border-[#3e4042] p-3 bg-[#f7f8fa] dark:bg-[#18191a]">
          {logIdsQ.isLoading ? (
            <Laden />
          ) : !gruppen.length ? (
            <Leer text="Keine LogIDs." />
          ) : (
            <div className="space-y-4">
              {gruppen.map(([colli, rows]) => (
                <div key={colli}>
                  <div className="text-sm font-bold text-[#202F61] dark:text-[#e4e6eb]">
                    Colli {colli} <span className="text-[#65676b] dark:text-[#b0b3b8] font-semibold">· {rows.length} Stück</span>
                  </div>
                  <ul className="mt-1.5 space-y-1.5">
                    {rows.map((r) => {
                      const hatChips = !!r.stellplatz || !!r.farbe || !!r.aan || r.ek != null || !!r.lieferant;
                      const wirdBearbeitet = editLogId === r.logId;
                      return (
                        <li
                          key={r.logId}
                          className="rounded-lg border border-[#e4e6eb] dark:border-[#3a3b3c] bg-white dark:bg-[#242526] px-2.5 py-1.5"
                        >
                          {/* Kopf: LogID prominent, rechts Kompatibilitäts-Hinweis + Bearbeiten */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                              <span className="font-mono text-sm font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">{r.logId}</span>
                              {r.auch.length > 0 && (
                                <span className="text-xs text-[#b25e00] dark:text-[#ffb74d]">auch: {r.auch.join(", ")}</span>
                              )}
                            </div>
                            {darfVerwalten && (
                              <button
                                type="button"
                                onClick={() => setEditLogId(wirdBearbeitet ? null : r.logId)}
                                aria-expanded={wirdBearbeitet}
                                aria-label={`Datensatz ${r.logId} bearbeiten / neu zuordnen`}
                                title="Bearbeiten / neu zuordnen"
                                className="flex-shrink-0 inline-flex items-center justify-center min-h-[36px] min-w-[36px] rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#202F61] dark:text-[#e4e6eb] hover:bg-[#f0f2f5] dark:hover:bg-[#3a3b3c] transition-colors"
                              >
                                ✏️
                              </button>
                            )}
                          </div>
                          {/* Original-Bezeichnung aus ReForm (der CSV-Freitext dieses Teils) */}
                          {r.bezeichnung && (
                            <p className="mt-1 text-xs leading-snug text-[#65676b] dark:text-[#b0b3b8] break-words">
                              <span className="font-semibold text-[#90939a] dark:text-[#8a8d91]">Bezeichnung aus ReForm:</span>{" "}
                              <span className="font-mono text-[#1a1a1a] dark:text-[#e4e6eb]">{r.bezeichnung}</span>
                            </p>
                          )}
                          {/* Detailfelder als abgegrenzte Chips (leere weglassen) */}
                          {hatChips && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {r.stellplatz && <Chip icon="📍" wert={r.stellplatz} />}
                              {r.farbe && <Chip icon="🎨" wert={r.farbe} />}
                              {r.aan && <Chip label="AAN" wert={r.aan} />}
                              {r.ek != null && <Chip label="EK" wert={`${r.ek.toFixed(2).replace(".", ",")} €`} mono />}
                              {r.lieferant && <Chip icon="🏭" wert={r.lieferant} />}
                            </div>
                          )}
                          {wirdBearbeitet && (
                            <LogIdEditor
                              logId={r.logId}
                              hersteller={hersteller}
                              modell={modellName}
                              teiltyp={teiltyp}
                              bezeichnung={r.bezeichnung}
                              bereich={bereich}
                              onClose={() => setEditLogId(null)}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Inline-Editor: bestehenden Datensatz neu zuordnen (wie im Review) ───────────
// Nutzt dieselbe Server-Mutation wie das Review (reviewZuordnen) — setzt Modell +
// Teiltyp (+ optional angepasste Bezeichnung), markiert das Teil MANUELL und lernt
// optional den Wortlaut als Alias. Für EINE LogID (ein physischer Datensatz).
function LogIdEditor({
  logId, hersteller, modell, teiltyp, bezeichnung, bereich, onClose,
}: {
  logId:       string;
  hersteller:  string;
  modell:      string;
  teiltyp:     string;
  bezeichnung: string;
  bereich:     MobilBereich;
  onClose:     () => void;
}) {
  const { show } = useToast();
  const utils = api.useUtils();
  const katalogQ = api.mobil.katalog.useQuery();

  const [h, setH] = useState(hersteller);
  const [m, setM] = useState(modell);
  const [t, setT] = useState(teiltyp);
  const [b, setB] = useState(bezeichnung);
  const [aliasLernen, setAliasLernen] = useState(true);
  const [neuTeiltyp, setNeuTeiltyp] = useState(false); // "➕ Neuer Teiltyp…" gewählt

  const modellVorschlaege = useMemo(
    () => (katalogQ.data?.modelle ?? []).filter((mm) => !h || mm.hersteller === h).map((mm) => mm.modell),
    [katalogQ.data, h],
  );
  const teiltypen = katalogQ.data?.teiltypen ?? [];

  const speichern = api.mobil.reviewZuordnen.useMutation({
    onSuccess: (r) => {
      show(`✅ Datensatz zugeordnet` + (r.aliasGelernt > 0 ? " · Wortlaut gemerkt" : ""), "success");
      void utils.mobil.teileProModell.invalidate();
      void utils.mobil.logIdsProTeiltyp.invalidate();
      void utils.mobil.hersteller.invalidate({ bereich });
      void utils.mobil.modelle.invalidate();
      void utils.mobil.katalog.invalidate(); // neuer Teiltyp taucht künftig in der Auswahl auf
      void utils.mobil.mobilUnterMindestbestand.invalidate();
      void utils.mobil.stats.invalidate({ bereich });
      onClose();
    },
    onError: (e) => show(e.message, "error"),
  });

  const bezeichnungGeaendert = b.trim() !== bezeichnung.trim();
  const kann = !!h.trim() && !!m.trim() && !!t.trim() && !speichern.isPending;
  const listId = `edit-modelle-${logId.replace(/[^a-z0-9]/gi, "")}`;
  const feld = "w-full px-2.5 min-h-[44px] rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] text-sm outline-none focus:border-[#008BD2]";

  function save() {
    if (!kann) return;
    speichern.mutate({
      logIds:     [logId],
      hersteller: h.trim(),
      modell:     m.trim(),
      teiltyp:    t.trim(),
      ...(bezeichnungGeaendert && b.trim() ? { bezeichnung: b.trim() } : {}),
      aliasLernen,
    });
  }

  return (
    <div className="mt-2 rounded-lg border border-[#008BD2]/40 bg-[#008BD2]/5 p-3 space-y-2">
      <div className="text-xs font-semibold text-[#008BD2] dark:text-[#45bdff]">✏️ Datensatz bearbeiten / neu zuordnen</div>

      <label className="block">
        <span className="block text-xs font-semibold text-[#1a1a1a] dark:text-[#e4e6eb] mb-0.5">Bezeichnung</span>
        <textarea
          value={b}
          onChange={(e) => setB(e.target.value)}
          rows={2}
          className="w-full px-2.5 py-1.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] text-sm font-mono leading-snug outline-none focus:border-[#008BD2] resize-y"
        />
      </label>

      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block">
          <span className="block text-xs font-semibold text-[#1a1a1a] dark:text-[#e4e6eb] mb-0.5">Hersteller</span>
          <select value={h} onChange={(e) => setH(e.target.value)} className={feld}>
            <option value="">wählen</option>
            {HERSTELLER.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-[#1a1a1a] dark:text-[#e4e6eb] mb-0.5">Modell</span>
          <input
            list={listId}
            value={m}
            onChange={(e) => setM(e.target.value)}
            placeholder="Modell wählen oder eingeben"
            className={feld}
          />
          <datalist id={listId}>{modellVorschlaege.map((x) => <option key={x} value={x} />)}</datalist>
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-[#1a1a1a] dark:text-[#e4e6eb] mb-0.5">Teiltyp</span>
          <select
            value={neuTeiltyp ? "__neu__" : t}
            onChange={(e) => {
              if (e.target.value === "__neu__") { setNeuTeiltyp(true); setT(""); }
              else { setNeuTeiltyp(false); setT(e.target.value); }
            }}
            className={feld}
          >
            <option value="">wählen</option>
            {teiltypen.map((x) => <option key={x} value={x}>{x}</option>)}
            <option value="__neu__">➕ Neuer Teiltyp…</option>
          </select>
          {neuTeiltyp && (
            <input
              autoFocus
              value={t}
              onChange={(e) => setT(e.target.value)}
              placeholder="z. B. Back Glass"
              className={`${feld} mt-1`}
            />
          )}
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-[#1a1a1a] dark:text-[#e4e6eb]">
          <input type="checkbox" checked={aliasLernen} onChange={(e) => setAliasLernen(e.target.checked)} className="w-4 h-4 accent-[#008BD2]" />
          Wortlaut merken (künftige Importe erkennen ihn automatisch)
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center min-h-[40px] px-3 rounded-lg text-sm font-bold border border-[#ced4da] dark:border-[#3e4042] text-[#202F61] dark:text-[#e4e6eb] hover:bg-[#f0f2f5] dark:hover:bg-[#3a3b3c] transition-colors"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!kann}
            className="inline-flex items-center justify-center min-h-[40px] px-4 rounded-lg text-white text-sm font-bold disabled:opacity-40 transition-colors"
            style={{ background: AKZENT }}
          >
            {speichern.isPending ? "Speichert…" : "Speichern"}
          </button>
        </div>
      </div>

      {katalogQ.isLoading && <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">⏳ Lade Auswahllisten…</div>}
    </div>
  );
}

// ── Kleine Helfer ──────────────────────────────────────────────────────────────
// Detail-Chip: kleines abgegrenztes Kästchen (Label grau/klein + Wert). Lange Werte
// (z. B. Lieferant) werden gekürzt; voller Text per title.
function Chip({ icon, label, wert, mono }: { icon?: string; label?: string; wert: string; mono?: boolean }) {
  return (
    <span
      className="inline-flex items-baseline gap-1 max-w-full rounded-md border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#3a3b3c] px-2 py-0.5 text-xs"
      title={label ? `${label}: ${wert}` : wert}
    >
      {icon && <span aria-hidden className="flex-shrink-0">{icon}</span>}
      {label && <span className="flex-shrink-0 text-[#90939a] dark:text-[#8a8d91]">{label}</span>}
      <span className={`truncate font-medium text-[#1a1a1a] dark:text-[#e4e6eb] ${mono ? "tabular-nums" : ""}`}>{wert}</span>
    </span>
  );
}

function Schrittkopf({ nr, text }: { nr: number; text: string }) {
  return (
    <h2 className="flex items-center gap-2 text-lg font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
      <span
        className="inline-flex items-center justify-center w-7 h-7 rounded-full text-white text-sm font-black flex-shrink-0"
        style={{ background: AKZENT }}
        aria-hidden
      >
        {nr}
      </span>
      {text}
    </h2>
  );
}

function Laden({ text = "Lade…" }: { text?: string }) {
  return <div role="status" className="text-base text-[#65676b] dark:text-[#b0b3b8] py-3">⏳ {text}</div>;
}

function Leer({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[#ced4da] dark:border-[#3e4042] p-5 text-base text-[#65676b] dark:text-[#b0b3b8]">
      {text}
    </div>
  );
}

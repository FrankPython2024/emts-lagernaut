"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { useSocket } from "@/hooks/useSocket";
import { EVENTS } from "@/modules/realtime/events";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { formatLogId } from "@/lib/pickup/logId";
import { exportPickupCsv, printPickupBericht } from "@/lib/pickup/bericht";
import { parsePickupCsv } from "@/lib/pickup/csvImport";
import { parseColliPruefungCsv } from "@/lib/pickup/colliPruefung";

function PosStatusBadge({ status }: { status: string }) {
  const gefunden = status === "GEFUNDEN";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${gefunden
      ? "bg-[#04B475]/10 text-[#04B475]"
      : "bg-[#65676b]/10 text-[#65676b] dark:text-[#b0b3b8]"}`}>
      {gefunden ? "Gefunden" : "Offen"}
    </span>
  );
}

function fmtDatum(d: Date | string): string {
  return new Date(d).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── Colli-Export (gefundene LogIDs kopieren / als CSV laden) ────────────────────
// Reine Frontend-Helfer: Daten liegen schon im Client. Nur GEFUNDENE Positionen.

type ColliPos = { logId: string; status: string; stellplatz: string | null; bezeichnung: string | null };

// CSV-Feld für DE-Excel: bei Semikolon/Anführungszeichen/Zeilenumbruch quoten.
function csvFeld(v: string): string {
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// Clipboard mit Fallback für unsichere Kontexte (HTTP) ohne navigator.clipboard.
async function inZwischenablage(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* Fallback unten */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.setAttribute("readonly", "");
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function ColliExportButtons({ colliNr, items }: { colliNr: string; items: ColliPos[] }) {
  const { show } = useToast();
  const [kopiert, setKopiert] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const gefundene = items.filter((p) => p.status === "GEFUNDEN");
  const leer = gefundene.length === 0;
  const labelColli = colliNr || "ohne-colli";

  async function handleKopieren() {
    const text = gefundene.map((p) => formatLogId(p.logId)).join("\n");
    const ok = await inZwischenablage(text);
    if (ok) {
      setKopiert(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setKopiert(false), 2000);
    } else {
      show("Kopieren fehlgeschlagen", "error");
    }
  }

  function handleCsv() {
    const zeilen = [
      "LogID;Stellplatz;Bezeichnung",
      ...gefundene.map((p) =>
        [formatLogId(p.logId), p.stellplatz ?? "", p.bezeichnung ?? ""].map(csvFeld).join(";"),
      ),
    ];
    // BOM für DE-Excel-Umlaute.
    const blob = new Blob(["﻿" + zeilen.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `colli_${labelColli}_gefunden.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const btnBasis =
    "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold whitespace-nowrap border transition-colors " +
    "border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] " +
    "hover:bg-[#008BD2]/10 hover:text-[#008BD2] dark:hover:text-[#45bdff] " +
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#008BD2] " +
    "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[#65676b]";

  return (
    <>
      <button
        type="button"
        onClick={handleKopieren}
        disabled={leer}
        aria-label={`Gefundene LogIDs aus Colli ${labelColli} kopieren`}
        className={btnBasis}
      >
        {kopiert ? "Kopiert ✓" : "📋 Kopieren"}
      </button>
      <button
        type="button"
        onClick={handleCsv}
        disabled={leer}
        aria-label={`Gefundene LogIDs aus Colli ${labelColli} als CSV herunterladen`}
        className={btnBasis}
      >
        ⬇ CSV
      </button>
    </>
  );
}

export default function PickupDetailPage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfManage = has("PICKUP_MANAGE");

  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const router = useRouter();
  const { show } = useToast();
  const utils = api.useUtils();

  const [loeschDialog, setLoeschDialog] = useState(false);

  const { data, isLoading, error } = api.pickup.details.useQuery(
    { id },
    { enabled: !permsLoading && darfManage && Number.isInteger(id) && id > 0 },
  );

  const loeschen = api.pickup.loeschen.useMutation({
    onSuccess: () => { show("Pickup-Auftrag gelöscht", "success"); router.push("/admin/pickup"); },
    onError:   (e) => show(e.message, "error"),
  });

  const wiederOeffnen = api.pickup.wiederOeffnen.useMutation({
    onSuccess: () => { show("Auftrag wieder geöffnet", "success"); utils.pickup.details.invalidate({ id }); },
    onError:   (e) => show(e.message, "error"),
  });

  // Live-Fortschritt (Socket): nur für DIESE id die Details invalidieren → ohne Reload.
  const { on, off, connected } = useSocket();
  useEffect(() => {
    const h = (d: unknown) => {
      const p = d as { auftragId: number };
      if (p.auftragId === id) void utils.pickup.details.invalidate({ id });
    };
    on(EVENTS.PICKUP_FORTSCHRITT, h);
    return () => off(EVENTS.PICKUP_FORTSCHRITT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, id]);

  // Positionen nach Colli gruppieren; Colli natürlich aufsteigend (ohne Colli zuletzt),
  // innerhalb nach Stellplatz, dann LogId.
  const gruppen = useMemo(() => {
    const positionen = data?.positionen ?? [];
    const map = new Map<string, typeof positionen>();
    for (const p of positionen) {
      const key = p.colli ?? "";
      const arr = map.get(key);
      if (arr) arr.push(p); else map.set(key, [p]);
    }
    const out = [...map.entries()].map(([colli, items]) => ({ colli, items }));
    out.sort((a, b) => {
      if (a.colli === "" && b.colli === "") return 0;
      if (a.colli === "") return 1;
      if (b.colli === "") return -1;
      return a.colli.localeCompare(b.colli, "de", { numeric: true });
    });
    for (const g of out) {
      g.items.sort((x, y) => {
        const s = (x.stellplatz ?? "").localeCompare(y.stellplatz ?? "", "de", { numeric: true });
        return s !== 0 ? s : x.logId.localeCompare(y.logId, "de", { numeric: true });
      });
    }
    return out;
  }, [data]);

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
  if (isLoading) return <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">Lade Auftrag…</div>;
  if (error || !data) {
    return (
      <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">
        Auftrag nicht gefunden. <button onClick={() => router.push("/admin/pickup")} className="text-[#008BD2] font-semibold">Zurück zur Liste</button>
      </div>
    );
  }

  const gesamt        = data.positionen.length;
  const gefunden      = data.positionen.filter((p) => p.status === "GEFUNDEN").length;
  const offen         = gesamt - gefunden;
  const abgeschlossen = data.status === "abgeschlossen";
  const nichtGefundene = data.positionen.filter((p) => p.status !== "GEFUNDEN");
  const pct           = gesamt > 0 ? Math.round((gefunden / gesamt) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* Kopf */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <button onClick={() => router.push("/admin/pickup")} className="text-[#65676b] hover:text-[#008BD2] text-sm mb-1">← Zurück zur Liste</button>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-black text-[#202F61] dark:text-[#e4e6eb] truncate">{data.name}</h1>
            {abgeschlossen && (
              nichtGefundene.length === 0
                ? <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-[#04B475]/10 text-[#04B475]">Vollständig</span>
                : <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold" style={{ background: "rgba(186,117,23,0.15)", color: "#BA7517" }}>Nicht komplett</span>
            )}
          </div>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
            {data.status === "offen" ? "Offen" : "Abgeschlossen"} · {fmtDatum(data.createdAt)} · {data.ersteller?.kuerzel ?? data.ersteller?.name ?? "—"}
          </p>
          {data.bemerkung && (
            <div className="mt-2 inline-flex items-start gap-2 px-3 py-2 rounded-xl bg-[#008BD2]/10 text-[#202F61] dark:text-[#e4e6eb] text-sm">
              <span aria-hidden>📝</span>
              <span className="font-semibold whitespace-pre-wrap break-words">{data.bemerkung}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {data.status === "offen" ? (
            <Link
              href={`/pickup/${id}`}
              className="inline-flex items-center gap-2 px-5 rounded-xl bg-[#008BD2] text-white text-sm font-bold hover:bg-[#0077b5] transition-colors shadow-sm min-h-[56px]"
            >
              ▶ Scannen
            </Link>
          ) : (
            <>
              <button
                onClick={() => exportPickupCsv(data)}
                className="inline-flex items-center gap-2 px-4 rounded-xl bg-[#008BD2] text-white text-sm font-bold hover:bg-[#0077b5] transition-colors shadow-sm min-h-[56px]"
              >
                ⬇ CSV-Export
              </button>
              <button
                onClick={() => printPickupBericht(data)}
                className="inline-flex items-center gap-2 px-4 rounded-xl border border-[#008BD2]/40 text-[#008BD2] dark:text-[#45bdff] text-sm font-bold hover:bg-[#008BD2]/10 transition-colors min-h-[56px]"
              >
                🖨️ Drucken
              </button>
              <button
                onClick={() => wiederOeffnen.mutate({ id })}
                disabled={wiederOeffnen.isPending}
                className="inline-flex items-center gap-2 px-4 rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] text-sm font-bold hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] disabled:opacity-50 transition-colors min-h-[56px]"
              >
                {wiederOeffnen.isPending ? "…" : "↩ Wieder öffnen"}
              </button>
            </>
          )}
          <button
            onClick={() => setLoeschDialog(true)}
            className="inline-flex items-center gap-2 px-4 rounded-xl border border-[#fa3e3e]/40 text-[#fa3e3e] text-sm font-bold hover:bg-[#fa3e3e]/10 transition-colors min-h-[56px]"
          >
            🗑️ Löschen
          </button>
        </div>
      </div>

      {/* Abschlussbericht (abgeschlossen) bzw. einfache Zähler (offen) */}
      {abgeschlossen ? (
        <div className="bg-white dark:bg-[#242526] rounded-2xl border-2 border-[#04B475]/40 shadow-sm overflow-hidden">
          <div className="px-5 py-3 bg-[#04B475]/10 border-b border-[#04B475]/30 flex items-center justify-between gap-2 flex-wrap">
            <h2 className="font-black text-sm uppercase tracking-wider text-[#04713f] dark:text-[#04B475]">✓ Abschlussbericht</h2>
            <span className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
              Abgeschlossen: {data.abgeschlossenAm ? fmtDatum(data.abgeschlossenAm) : "—"}
              {(data.abschliesser?.kuerzel || data.abschliesser?.name) ? ` · ${data.abschliesser?.kuerzel ?? data.abschliesser?.name}` : ""}
            </span>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Gesamt",         value: gesamt,                color: "text-[#202F61] dark:text-[#e4e6eb]" },
                { label: "Gefunden",       value: gefunden,              color: "text-[#04B475]" },
                { label: "Nicht gefunden", value: nichtGefundene.length, color: "text-[#b3261e]" },
                { label: "Quote",          value: `${pct}%`,             color: "text-[#202F61] dark:text-[#e4e6eb]" },
              ].map((k) => (
                <div key={k.label} className="bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl p-4 text-center">
                  <div className={`text-2xl font-black ${k.color}`}>{k.value}</div>
                  <div className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mt-0.5">{k.label}</div>
                </div>
              ))}
            </div>

            {nichtGefundene.length > 0 && (
              <div className="rounded-xl border border-[#fa3e3e]/30 overflow-hidden">
                <div className="px-4 py-2 bg-[#fa3e3e]/10 text-sm font-bold text-[#b3261e]">
                  ✗ Nicht gefunden ({nichtGefundene.length})
                </div>
                <div className="divide-y divide-[#f0f2f5] dark:divide-[#3e4042]">
                  {nichtGefundene.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 px-4 py-2 flex-wrap gap-y-0.5 text-sm">
                      <span className="font-mono font-bold text-[#202F61] dark:text-[#e4e6eb] min-w-[110px]">{formatLogId(p.logId)}</span>
                      <span className="text-xs text-[#65676b] dark:text-[#b0b3b8] min-w-[70px]">Colli {p.colli ?? "—"}</span>
                      <span className="text-xs text-[#65676b] dark:text-[#b0b3b8] min-w-[70px]">{p.stellplatz ?? "—"}</span>
                      <span className="flex-1 min-w-0 truncate text-[#1a1a1a] dark:text-[#e4e6eb]" title={p.bezeichnung ?? ""}>{p.bezeichnung ?? "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Gesamt",   value: gesamt,   color: "text-[#202F61] dark:text-[#e4e6eb]" },
            { label: "Offen",    value: offen,    color: "text-[#65676b] dark:text-[#b0b3b8]" },
            { label: "Gefunden", value: gefunden, color: "text-[#04B475]" },
          ].map((k) => (
            <div key={k.label} className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] p-4 text-center">
              <div className={`text-2xl font-black ${k.color}`}>{k.value}</div>
              <div className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mt-0.5">{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* CSV-Update (Merge): neue Positionen dazu, gescannte bleiben erhalten.
          Nur für noch offene Aufträge — abgeschlossene/archivierte nicht mehr ändern. */}
      {!abgeschlossen && (
        <CsvUpdateCard
          auftragId={id}
          typ={data.typ}
          bestehendeLogIds={new Set(data.positionen.map((p) => p.logId))}
          onDone={() => utils.pickup.details.invalidate({ id })}
        />
      )}

      {/* Positionen gruppiert nach Colli */}
      <div className="space-y-4">
        {gruppen.map((g) => (
          <div key={g.colli || "__ohne__"} className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-5 py-3 bg-[#f0f2f5] dark:bg-[#18191a] border-b border-[#ced4da] dark:border-[#3e4042]">
              <h2 className="font-black text-sm text-[#202F61] dark:text-[#e4e6eb]">
                📦 Colli {g.colli || "— (ohne Colli)"}
              </h2>
              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                <ColliExportButtons colliNr={g.colli} items={g.items} />
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#008BD2]/10 text-[#008BD2] dark:text-[#45bdff]">
                  {g.items.filter((p) => p.status === "GEFUNDEN").length}/{g.items.length} gefunden
                </span>
              </div>
            </div>
            <div className="divide-y divide-[#f0f2f5] dark:divide-[#3e4042]">
              {g.items.map((p) => (
                <div key={p.id} className="flex items-center gap-4 px-5 py-3 flex-wrap gap-y-1">
                  <div className="font-mono font-black text-base text-[#202F61] dark:text-[#e4e6eb] min-w-[120px]">
                    {formatLogId(p.logId)}
                  </div>
                  <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] min-w-[90px]">
                    {p.stellplatz ?? "—"}
                  </div>
                  <div className="flex-1 min-w-0 text-sm text-[#1a1a1a] dark:text-[#e4e6eb] truncate" title={p.bezeichnung ?? ""}>
                    {p.bezeichnung ?? "—"}
                  </div>
                  <PosStatusBadge status={p.status} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Löschen-Bestätigung */}
      {loeschDialog && (
        <div role="dialog" aria-modal="true" aria-labelledby="pickup-del-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !loeschen.isPending && setLoeschDialog(false)}>
          <div className="bg-white dark:bg-[#242526] rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-4 text-center space-y-3">
              <div className="text-4xl">🗑️</div>
              <h2 id="pickup-del-title" className="font-black text-lg text-[#202F61] dark:text-[#e4e6eb]">Pickup-Auftrag löschen?</h2>
              <div className="px-4 py-3 bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
                <strong>{data.name}</strong><br />
                <span className="text-xs text-[#65676b] dark:text-[#b0b3b8]">{gesamt} Positionen werden unwiderruflich gelöscht.</span>
              </div>
            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button
                onClick={() => setLoeschDialog(false)}
                disabled={loeschen.isPending}
                className="flex-1 text-sm text-[#65676b] dark:text-[#b0b3b8] font-semibold border border-[#ced4da] dark:border-[#3e4042] rounded-xl hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors min-h-[56px] disabled:opacity-50"
              >
                Abbrechen
              </button>
              <button
                onClick={() => loeschen.mutate({ id })}
                disabled={loeschen.isPending}
                className="flex-1 bg-[#fa3e3e] text-white text-sm font-bold rounded-xl hover:bg-red-600 disabled:opacity-50 transition-colors min-h-[56px]"
              >
                {loeschen.isPending ? "Lösche…" : "Endgültig löschen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── CSV-Update (Merge) ─────────────────────────────────────────────────────────
// Lädt eine neue CSV (gleiches AfB-Format wie beim Anlegen) in einen bestehenden
// Auftrag. Vereinigung: neue Positionen kommen dazu, bereits gescannte/gefundene
// bleiben unverändert, nichts wird entfernt. Geparst wird nach dem Auftragstyp;
// passt die CSV nicht (0 Positionen), gibt es eine klare Fehlermeldung statt
// Teil-Import. Die Vorschau-Statistik wird lokal aus dem aktuellen Stand berechnet.

type MergePos = { logId: string; colli: string | null; stellplatz: string | null; bezeichnung: string | null };
type MergeVorschau = { positionen: MergePos[]; neu: number; bereitsVorhanden: number; nichtInCsv: number };

// COLLI → bezeichnung: "Art · N Teile" (analog Anlege-Seite).
function colliBezeichnung(c: { art: string | null; anzahlTeile: string | null }): string | null {
  return [c.art, c.anzahlTeile ? `${c.anzahlTeile} Teile` : null].filter(Boolean).join(" · ") || null;
}

function CsvUpdateCard({
  auftragId, typ, bestehendeLogIds, onDone,
}: {
  auftragId: number;
  typ: "LOGID" | "COLLI";
  bestehendeLogIds: Set<string>;
  onDone: () => void;
}) {
  const { show } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName]   = useState<string | null>(null);
  const [parsing, setParsing]     = useState(false);
  const [fehler, setFehler]       = useState<string | null>(null);
  const [vorschau, setVorschau]   = useState<MergeVorschau | null>(null);

  const aktualisieren = api.pickup.auftragAktualisieren.useMutation({
    onSuccess: (r) => {
      show(`✅ Aktualisiert: ${r.neu} neu, ${r.bereitsVorhanden} bereits vorhanden, ${r.nichtInCsvBehalten} behalten · jetzt ${r.gesamtNachher}`, "success");
      reset();
      onDone();
    },
    onError: (e) => show(e.message, "error"),
  });

  function reset() {
    setFileName(null); setVorschau(null); setFehler(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  // Vereinigungs-Statistik lokal aus dem aktuellen Stand (kein Roundtrip vor dem Anwenden).
  function baueVorschau(positionen: MergePos[]): MergeVorschau {
    const incoming = new Set(positionen.map((p) => p.logId).filter(Boolean));
    let neu = 0, bereitsVorhanden = 0;
    for (const lid of incoming) {
      if (bestehendeLogIds.has(lid)) bereitsVorhanden += 1; else neu += 1;
    }
    let nichtInCsv = 0;
    for (const lid of bestehendeLogIds) if (!incoming.has(lid)) nichtInCsv += 1;
    return { positionen, neu, bereitsVorhanden, nichtInCsv };
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) { show("Nur CSV-Dateien erlaubt.", "error"); return; }
    setFileName(file.name);
    setVorschau(null); setFehler(null);
    setParsing(true);
    try {
      let positionen: MergePos[];
      if (typ === "COLLI") {
        const r = await parseColliPruefungCsv(file);
        positionen = r.stellplaetze.flatMap((sp) =>
          sp.collis.map((c) => ({
            logId:       c.nummerDigits,
            colli:       c.nummer,
            stellplatz:  c.stellplatz,
            bezeichnung: colliBezeichnung(c),
          })),
        );
      } else {
        const r = await parsePickupCsv(file);
        positionen = r.positionen.map((p) => ({
          logId: p.logId, colli: p.colli, stellplatz: p.stellplatz, bezeichnung: p.bezeichnung,
        }));
      }

      if (positionen.length === 0) {
        setFehler(
          typ === "COLLI"
            ? "Diese CSV passt nicht zu einem Colli-Auftrag (keine Spalte 'Nummer' / keine gültigen Collis gefunden). Es wurde nichts importiert."
            : "Diese CSV passt nicht zu einem LogID-Auftrag (keine Spalte 'LogId' / keine gültigen Positionen gefunden). Es wurde nichts importiert.",
        );
        return;
      }
      setVorschau(baueVorschau(positionen));
    } catch {
      setFehler("CSV konnte nicht gelesen werden.");
    } finally {
      setParsing(false);
    }
  }

  const akzent = typ === "COLLI" ? "#7c3aed" : "#008BD2";
  const kannAnwenden = !!vorschau && vorschau.neu > 0 && !aktualisieren.isPending;

  return (
    <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-5 space-y-3">
      <div>
        <h2 className="font-black text-sm uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8]">🔄 Per CSV aktualisieren</h2>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
          Neue {typ === "COLLI" ? "Stellplatz-Export" : "Geräte-Export"}-CSV laden. Neue Positionen kommen dazu.
          <strong> Bereits gescannte bleiben erhalten, es wird nichts entfernt.</strong>
        </p>
      </div>

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

      {parsing && <div className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Lese CSV…</div>}

      {fehler && (
        <div className="text-sm rounded-xl px-4 py-3 bg-[#fa3e3e]/10 text-[#b3261e] dark:text-[#ff8a8a]">
          ⚠️ {fehler}
        </div>
      )}

      {vorschau && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="px-3 py-1.5 rounded-lg bg-[#04B475]/10 text-[#04B475] font-bold">{vorschau.neu} neu</span>
            <span className="px-3 py-1.5 rounded-lg bg-[#f0f2f5] dark:bg-[#18191a] text-[#65676b] dark:text-[#b0b3b8] font-semibold">{vorschau.bereitsVorhanden} bereits vorhanden</span>
            <span className="px-3 py-1.5 rounded-lg bg-[#f0f2f5] dark:bg-[#18191a] text-[#65676b] dark:text-[#b0b3b8] font-semibold">{vorschau.nichtInCsv} nicht in CSV (bleiben)</span>
          </div>
          {vorschau.neu === 0 && (
            <div className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Keine neuen Positionen. Alle aus der CSV sind bereits im Auftrag.</div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={reset}
              disabled={aktualisieren.isPending}
              className="px-4 rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] text-sm font-bold hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] disabled:opacity-50 transition-colors min-h-[56px]"
            >
              Verwerfen
            </button>
            <button
              type="button"
              onClick={() => vorschau && aktualisieren.mutate({ auftragId, positionen: vorschau.positionen })}
              disabled={!kannAnwenden}
              className="inline-flex items-center gap-2 px-6 rounded-xl text-white text-sm font-bold disabled:opacity-40 transition-colors shadow-sm min-h-[56px]"
              style={{ background: akzent }}
            >
              {aktualisieren.isPending ? "Aktualisiere…" : `${vorschau.neu} Position${vorschau.neu === 1 ? "" : "en"} hinzufügen`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

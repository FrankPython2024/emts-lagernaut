"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/trpc/react";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/components/ui/Toast";

const AKZENT = "#008BD2";

type StatusFilter = "ALLE" | "NEU" | "BEDARF" | "IN_BEARBEITUNG" | "ABGESCHLOSSEN" | "STORNIERT";
type BereichFilter = "ALLE" | "STANDARD" | "DIGITAL_EDUCATION";

const STATUS_CFG: Record<string, { text: string; color: string; bg: string }> = {
  NEU:            { text: "Neu",            color: "#005fa3", bg: "#dbeafe" },
  BEDARF:         { text: "Bedarf",         color: "#92400e", bg: "#fef3c7" },
  IN_BEARBEITUNG: { text: "In Bearbeitung", color: "#92400e", bg: "#fef3c7" },
  ABGESCHLOSSEN:  { text: "Abgeschlossen",  color: "#15803d", bg: "#dcfce7" },
  STORNIERT:      { text: "Storniert",      color: "#b91c1c", bg: "#fee2e2" },
};

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "ALLE",           label: "Alle" },
  { key: "NEU",            label: "Neu" },
  { key: "BEDARF",         label: "Bedarf" },
  { key: "IN_BEARBEITUNG", label: "In Arbeit" },
  { key: "ABGESCHLOSSEN",  label: "Erledigt" },
  { key: "STORNIERT",      label: "Storniert" },
];

const BEREICH_LABEL = (b: string) => (b === "DIGITAL_EDUCATION" ? "digital Education" : "Standard");

type AnfrageZeile = {
  id: number; datum: Date | string; techniker: string; bereich: string;
  modellId: number; hersteller: string; modell: string; teiltyp: string;
  menge: number; kommentar: string | null; status: string;
  bearbeitetVon: string | null; erledigtLogId: string | null;
};

export default function MobilAnfragenAdminPage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfSehen     = has("MOBIL_VIEW");
  const darfVerwalten = has("MOBIL_MANAGE");

  const { show } = useToast();
  const utils = api.useUtils();

  const [status, setStatus]   = useState<StatusFilter>("ALLE");
  const [bereich, setBereich] = useState<BereichFilter>("ALLE");
  const [ausgeben, setAusgeben] = useState<AnfrageZeile | null>(null);

  const listeQ = api.mobilAnfrage.adminListe.useQuery(
    { status, bereich, offset: 0, limit: 100 },
    { enabled: darfSehen },
  );

  const setStatusM = api.mobilAnfrage.setStatus.useMutation({
    onSuccess: () => { show("Status aktualisiert", "success"); void utils.mobilAnfrage.adminListe.invalidate(); },
    onError: (e) => show(e.message, "error"),
  });

  function neuerStatus(id: number, s: "IN_BEARBEITUNG" | "STORNIERT") {
    setStatusM.mutate({ id, status: s });
  }

  if (permsLoading) {
    return <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Lade Berechtigungen…</div>;
  }
  if (!darfSehen) {
    return <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Kein Zugriff (MOBIL_VIEW erforderlich).</div>;
  }

  const tabBtn = (aktiv: boolean) =>
    `px-3 min-h-[40px] rounded-lg text-sm font-bold transition-colors ${aktiv ? "text-white" : "text-[#202F61] dark:text-[#e4e6eb] hover:bg-[#f0f2f5] dark:hover:bg-[#3a3b3c]"}`;
  const aktBtn = "inline-flex items-center justify-center min-h-[40px] px-3 rounded-lg text-sm font-bold border border-[#ced4da] dark:border-[#3e4042] text-[#202F61] dark:text-[#e4e6eb] hover:bg-[#f0f2f5] dark:hover:bg-[#3a3b3c] disabled:opacity-40 transition-colors";

  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-4 flex items-center gap-3 flex-wrap">
        <Link href="/admin/mobil" className="text-sm font-semibold text-[#65676b] hover:text-[#008BD2] dark:text-[#b0b3b8]">← Mobil-Ersatzteile</Link>
        <h1 className="text-2xl font-black text-[#202F61] dark:text-[#e4e6eb]">🔔 Mobil-Anfragen</h1>
        {listeQ.data && listeQ.data.offen > 0 && (
          <span className="rounded-full bg-[#008BD2] text-white text-xs font-bold px-2.5 py-1">{listeQ.data.offen} offen</span>
        )}
      </header>

      {/* Filter */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-1">
          {STATUS_TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setStatus(t.key)} className={tabBtn(status === t.key)}
              style={status === t.key ? { background: AKZENT } : undefined}>{t.label}</button>
          ))}
        </div>
        <div className="flex gap-1 rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-1">
          {(["ALLE", "STANDARD", "DIGITAL_EDUCATION"] as BereichFilter[]).map((b) => (
            <button key={b} type="button" onClick={() => setBereich(b)} className={tabBtn(bereich === b)}
              style={bereich === b ? { background: AKZENT } : undefined}>
              {b === "ALLE" ? "Alle Bereiche" : BEREICH_LABEL(b)}
            </button>
          ))}
        </div>
      </div>

      {listeQ.isLoading ? (
        <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Lade…</div>
      ) : !listeQ.data || listeQ.data.zeilen.length === 0 ? (
        <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Keine Anfragen.</div>
      ) : (
        <div className="rounded-2xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] shadow-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs font-bold uppercase tracking-wide text-[#90939a] border-b border-[#ced4da] dark:border-[#3e4042]">
                <th className="px-4 py-3">Datum</th>
                <th className="px-4 py-3">Techniker</th>
                <th className="px-4 py-3">Teil</th>
                <th className="px-4 py-3 text-right">Menge</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {listeQ.data.zeilen.map((r) => {
                const cfg = STATUS_CFG[r.status] ?? STATUS_CFG.NEU!;
                const offen = r.status === "NEU" || r.status === "BEDARF" || r.status === "IN_BEARBEITUNG";
                return (
                  <tr key={r.id} className="border-b border-[#f0f2f5] dark:border-[#3a3b3c] last:border-0 align-top">
                    <td className="px-4 py-3 text-sm whitespace-nowrap text-[#65676b] dark:text-[#b0b3b8]">
                      {new Date(r.datum).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-[#202F61] dark:text-[#e4e6eb]">{r.techniker}</td>
                    <td className="px-4 py-3 text-sm">
                      <div className="font-bold text-[#202F61] dark:text-[#e4e6eb]">{r.modell} <span className="font-medium text-[#65676b] dark:text-[#b0b3b8]">· {r.teiltyp}</span></div>
                      <div className="text-xs text-[#90939a]">{BEREICH_LABEL(r.bereich)}{r.kommentar ? ` · ${r.kommentar}` : ""}{r.erledigtLogId ? ` · ausgegeben: ${r.erledigtLogId}` : ""}</div>
                    </td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums">{r.menge}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-bold rounded-full px-2.5 py-1" style={{ color: cfg.color, background: cfg.bg }}>{cfg.text}</span>
                    </td>
                    <td className="px-4 py-3">
                      {darfVerwalten && offen ? (
                        <div className="flex flex-wrap gap-1.5 justify-end">
                          {r.status !== "IN_BEARBEITUNG" && (
                            <button className={aktBtn} disabled={setStatusM.isPending} onClick={() => neuerStatus(r.id, "IN_BEARBEITUNG")}>In Arbeit</button>
                          )}
                          <button className={aktBtn} style={{ borderColor: "#04B475", color: "#04B475" }} onClick={() => setAusgeben(r)}>Ausgeben</button>
                          <button className={aktBtn} style={{ borderColor: "#fa3e3e", color: "#fa3e3e" }} disabled={setStatusM.isPending} onClick={() => neuerStatus(r.id, "STORNIERT")}>Storno</button>
                        </div>
                      ) : (
                        <div className="text-right text-xs text-[#90939a]">{r.bearbeitetVon ? `von ${r.bearbeitetVon}` : "—"}</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {ausgeben && (
        <AusgebenModal
          anfrage={ausgeben}
          onClose={() => setAusgeben(null)}
          onDone={() => { setAusgeben(null); void utils.mobilAnfrage.adminListe.invalidate(); }}
          show={show}
        />
      )}
    </div>
  );
}

// Modal: verfügbare LogIDs auflisten → eine ausgeben (markiert das Teil ausgeschieden),
// oder ohne Teil erledigen (z.B. BEDARF).
function AusgebenModal({
  anfrage, onClose, onDone, show,
}: {
  anfrage: AnfrageZeile;
  onClose: () => void;
  onDone: () => void;
  show: (msg: string, typ?: "success" | "error" | "info" | "warning") => void;
}) {
  const bereich = anfrage.bereich === "DIGITAL_EDUCATION" ? "DIGITAL_EDUCATION" : "STANDARD";
  const teileQ = api.mobilAnfrage.verfuegbareTeile.useQuery({ modellId: anfrage.modellId, teiltyp: anfrage.teiltyp, bereich });
  const erledigen = api.mobilAnfrage.erledigen.useMutation({
    onSuccess: (r) => { show(r.erledigtLogId ? `Ausgegeben: ${r.erledigtLogId}` : "Als erledigt markiert", "success"); onDone(); },
    onError: (e) => show(e.message, "error"),
  });
  const teile = teileQ.data ?? [];

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-white dark:bg-[#242526] rounded-2xl shadow-2xl border border-[#ced4da] dark:border-[#3e4042] max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-[#ced4da] dark:border-[#3e4042]">
          <h3 className="text-lg font-black text-[#202F61] dark:text-[#e4e6eb]">Ausgeben: {anfrage.modell} · {anfrage.teiltyp}</h3>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">{BEREICH_LABEL(anfrage.bereich)} · für {anfrage.techniker}</p>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1">
          {teileQ.isLoading ? (
            <div className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Lade verfügbare Teile…</div>
          ) : teile.length === 0 ? (
            <div className="text-sm text-[#b25e00] dark:text-[#ffb74d]">Kein Teil auf Lager (Bedarf). Du kannst die Anfrage trotzdem als erledigt markieren.</div>
          ) : (
            <div className="space-y-1.5">
              <div className="text-xs font-bold uppercase text-[#90939a]">LogID zum Ausgeben wählen ({teile.length} verfügbar)</div>
              {teile.map((t) => (
                <button key={t.logId} type="button" disabled={erledigen.isPending}
                  onClick={() => erledigen.mutate({ id: anfrage.id, logId: t.logId })}
                  className="w-full text-left rounded-lg border border-[#e4e6eb] dark:border-[#3a3b3c] hover:border-[#04B475] px-3 py-2 transition-colors disabled:opacity-50">
                  <span className="font-mono text-sm font-semibold text-[#202F61] dark:text-[#e4e6eb]">{t.logId}</span>
                  <span className="ml-2 text-xs text-[#65676b] dark:text-[#b0b3b8]">
                    {[t.colli ? `📦 ${t.colli}` : null, t.stellplatz ? `📍 ${t.stellplatz}` : null, t.farbe ? `🎨 ${t.farbe}` : null].filter(Boolean).join(" · ")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-[#ced4da] dark:border-[#3e4042] flex justify-between gap-2">
          <button type="button" onClick={onClose} className="min-h-[44px] px-4 rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-sm font-bold text-[#202F61] dark:text-[#e4e6eb]">Abbrechen</button>
          <button type="button" disabled={erledigen.isPending} onClick={() => erledigen.mutate({ id: anfrage.id })}
            className="min-h-[44px] px-4 rounded-xl text-sm font-bold text-white" style={{ background: "#6b7280" }}>
            Ohne Teil erledigen
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";
import { useState, useRef, useEffect, useMemo, Suspense } from "react";
import { AnfrageStatus, type Anfrage } from "@prisma/client";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { api } from "@/trpc/react";
import { useSocket } from "@/hooks/useSocket";
import { EVENTS }    from "@/modules/realtime/events";
import { ChatModal } from "@/components/ui/ChatModal";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import { PageLoader } from "@/components/ui/LoadingSpinner";
import { BelegModal, MehrBelegModal } from "@/components/ui/BelegModal";
import { AuslagerModal } from "@/components/auslagern/AuslagerModal";
import { useStandortFilter } from "@/lib/standort/standortContext";
import {
  buildAuslagerBelegHtml,
  printAuslagerBeleg,
  printMehrereAuslagerBelege,
  type AuslagerBelegData,
} from "@/components/ui/AuslagerBeleg";
import type { SessionUser } from "@/core/types";

// ── Tagesübersicht A4 Print ───────────────────────────────────────────────────

function todayStr() { return new Date().toISOString().slice(0, 10); }

function druckeA4(
  anfragen: (Anfrage & { artikel?: { bezeichnung: string } })[],
  datum: string, statusF: string, tech: string,
) {
  const datumDE = new Date(datum + "T12:00:00").toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const filterInfo = [statusF ? `Status: ${statusF}` : "Status: Alle", tech ? `Techniker: ${tech}` : ""].filter(Boolean).join(" · ");
  const statusColor: Record<string, string> = {
    NEU: "#0064d2", BEDARF: "#f7b928", ABGESCHLOSSEN: "#00a400", STORNIERT: "#888", IN_BEARBEITUNG: "#d97706",
  };
  const rows = anfragen.map((a) => {
    const col = statusColor[a.status] ?? "#333";
    const bez = (a.artikel?.bezeichnung ?? a.teil).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return `<tr>
      <td>${a.logId.replace(/</g, "&lt;")}</td><td>${a.techniker.replace(/</g, "&lt;")}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${bez}</td>
      <td>${a.grading ?? "—"}</td>
      <td><span style="color:${col};font-weight:bold">${a.status}</span></td>
      <td>${new Date(a.datum ?? a.createdAt).toLocaleDateString("de-DE", { hour: "2-digit", minute: "2-digit" })}</td>
    </tr>`;
  }).join("");
  const css = `@page{size:A4;margin:15mm}*{box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
    body{margin:0;padding:0;color:#000;font-size:9pt}
    .hdr{margin-bottom:8mm;border-bottom:2px solid #0064d2;padding-bottom:4mm}
    .ttl{font-size:14pt;font-weight:bold;color:#0064d2}
    .sub{font-size:9pt;color:#555;margin-top:2mm}.flt{font-size:8pt;color:#777;margin-top:1mm}
    table{width:100%;border-collapse:collapse}
    th{background:#0064d2;color:#fff;text-align:left;padding:3mm 2mm;font-size:8pt}
    td{padding:2.5mm 2mm;border-bottom:.3mm solid #ddd;font-size:8pt;vertical-align:middle}
    tr:nth-child(even)td{background:#f8f8f8}
    .ftr{margin-top:6mm;font-size:7pt;color:#888;text-align:right;border-top:.3mm solid #ccc;padding-top:3mm}`;
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Anfragen ${datumDE}</title><style>${css}</style></head><body>
    <div class="hdr"><div class="ttl">EMTS Lagernaut — Anfragen Übersicht</div>
    <div class="sub">AfB Sömmerda · ${datumDE}</div><div class="flt">${filterInfo}</div></div>
    <table><thead><tr><th>LogID</th><th>Techniker</th><th>Ersatzteil</th><th>Grading</th><th>Status</th><th>Datum</th></tr></thead>
    <tbody>${rows || "<tr><td colspan='6' style='text-align:center;color:#aaa;padding:8mm'>Keine Anfragen</td></tr>"}</tbody></table>
    <div class="ftr">${anfragen.length} Anfragen · Gedruckt: ${new Date().toLocaleString("de-DE")}</div>
  </body></html>`;
  const w = window.open("", "_blank", "width=800,height=600");
  if (!w) return;
  w.document.write(html); w.document.close(); w.focus();
  setTimeout(() => w.print(), 500);
}

// ── Tagesübersicht Modal ──────────────────────────────────────────────────────

function TagesuebersichtModal({ onClose }: { onClose: () => void }) {
  const [datum,    setDatum]    = useState(todayStr());
  const [sfStatus, setSfStatus] = useState<"" | "offen" | "erledigt">("");
  const [sfTech,   setSfTech]   = useState("");

  const { activeStandortId: sId } = useStandortFilter();
  const { data, isLoading } = api.anfragen.getAll.useQuery({
    von: new Date(datum + "T00:00:00"),
    bis: new Date(datum + "T23:59:59"),
    ...(sfTech ? { techniker: sfTech } : {}),
    limit: 500, offset: 0,
    standortId: sId,
  });

  const anfragen  = (data?.anfragen ?? []) as (Anfrage & { artikel?: { bezeichnung: string } })[];
  const gefiltert = sfStatus === "offen"
    ? anfragen.filter((a) => a.status === AnfrageStatus.NEU || a.status === AnfrageStatus.BEDARF || a.status === AnfrageStatus.IN_BEARBEITUNG)
    : sfStatus === "erledigt"
    ? anfragen.filter((a) => a.status === AnfrageStatus.ABGESCHLOSSEN)
    : anfragen;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-[#242526] rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#ced4da] dark:border-[#3e4042]">
          <h2 className="font-black text-lg text-[#1a1a1a] dark:text-[#e4e6eb]">🖨️ Tagesübersicht drucken</h2>
          <button onClick={onClose} aria-label="Schließen" className="text-[#65676b] hover:text-[#fa3e3e] text-xl font-bold w-11 h-11 flex items-center justify-center rounded-lg hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]">×</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase tracking-wider">Datum</label>
              <input type="date" value={datum} onChange={(e) => setDatum(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-sm outline-none focus:border-[#0064d2]" />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase tracking-wider">Status</label>
              <select value={sfStatus} onChange={(e) => setSfStatus(e.target.value as "" | "offen" | "erledigt")}
                className="w-full px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-sm outline-none focus:border-[#0064d2]">
                <option value="">Alle</option>
                <option value="offen">Offen</option>
                <option value="erledigt">Erledigt</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase tracking-wider">Techniker</label>
              <input placeholder="z.B. FS" value={sfTech} onChange={(e) => setSfTech(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-sm outline-none focus:border-[#0064d2]" />
            </div>
          </div>
          <div className="py-3 px-4 bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
            {isLoading ? "Lade…" : <><strong>{gefiltert.length}</strong> Anfragen · <strong>{new Date(datum + "T12:00:00").toLocaleDateString("de-DE")}</strong></>}
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#ced4da] dark:border-[#3e4042]">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[#65676b] hover:text-[#fa3e3e] transition-colors">Abbrechen</button>
          <button onClick={() => druckeA4(gefiltert, datum, sfStatus, sfTech)} disabled={isLoading || gefiltert.length === 0}
            className="flex items-center gap-2 px-5 py-2 bg-[#0064d2] text-white text-sm font-bold rounded-lg hover:bg-[#0056b3] disabled:opacity-50 transition-colors">
            🖨️ A4 Drucken
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Typen ─────────────────────────────────────────────────────────────────────

type SetStatusResult = {
  id: number; status: AnfrageStatus; belegNr: string | null; restBestand: number | null;
  artikel: { bezeichnung: string; lagerplatz: string | null; kategorie: string } | null;
  grading: string | null; techniker: string; logId: string; geraeteName: string | null; kommentar: string | null;
};

function belegAusResult(r: SetStatusResult, ersteller: string): AuslagerBelegData | null {
  if (!r.belegNr || !r.artikel) return null;
  return {
    belegNr: r.belegNr, artikelBezeichnung: r.artikel.bezeichnung, lagerplatz: r.artikel.lagerplatz,
    kategorie: r.artikel.kategorie, grading: r.grading, techniker: r.techniker, logId: r.logId,
    geraeteName: r.geraeteName ?? undefined, restBestand: r.restBestand ?? 0,
    kommentar: r.kommentar ?? undefined, ersteller, datum: new Date(),
  };
}

// Hilfsfunktion: Uhrzeit aus Date
function uhrzeitStr(d: Date | null | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

// ── Freigeben Confirm-Dialog ──────────────────────────────────────────────────

function FreigebenDialog({
  bearbeitetVon, seit, onConfirm, onAbbrechen, isPending,
}: {
  bearbeitetVon: string;
  seit:          Date | null;
  onConfirm:     (grund: string) => void;
  onAbbrechen:   () => void;
  isPending:     boolean;
}) {
  const [grund, setGrund] = useState("");
  return (
    <div className="fixed inset-0 z-[10100] flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#242526] rounded-2xl shadow-2xl w-full max-w-md border-2 border-amber-400 dark:border-amber-600">
        <div className="px-6 py-5">
          <div className="text-3xl mb-3">⚠️</div>
          <h3 className="font-black text-lg text-[#1a1a1a] dark:text-[#e4e6eb] mb-2">
            Anfrage wirklich freigeben?
          </h3>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mb-4">
            <strong className="text-[#1a1a1a] dark:text-[#e4e6eb]">{bearbeitetVon}</strong> bearbeitet diese Anfrage
            {seit && <span> seit <strong>{uhrzeitStr(seit)}</strong></span>}.
            <br />Die Anfrage wird auf <strong>NEU</strong> zurückgesetzt.
          </p>
          <div>
            <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase tracking-wider">
              Begründung (optional)
            </label>
            <input
              value={grund}
              onChange={(e) => setGrund(e.target.value)}
              placeholder={`z.B. ${bearbeitetVon} ist in Pause`}
              maxLength={300}
              className="w-full px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] text-sm outline-none focus:border-amber-400 transition-colors"
            />
          </div>
        </div>
        <div className="flex gap-3 px-6 pb-5">
          <button
            onClick={onAbbrechen}
            className="flex-1 px-4 py-2.5 rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-semibold text-sm hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors"
          >
            Abbrechen
          </button>
          <button
            onClick={() => onConfirm(grund)}
            disabled={isPending}
            className="flex-1 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm disabled:opacity-50 transition-colors"
          >
            {isPending ? "…" : "🔓 Ja, freigeben"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Haupt-Seite ───────────────────────────────────────────────────────────────

function AnfragenPageInner() {
  const { show }    = useToast();
  const { activeStandortId } = useStandortFilter();
  const { on, off } = useSocket();
  const { data: session } = useSession();
  const user     = session?.user as SessionUser | undefined;
  const ersteller = user?.kuerzel ?? "ADMIN";

  const searchParams = useSearchParams();
  const highlightId  = searchParams?.get("highlight") ?? null;

  function statusHighlightClass(status: string): string {
    if (status === "NEU" || status === "BEDARF") return "anfrage-neu";
    if (status === "IN_BEARBEITUNG") return "anfrage-bearbeitung";
    return "";
  }

  const [statusFilter, setStatusFilter] = useState<AnfrageStatus | "">("");
  const [techFilter,   setTechFilter]   = useState("");
  const [meinFilter,   setMeinFilter]   = useState(false);
  const [tagesModal,   setTagesModal]   = useState(false);

  // Chat-Modal
  const [chatModal, setChatModal] = useState<{
    anfrageId: number; bezugInfo: string; partnerName: string;
  } | null>(null);

  // Auslager-Modal
  const [auslagerModal, setAuslagerModal] = useState<{ anfrageIds: number[]; gruppenLabel: string } | null>(null);

  // Freigeben-Dialog
  const [freigebenDialog, setFreigebenDialog] = useState<{
    anfrageIds: number[]; bearbeitetVon: string; seit: Date | null;
  } | null>(null);

  // Ungelesene Chat-Nachrichten
  const { data: ungelesenData, refetch: refetchChatBadges } = api.chat.getUngelesenProAnfrage.useQuery(
    undefined,
    { refetchInterval: 3_000, staleTime: 2_000 },
  );

  // Beleg-Modals
  const [belegModal,    setBelegModal]    = useState<AuslagerBelegData | null>(null);
  const [gruppenBelege, setGruppenBelege] = useState<AuslagerBelegData[] | null>(null);
  const gruppenModus = useRef(false);

  const { data: auslagerData } = api.auslagern.listAnfragen.useQuery(undefined, {
    staleTime: 20_000, refetchOnWindowFocus: false,
  });

  const auslagerMap = useMemo(() => {
    const m = new Map<string, { anzahlVerfuegbar: number; anzahlTotal: number }>();
    for (const g of (auslagerData ?? [])) m.set(g.gruppenKey, { anzahlVerfuegbar: g.anzahlVerfuegbar, anzahlTotal: g.anzahlTotal });
    return m;
  }, [auslagerData]);

  const { data: rawData, isLoading, error, refetch } = api.anfragen.getGruppiert.useQuery({
    ...(statusFilter ? { status: statusFilter as AnfrageStatus } : {}),
    ...(techFilter   ? { techniker: techFilter } : {}),
    standortId: activeStandortId,
  });

  // "Meine" Quick-Filter — client-seitig
  const data = useMemo(() => {
    if (!meinFilter || !rawData) return rawData;
    return rawData.filter((g) =>
      g.anfragen.some((a) => (a as Anfrage & { bearbeitetVon?: string | null }).bearbeitetVon?.toUpperCase() === ersteller.toUpperCase()),
    );
  }, [rawData, meinFilter, ersteller]);

  // ── Auto-Refresh ──────────────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => { refetch(); }, 5_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Globale Suche: ?highlight=<anfrageId> → zur Anfrage-Zeile scrollen ────
  useEffect(() => {
    if (!highlightId || !data) return;
    const el = document.getElementById(`row-${highlightId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("row-highlight");
      setTimeout(() => el.classList.remove("row-highlight"), 3000);
    }
  }, [highlightId, data]);

  // ── Socket: Chat-Badge ────────────────────────────────────────────────────
  useEffect(() => {
    const h = () => { refetchChatBadges(); };
    on(EVENTS.CHAT_NEU, h);
    return () => off(EVENTS.CHAT_NEU);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Socket: Anfragen-Lock-Events ──────────────────────────────────────────
  useEffect(() => {
    on(EVENTS.ANFRAGE_UEBERNOMMEN, (d: unknown) => {
      const { bearbeiter } = d as { bearbeiter: string };
      refetch();
      if (bearbeiter.toUpperCase() !== ersteller.toUpperCase()) {
        show(`🔧 ${bearbeiter} hat Anfragen übernommen`, "info");
      }
    });
    on(EVENTS.ANFRAGE_FREIGEGEBEN, (d: unknown) => {
      const { durch, vorBearbeiter } = d as { durch: string; vorBearbeiter: string };
      refetch();
      if (durch.toUpperCase() !== ersteller.toUpperCase()) {
        show(`🔓 ${durch} hat Anfragen freigegeben${vorBearbeiter ? ` (war: ${vorBearbeiter})` : ""}`, "info");
      }
    });
    return () => {
      off(EVENTS.ANFRAGE_UEBERNOMMEN);
      off(EVENTS.ANFRAGE_FREIGEGEBEN);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ersteller]);

  // ── Lock-Mutations ────────────────────────────────────────────────────────
  const gruppeNehmenMutation = api.anfragen.gruppeInBearbeitungNehmen.useMutation({
    onSuccess: (r) => {
      show(`🔧 ${r.locked} Anfrage(n) in Bearbeitung genommen`, "success");
      refetch();
    },
    onError: (e) => show(e.message, "error"),
  });

  const freigebenMutation = api.anfragen.gruppeFreigeben.useMutation({
    onSuccess: (r) => {
      show(`🔓 ${r.freigegeben} Anfrage(n) freigegeben`, "success");
      setFreigebenDialog(null);
      refetch();
    },
    onError: (e) => show(e.message, "error"),
  });

  const zurueckgebenMutation = api.anfragen.gruppeZurueckgeben.useMutation({
    onSuccess: (r) => {
      show(`⏸️ ${r.zurueck} Anfrage(n) zurückgegeben`, "info");
      refetch();
    },
    onError: (e) => show(e.message, "error"),
  });

  // ── Status-Mutations ──────────────────────────────────────────────────────
  const setStatus = api.anfragen.setStatus.useMutation({
    onSuccess: (r) => {
      refetch();
      if (r.status === AnfrageStatus.STORNIERT) { show("Anfrage storniert", "info"); return; }
      if (r.status === AnfrageStatus.ABGESCHLOSSEN && !gruppenModus.current) {
        const beleg = belegAusResult(r as SetStatusResult, ersteller);
        if (beleg) setBelegModal(beleg);
      }
    },
    onError: (e) => show(e.message, "error"),
  });

  // Öffnet AuslagerModal für eine einzelne Anfrage (AUSGANG oder DIREKT je nach Bestand)
  function handleErledigen(anfrageId: number, gruppenLabel: string) {
    setAuslagerModal({ anfrageIds: [anfrageId], gruppenLabel });
  }

  // Öffnet AuslagerModal für alle offenen Anfragen einer Gruppe
  function alleErledigen(anfragen: Anfrage[], gruppenLabel: string) {
    const offen = anfragen.filter((a) => {
      const af = a as Anfrage & { bearbeitetVon?: string | null };
      const lockedByOther = af.bearbeitetVon && af.bearbeitetVon.toUpperCase() !== ersteller.toUpperCase();
      return a.status !== AnfrageStatus.ABGESCHLOSSEN && a.status !== AnfrageStatus.STORNIERT && !lockedByOther;
    });
    if (!offen.length) { show("Keine freigegebenen Anfragen zu erledigen", "info"); return; }
    setAuslagerModal({ anfrageIds: offen.map((a) => a.id), gruppenLabel });
  }

  if (isLoading) return <PageLoader />;
  if (error) return <div className="p-6 bg-[#fa3e3e]/10 border border-[#fa3e3e]/30 rounded-xl text-[#fa3e3e]">Fehler: {error.message}</div>;

  const isBusy = setStatus.isPending;

  return (
    <div className="space-y-5">
      {/* Titel + Tagesübersicht */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Anfragen</h1>
        <button onClick={() => setTagesModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-[#242526] border border-[#ced4da] dark:border-[#3e4042] text-[#1a1a1a] dark:text-[#e4e6eb] text-sm font-semibold rounded-xl hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors shadow-sm">
          🖨️ Tagesübersicht
        </button>
      </div>

      {/* Filter */}
      <div className="flex gap-3 flex-wrap items-center">
        {/* Quick-Filter: Alle / Meine */}
        <div className="flex rounded-lg overflow-hidden border border-[#ced4da] dark:border-[#3e4042]">
          <button
            onClick={() => setMeinFilter(false)}
            className={`px-4 py-3 text-xs font-bold transition-colors min-h-[44px] ${!meinFilter ? "bg-[#0064d2] text-white" : "bg-white dark:bg-[#242526] text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"}`}
          >
            Alle
          </button>
          <button
            onClick={() => setMeinFilter(true)}
            className={`px-4 py-3 text-xs font-bold border-l border-[#ced4da] dark:border-[#3e4042] transition-colors min-h-[44px] ${meinFilter ? "bg-[#0064d2] text-white" : "bg-white dark:bg-[#242526] text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"}`}
          >
            🔧 Meine
          </button>
        </div>

        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as AnfrageStatus | "")}
          className="px-4 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] text-sm">
          <option value="">Alle Status</option>
          {Object.values(AnfrageStatus).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input placeholder="Techniker filtern…" value={techFilter}
          onChange={(e) => setTechFilter(e.target.value.toUpperCase())}
          className="px-4 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] text-sm w-48" />
        {(statusFilter || techFilter || meinFilter) && (
          <button onClick={() => { setStatusFilter(""); setTechFilter(""); setMeinFilter(false); }}
            className="text-xs text-[#65676b] dark:text-[#b0b3b8] hover:text-[#fa3e3e] px-2 py-1">
            ✕ Filter zurücksetzen
          </button>
        )}
        <span className="py-2 text-sm text-[#65676b] dark:text-[#b0b3b8]">{data?.length ?? 0} Gruppen</span>
      </div>

      {/* Gruppen */}
      <div className="space-y-4">
        {data?.map((gruppe, gi) => {
          // ── Lock-State ──────────────────────────────────────────────────
          type AnfrageExt = Anfrage & { bearbeitetVon?: string | null; bearbeitetSeit?: Date | null; istSonderAnfrage?: boolean; beschreibung?: string | null; sonderKategorie?: string | null };
          const anfragenTyped = gruppe.anfragen as AnfrageExt[];
          const gruppeAnfrageIds  = anfragenTyped.map((a) => a.id);
          const lockedAnfrage     = anfragenTyped.find((a) => a.bearbeitetVon);
          const bearbeitetVon     = lockedAnfrage?.bearbeitetVon ?? null;
          const bearbeitetSeit    = lockedAnfrage?.bearbeitetSeit ?? null;
          const isLockedByMe      = !!bearbeitetVon && bearbeitetVon.toUpperCase() === ersteller.toUpperCase();
          const isLockedByOther   = !!bearbeitetVon && !isLockedByMe;
          const alleDone          = anfragenTyped.every((a) => a.status === AnfrageStatus.ABGESCHLOSSEN || a.status === AnfrageStatus.STORNIERT);
          const anyTakeable       = anfragenTyped.some((a) => (a.status === AnfrageStatus.NEU || a.status === AnfrageStatus.BEDARF) && !a.bearbeitetVon);

          // ── Auslagern-Info ───────────────────────────────────────────────
          const gruppenKey       = gruppe.gruppenNr ?? `${gruppe.techniker}__${gruppe.logId}`;
          const auslagerInfo     = auslagerMap.get(gruppenKey);
          const hatVerfuegbare   = !alleDone && (auslagerInfo?.anzahlVerfuegbar ?? 0) > 0;
          const auslagerIds      = anfragenTyped
            .filter((a) => a.status !== AnfrageStatus.ABGESCHLOSSEN && a.status !== AnfrageStatus.STORNIERT && !a.istSonderAnfrage)
            .map((a) => a.id);

          // ── Chat-Button ─────────────────────────────────────────────────
          const firstId   = anfragenTyped[0]?.id;
          const chatCount = firstId ? ((ungelesenData ?? []).find((x) => x.anfrageId === firstId)?.count ?? 0) : 0;
          const bezugInfo = [gruppe.geraeteName, gruppe.logId !== "unbekannt" ? gruppe.logId : undefined].filter(Boolean).join(" · ");

          // Header-Styling je nach Lock-State
          const headerCls = isLockedByMe
            ? "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800"
            : isLockedByOther
            ? "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 opacity-90"
            : "bg-[#f0f2f5] dark:bg-[#18191a] border-[#ced4da] dark:border-[#3e4042]";

          return (
            <div key={gi} className={`bg-white dark:bg-[#242526] rounded-xl border shadow-sm overflow-hidden ${isLockedByOther ? "border-amber-200 dark:border-amber-800" : "border-[#ced4da] dark:border-[#3e4042]"} ${statusHighlightClass(gruppe.gruppenStatus)}`}>
              {/* ── Gruppen-Header ── */}
              <div className={`flex items-start justify-between gap-3 px-5 py-4 border-b flex-wrap gap-y-2 ${headerCls}`}>
                <div className="flex items-start gap-4 flex-wrap min-w-0">
                  <div className="min-w-0">
                    <div className="font-black text-[#1a1a1a] dark:text-[#e4e6eb]">{gruppe.logId}</div>
                    <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
                      {gruppe.techniker} ·{" "}
                      {new Date(gruppe.datum).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      {gruppe.geraeteName && ` · ${gruppe.geraeteName}`}
                    </div>
                  </div>
                  <StatusBadge status={gruppe.gruppenStatus} />
                  {hatVerfuegbare && auslagerInfo && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#008bd2]/15 text-[#008bd2] dark:text-[#45bdff] whitespace-nowrap">
                      📦 {auslagerInfo.anzahlVerfuegbar}/{auslagerInfo.anzahlTotal}
                    </span>
                  )}
                  {gruppe.gruppenNr && <span className="text-xs font-mono text-[#65676b] dark:text-[#b0b3b8]">{gruppe.gruppenNr}</span>}

                  {/* Lock-Status-Pill */}
                  {isLockedByMe && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 whitespace-nowrap">
                      🔧 Du bearbeitest{bearbeitetSeit ? ` · seit ${uhrzeitStr(bearbeitetSeit)}` : ""}
                    </span>
                  )}
                  {isLockedByOther && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 whitespace-nowrap">
                      🔒 {bearbeitetVon}{bearbeitetSeit ? ` · seit ${uhrzeitStr(bearbeitetSeit)}` : ""}
                    </span>
                  )}
                </div>

                {/* ── Aktions-Buttons ── */}
                <div className="flex gap-2 flex-wrap">
                  {/* Lock-Buttons */}
                  {!alleDone && anyTakeable && !bearbeitetVon && (
                    <button
                      onClick={() => gruppeNehmenMutation.mutate({ anfrageIds: gruppeAnfrageIds })}
                      disabled={gruppeNehmenMutation.isPending}
                      className="px-3 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg disabled:opacity-50 transition-colors min-h-[44px]"
                    >
                      {gruppeNehmenMutation.isPending ? "…" : "▶️ In Bearbeitung"}
                    </button>
                  )}
                  {isLockedByMe && (
                    <button
                      onClick={() => zurueckgebenMutation.mutate({ anfrageIds: gruppeAnfrageIds })}
                      disabled={zurueckgebenMutation.isPending}
                      className="px-3 py-2.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-lg disabled:opacity-50 transition-colors border border-slate-300 dark:border-slate-500 min-h-[44px]"
                    >
                      {zurueckgebenMutation.isPending ? "…" : "⏸️ Zurückgeben"}
                    </button>
                  )}
                  {isLockedByOther && (
                    <button
                      onClick={() => setFreigebenDialog({ anfrageIds: gruppeAnfrageIds, bearbeitetVon: bearbeitetVon!, seit: bearbeitetSeit ?? null })}
                      className="px-3 py-2.5 bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100 text-amber-700 dark:text-amber-400 text-xs font-bold rounded-lg border border-amber-300 dark:border-amber-700 transition-colors min-h-[44px]"
                    >
                      🔓 Freigeben
                    </button>
                  )}

                  {/* Auslagern-Button */}
                  {hatVerfuegbare && auslagerIds.length > 0 && (
                    <button
                      onClick={() => setAuslagerModal({
                        anfrageIds:   auslagerIds,
                        gruppenLabel: [gruppe.geraeteName, gruppe.techniker].filter(Boolean).join(" · ") || gruppe.logId,
                      })}
                      title="Auslagerung starten"
                      className="px-3 py-2.5 bg-[#008bd2] text-white text-xs font-bold rounded-lg hover:bg-[#0077b5] transition-colors min-h-[44px]"
                    >
                      📤 Auslagern
                    </button>
                  )}

                  {/* Chat-Button */}
                  <button
                    onClick={() => firstId && setChatModal({ anfrageId: firstId, bezugInfo, partnerName: gruppe.techniker })}
                    disabled={!firstId}
                    style={chatCount > 0 ? { animation: "chatPulse 1.5s ease-in-out infinite" } : undefined}
                    className={`relative px-3 py-2.5 text-xs font-bold rounded-lg transition-colors min-h-[44px] ${chatCount > 0 ? "bg-[#0064d2] text-white hover:bg-[#0056b3]" : "bg-[#0064d2]/10 text-[#0064d2] dark:text-[#45bdff] hover:bg-[#0064d2]/20"}`}
                  >
                    💬 Chat{chatCount > 0 && ` (${chatCount > 9 ? "9+" : chatCount})`}
                  </button>

                  {/* Alle erledigen */}
                  <button
                    onClick={() => alleErledigen(gruppe.anfragen, gruppe.geraeteName ?? gruppe.logId)}
                    disabled={isBusy || isLockedByOther}
                    title={isLockedByOther ? `Gesperrt von ${bearbeitetVon}` : "Alle Anfragen erledigen"}
                    className="px-3 py-2.5 bg-[#00a400] text-white text-xs font-bold rounded-lg hover:bg-green-600 disabled:opacity-40 transition-colors min-h-[44px]"
                  >
                    {isBusy ? "…" : "✅ Alle erledigen"}
                  </button>
                </div>
              </div>

              {/* ── Anfragen-Zeilen ── */}
              <div className="divide-y divide-[#ced4da] dark:divide-[#3e4042]">
                {anfragenTyped.map((a) => {
                  const rowLockedByOther = !!a.bearbeitetVon && a.bearbeitetVon.toUpperCase() !== ersteller.toUpperCase();
                  const rowCls = rowLockedByOther ? "opacity-60" : "";
                  return (
                    <div key={a.id} id={`row-${a.id}`} className={`flex items-center gap-4 px-5 py-3 flex-wrap gap-y-1 ${rowCls}`}
                      style={a.istSonderAnfrage ? { borderLeft: "3px solid #f97316", paddingLeft: "0.9rem" } : undefined}>
                      <div className="flex-1 min-w-0">
                        {a.istSonderAnfrage && (
                          <div className="flex items-center gap-1 mb-0.5">
                            <span className="text-xs font-black px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                              📦 SONDERANFRAGE
                            </span>
                            {a.sonderKategorie && a.sonderKategorie !== "Sonstiges" && (
                              <span className="text-xs text-orange-600 dark:text-orange-400">{a.sonderKategorie}</span>
                            )}
                          </div>
                        )}
                        <span className="font-semibold text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
                          {a.beschreibung ?? a.teil}
                        </span>
                        {!a.istSonderAnfrage && (a.grading ? (
                          <span className="ml-1 text-xs font-bold px-1.5 py-0.5 rounded bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8]">
                            {a.grading} erwünscht
                          </span>
                        ) : (
                          <span className="ml-1 text-xs px-1.5 py-0.5 rounded bg-[#0064d2]/10 text-[#0064d2] dark:text-[#45bdff]">
                            Bestmöglich
                          </span>
                        ))}
                        {a.istSonderAnfrage && (
                          <div className="text-xs text-orange-600/70 dark:text-orange-400/70 mt-0.5">⚠️ Kein Standard-Artikel · Bitte manuell prüfen</div>
                        )}
                        {a.kommentar && <span className="ml-2 text-xs text-[#0064d2] dark:text-[#45bdff]">⌨️ {a.kommentar}</span>}
                        {/* Bearbeiter-Hinweis per Anfrage */}
                        {a.bearbeitetVon && a.status === AnfrageStatus.IN_BEARBEITUNG && (
                          <span className={`ml-2 text-xs font-semibold ${isLockedByMe && a.bearbeitetVon.toUpperCase() === ersteller.toUpperCase() ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400"}`}>
                            🔧 {a.bearbeitetVon}{a.bearbeitetSeit ? ` · ${uhrzeitStr(a.bearbeitetSeit)}` : ""}
                          </span>
                        )}
                      </div>
                      <StatusBadge status={a.status} />
                      <div className="flex gap-1">
                        {/* Beleg erneut drucken */}
                        {a.status === AnfrageStatus.ABGESCHLOSSEN && (
                          <button
                            onClick={() => printAuslagerBeleg({
                              belegNr: `AL-${new Date().getFullYear()}-${a.id.toString().padStart(4, "0")}`,
                              artikelBezeichnung: a.teil, lagerplatz: null, kategorie: "", grading: a.grading,
                              techniker: a.techniker, logId: a.logId, restBestand: 0, ersteller, datum: new Date(),
                            })}
                            className="px-2 py-2 text-xs bg-[#0064d2]/10 text-[#0064d2] rounded hover:bg-[#0064d2]/20 font-bold transition-colors min-h-[36px]"
                            title="Auslagerbeleg erneut drucken"
                          >
                            🖨️
                          </button>
                        )}

                        {/* Erledigen */}
                        {a.status !== AnfrageStatus.ABGESCHLOSSEN && a.status !== AnfrageStatus.STORNIERT && (
                          <button
                            onClick={() => !rowLockedByOther && handleErledigen(a.id, gruppe.geraeteName ?? gruppe.logId)}
                            disabled={isBusy || rowLockedByOther}
                            title={rowLockedByOther ? `Gesperrt von ${a.bearbeitetVon}` : "Erledigen"}
                            className="px-2 py-2 text-xs bg-[#00a400]/10 text-[#00a400] rounded hover:bg-[#00a400]/20 font-bold disabled:opacity-40 transition-colors min-h-[36px]"
                          >
                            ✓
                          </button>
                        )}

                        {/* Stornieren */}
                        {(a.status === AnfrageStatus.NEU || a.status === AnfrageStatus.BEDARF) && (
                          <button
                            onClick={() => !rowLockedByOther && setStatus.mutate({ id: a.id, status: AnfrageStatus.STORNIERT })}
                            disabled={isBusy || rowLockedByOther}
                            title={rowLockedByOther ? `Gesperrt von ${a.bearbeitetVon}` : "Stornieren"}
                            className="px-2 py-2 text-xs bg-[#fa3e3e]/10 text-[#fa3e3e] rounded hover:bg-[#fa3e3e]/20 font-bold disabled:opacity-40 transition-colors min-h-[36px]"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {!data?.length && (
          <div className="text-center py-16 text-[#65676b] dark:text-[#b0b3b8]">
            {meinFilter ? "Keine Anfragen in deiner Bearbeitung" : "Keine Anfragen gefunden"}
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {tagesModal && <TagesuebersichtModal onClose={() => setTagesModal(false)} />}

      {freigebenDialog && (
        <FreigebenDialog
          bearbeitetVon={freigebenDialog.bearbeitetVon}
          seit={freigebenDialog.seit}
          isPending={freigebenMutation.isPending}
          onAbbrechen={() => setFreigebenDialog(null)}
          onConfirm={(grund) => freigebenMutation.mutate({ anfrageIds: freigebenDialog.anfrageIds, grund: grund || undefined })}
        />
      )}

      {belegModal && (
        <BelegModal
          titel="📤 Auslagerbeleg drucken"
          buildHtml={() => buildAuslagerBelegHtml(belegModal)}
          onSchliessen={() => setBelegModal(null)}
        />
      )}
      {gruppenBelege && gruppenBelege.length > 0 && (
        <MehrBelegModal
          anzahl={gruppenBelege.length}
          onDrucken={() => printMehrereAuslagerBelege(gruppenBelege)}
          onSchliessen={() => setGruppenBelege(null)}
        />
      )}

      {auslagerModal && (
        <AuslagerModal
          anfrageIds={auslagerModal.anfrageIds}
          gruppenLabel={auslagerModal.gruppenLabel}
          onClose={() => { setAuslagerModal(null); refetch(); }}
          onSuccess={(result) => {
            const n = result.ausgabe.length;
            show(`✅ ${n} Teil${n !== 1 ? "e" : ""} abgeschlossen`, "success");
            refetch();
          }}
        />
      )}

      {chatModal && (
        <ChatModal
          anfrageId={chatModal.anfrageId}
          currentUser={ersteller}
          isAdmin={true}
          bezugInfo={chatModal.bezugInfo || undefined}
          partnerName={chatModal.partnerName}
          onClose={() => { setChatModal(null); refetch(); }}
        />
      )}

      <style>{`
        @keyframes chatPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(0, 100, 210, 0.5); }
          50%       { box-shadow: 0 0 0 8px rgba(0, 100, 210, 0); }
        }
      `}</style>
    </div>
  );
}

export default function AnfragenPage() {
  return (
    <Suspense fallback={<div className="p-6 text-[#65676b] dark:text-[#b0b3b8]">Lade…</div>}>
      <AnfragenPageInner />
    </Suspense>
  );
}

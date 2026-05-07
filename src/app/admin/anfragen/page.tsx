"use client";
import { useState } from "react";
import { AnfrageStatus, type Anfrage } from "@prisma/client";
import { useSession } from "next-auth/react";
import { api } from "@/trpc/react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import { PageLoader } from "@/components/ui/LoadingSpinner";
import { BelegModal, MehrBelegModal } from "@/components/ui/BelegModal";
import {
  AuslagerBelegPreview,
  printAuslagerBeleg,
  printMehrereAuslagerBelege,
  type AuslagerBelegData,
} from "@/components/ui/AuslagerBeleg";
import type { SessionUser } from "@/core/types";

// ── Tagesübersicht A4 Print ───────────────────────────────────────────────────

function todayStr() { return new Date().toISOString().slice(0, 10); }

function druckeA4(
  anfragen: (Anfrage & { artikel?: { bezeichnung: string } })[],
  datum: string, status: string, tech: string,
) {
  const datumDE = new Date(datum + "T12:00:00").toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
  const filterInfo = [status ? `Status: ${status}` : "Status: Alle", tech ? `Techniker: ${tech}` : ""].filter(Boolean).join(" · ");
  const statusColor: Record<AnfrageStatus, string> = {
    NEU: "#0064d2", BEDARF: "#f7b928", ABGESCHLOSSEN: "#00a400", STORNIERT: "#888",
  };
  const rows = anfragen.map((a) => {
    const col = statusColor[a.status] ?? "#333";
    const bez = (a.artikel?.bezeichnung ?? a.teil).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return `<tr>
      <td>${a.logId.replace(/</g,"&lt;")}</td>
      <td>${a.techniker.replace(/</g,"&lt;")}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${bez}</td>
      <td>${a.grading ?? "—"}</td>
      <td><span style="color:${col};font-weight:bold">${a.status}</span></td>
      <td>${new Date(a.datum ?? a.createdAt).toLocaleDateString("de-DE",{hour:"2-digit",minute:"2-digit"})}</td>
    </tr>`;
  }).join("");
  const css = `
    @page{size:A4;margin:15mm}*{box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
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
  const [datum,  setDatum]  = useState(todayStr());
  const [status, setStatus] = useState<"" | "offen" | "erledigt">("");
  const [tech,   setTech]   = useState("");

  const { data, isLoading } = api.anfragen.getAll.useQuery({
    von: new Date(datum + "T00:00:00"),
    bis: new Date(datum + "T23:59:59"),
    ...(tech ? { techniker: tech } : {}),
    limit: 500, offset: 0,
  });

  const anfragen = (data?.anfragen ?? []) as (Anfrage & { artikel?: { bezeichnung: string } })[];
  const gefiltert = status === "offen"
    ? anfragen.filter((a) => a.status === AnfrageStatus.NEU || a.status === AnfrageStatus.BEDARF)
    : status === "erledigt"
    ? anfragen.filter((a) => a.status === AnfrageStatus.ABGESCHLOSSEN)
    : anfragen;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-[#242526] rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#ced4da] dark:border-[#3e4042]">
          <h2 className="font-black text-lg text-[#1a1a1a] dark:text-[#e4e6eb]">🖨️ Tagesübersicht drucken</h2>
          <button onClick={onClose} className="text-[#65676b] hover:text-[#fa3e3e] text-xl font-bold">×</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase tracking-wider">Datum</label>
              <input type="date" value={datum} onChange={(e) => setDatum(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] text-sm outline-none focus:border-[#0064d2]" />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase tracking-wider">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as "" | "offen" | "erledigt")}
                className="w-full px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] text-sm outline-none focus:border-[#0064d2]">
                <option value="">Alle</option>
                <option value="offen">Offen (NEU + BEDARF)</option>
                <option value="erledigt">Erledigt</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase tracking-wider">Techniker</label>
              <input placeholder="z.B. FS" value={tech} onChange={(e) => setTech(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] text-sm outline-none focus:border-[#0064d2]" />
            </div>
          </div>
          <div className="py-3 px-4 bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
            {isLoading ? "Lade…" : <><strong>{gefiltert.length}</strong> Anfragen · <strong>{new Date(datum + "T12:00:00").toLocaleDateString("de-DE")}</strong></>}
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#ced4da] dark:border-[#3e4042]">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[#65676b] dark:text-[#b0b3b8] hover:text-[#fa3e3e] transition-colors">Abbrechen</button>
          <button onClick={() => druckeA4(gefiltert, datum, status, tech)} disabled={isLoading || gefiltert.length === 0}
            className="flex items-center gap-2 px-5 py-2 bg-[#0064d2] text-white text-sm font-bold rounded-lg hover:bg-[#0056b3] disabled:opacity-50 transition-colors">
            🖨️ A4 Drucken
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Haupt-Seite ───────────────────────────────────────────────────────────────

type AbschliessenResult = {
  belegNr:     string;
  artikel:     { bezeichnung: string; lagerplatz: string | null; kategorie: string };
  grading:     string | null;
  techniker:   string;
  logId:       string;
  geraeteName: string | null | undefined;
  restBestand: number;
  kommentar:   string | null | undefined;
};

export default function AnfragenPage() {
  const { show } = useToast();
  const { data: session } = useSession();
  const user = session?.user as SessionUser | undefined;

  const [statusFilter, setStatusFilter] = useState<AnfrageStatus | "">("");
  const [techFilter,   setTechFilter]   = useState("");
  const [tagesModal,   setTagesModal]   = useState(false);

  // Beleg-Modals
  const [belegModal,    setBelegModal]    = useState<AuslagerBelegData | null>(null);
  const [gruppenBelege, setGruppenBelege] = useState<AuslagerBelegData[] | null>(null);

  const { data, isLoading, error, refetch } = api.anfragen.getGruppiert.useQuery({
    ...(statusFilter ? { status: statusFilter as AnfrageStatus } : {}),
    ...(techFilter   ? { techniker: techFilter } : {}),
  });

  const abschliessen = api.anfragen.abschliessen.useMutation({
    onSuccess: (r) => {
      if (r) {
        setBelegModal({
          belegNr:            r.belegNr,
          artikelBezeichnung: r.artikel.bezeichnung,
          lagerplatz:         r.artikel.lagerplatz,
          kategorie:          r.artikel.kategorie,
          grading:            r.grading,
          techniker:          r.techniker,
          logId:              r.logId,
          geraeteName:        r.geraeteName ?? undefined,
          restBestand:        r.restBestand,
          kommentar:          r.kommentar ?? undefined,
          ersteller:          user?.kuerzel ?? "ADMIN",
          datum:              new Date(),
        });
      }
      refetch();
    },
    onError: (e) => show(e.message, "error"),
  });

  const setStatus = api.anfragen.setStatus.useMutation({
    onSuccess: () => { show("Status aktualisiert", "success"); refetch(); },
    onError:   (e) => show(e.message, "error"),
  });

  async function alleAbschliessen(anfragen: Anfrage[]) {
    const offen = anfragen.filter(
      (a) => a.status !== AnfrageStatus.ABGESCHLOSSEN && a.status !== AnfrageStatus.STORNIERT,
    );
    if (!offen.length) { show("Alle Anfragen bereits erledigt", "info"); return; }
    try {
      const results = await Promise.all(offen.map((a) => abschliessen.mutateAsync({ id: a.id })));
      const belegeData: AuslagerBelegData[] = results
        .filter(Boolean)
        .map((r) => ({
          belegNr:            r!.belegNr,
          artikelBezeichnung: r!.artikel.bezeichnung,
          lagerplatz:         r!.artikel.lagerplatz,
          kategorie:          r!.artikel.kategorie,
          grading:            r!.grading,
          techniker:          r!.techniker,
          logId:              r!.logId,
          geraeteName:        r!.geraeteName ?? undefined,
          restBestand:        r!.restBestand,
          kommentar:          r!.kommentar ?? undefined,
          ersteller:          user?.kuerzel ?? "ADMIN",
          datum:              new Date(),
        }));
      show(`✅ ${offen.length} Anfrage(n) erledigt`, "success");
      setBelegModal(null);
      if (belegeData.length > 1) setGruppenBelege(belegeData);
      else if (belegeData.length === 1) setBelegModal(belegeData[0]);
      refetch();
    } catch {
      show("Fehler beim Erledigen einiger Anfragen", "error");
    }
  }

  if (isLoading) return <PageLoader />;
  if (error) return (
    <div className="p-6 bg-[#fa3e3e]/10 border border-[#fa3e3e]/30 rounded-xl text-[#fa3e3e]">
      Fehler: {error.message}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Anfragen</h1>
        <button onClick={() => setTagesModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-[#242526] border border-[#ced4da] dark:border-[#3e4042] text-[#1a1a1a] dark:text-[#e4e6eb] text-sm font-semibold rounded-xl hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors shadow-sm">
          🖨️ Tagesübersicht
        </button>
      </div>

      {/* Filter */}
      <div className="flex gap-3 flex-wrap items-center">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as AnfrageStatus | "")}
          className="px-4 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] text-sm">
          <option value="">Alle Status</option>
          {Object.values(AnfrageStatus).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input placeholder="Techniker filtern…" value={techFilter}
          onChange={(e) => setTechFilter(e.target.value.toUpperCase())}
          className="px-4 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] text-sm w-48" />
        {(statusFilter || techFilter) && (
          <button onClick={() => { setStatusFilter(""); setTechFilter(""); }}
            className="text-xs text-[#65676b] dark:text-[#b0b3b8] hover:text-[#fa3e3e] px-2 py-1">
            ✕ Filter zurücksetzen
          </button>
        )}
        <span className="py-2 text-sm text-[#65676b] dark:text-[#b0b3b8]">{data?.length ?? 0} Gruppen</span>
      </div>

      {/* Gruppen */}
      <div className="space-y-4">
        {data?.map((gruppe, gi) => (
          <div key={gi} className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 py-4 bg-[#f0f2f5] dark:bg-[#18191a] border-b border-[#ced4da] dark:border-[#3e4042] flex-wrap gap-y-2">
              <div className="flex items-center gap-4 flex-wrap">
                <div>
                  <div className="font-black text-[#1a1a1a] dark:text-[#e4e6eb]">{gruppe.logId}</div>
                  <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
                    {gruppe.techniker} ·{" "}
                    {new Date(gruppe.datum).toLocaleDateString("de-DE", {
                      day: "2-digit", month: "2-digit", year: "2-digit",
                      hour: "2-digit", minute: "2-digit",
                    })}
                    {gruppe.geraeteName && ` · ${gruppe.geraeteName}`}
                  </div>
                </div>
                <StatusBadge status={gruppe.gruppenStatus} />
                {gruppe.gruppenNr && (
                  <span className="text-xs font-mono text-[#65676b] dark:text-[#b0b3b8]">{gruppe.gruppenNr}</span>
                )}
              </div>
              <button
                onClick={() => alleAbschliessen(gruppe.anfragen)}
                disabled={abschliessen.isPending}
                className="px-3 py-1.5 bg-[#00a400] text-white text-xs font-bold rounded-lg hover:bg-green-600 disabled:opacity-50 transition-colors"
              >
                {abschliessen.isPending ? "…" : "✅ Alle erledigen"}
              </button>
            </div>

            <div className="divide-y divide-[#ced4da] dark:divide-[#3e4042]">
              {gruppe.anfragen.map((a) => (
                <div key={a.id} className="flex items-center gap-4 px-5 py-3 flex-wrap gap-y-1">
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">{a.teil}</span>
                    {a.grading && <span className="ml-2 text-xs text-[#65676b] dark:text-[#b0b3b8]">{a.grading}</span>}
                    {a.kommentar && <span className="ml-2 text-xs text-[#0064d2] dark:text-[#45bdff]">⌨️ {a.kommentar}</span>}
                  </div>
                  <StatusBadge status={a.status} />
                  <div className="flex gap-1">
                    {/* Auslagerbeleg erneut drucken bei ABGESCHLOSSEN */}
                    {a.status === AnfrageStatus.ABGESCHLOSSEN && (
                      <button
                        onClick={() => printAuslagerBeleg({
                          belegNr:            `AL-${new Date().getFullYear()}-${a.id.toString().padStart(4, "0")}`,
                          artikelBezeichnung: a.teil,
                          lagerplatz:         null,
                          kategorie:          "",
                          grading:            a.grading,
                          techniker:          a.techniker,
                          logId:              a.logId,
                          restBestand:        0,
                          ersteller:          user?.kuerzel ?? "ADMIN",
                          datum:              new Date(),
                        })}
                        className="px-2 py-1 text-xs bg-[#0064d2]/10 text-[#0064d2] rounded hover:bg-[#0064d2]/20 font-bold transition-colors"
                        title="Auslagerbeleg erneut drucken"
                      >
                        🖨️
                      </button>
                    )}
                    {/* Erledigen → abschliessen (AUSGANG + Beleg) */}
                    {a.status !== AnfrageStatus.ABGESCHLOSSEN && a.status !== AnfrageStatus.STORNIERT && (
                      <button
                        onClick={() => abschliessen.mutate({ id: a.id })}
                        disabled={abschliessen.isPending}
                        className="px-2 py-1 text-xs bg-[#00a400]/10 text-[#00a400] rounded hover:bg-[#00a400]/20 font-bold disabled:opacity-50"
                        title="Erledigen (AUSGANG + Beleg)"
                      >
                        ✓
                      </button>
                    )}
                    {(a.status === AnfrageStatus.NEU || a.status === AnfrageStatus.BEDARF) && (
                      <button
                        onClick={() => setStatus.mutate({ id: a.id, status: AnfrageStatus.STORNIERT })}
                        disabled={setStatus.isPending}
                        className="px-2 py-1 text-xs bg-[#fa3e3e]/10 text-[#fa3e3e] rounded hover:bg-[#fa3e3e]/20 font-bold disabled:opacity-50"
                        title="Stornieren"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {!data?.length && (
          <div className="text-center py-16 text-[#65676b] dark:text-[#b0b3b8]">Keine Anfragen gefunden</div>
        )}
      </div>

      {/* Tagesübersicht Modal */}
      {tagesModal && <TagesuebersichtModal onClose={() => setTagesModal(false)} />}

      {/* Einzel-Auslagerbeleg Modal */}
      {belegModal && (
        <BelegModal
          titel="📤 Auslagerbeleg drucken"
          beleg={<AuslagerBelegPreview data={belegModal} scale={2.5} />}
          onDrucken={() => printAuslagerBeleg(belegModal)}
          onSchliessen={() => setBelegModal(null)}
        />
      )}

      {/* Gruppen-Auslagerbeleg Modal */}
      {gruppenBelege && gruppenBelege.length > 0 && (
        <MehrBelegModal
          anzahl={gruppenBelege.length}
          onDrucken={() => printMehrereAuslagerBelege(gruppenBelege)}
          onSchliessen={() => setGruppenBelege(null)}
        />
      )}
    </div>
  );
}

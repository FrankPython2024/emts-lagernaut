"use client";
import AnfragenItem                       from "./AnfragenItem";
import GruppenNachrichten                 from "./GruppenNachrichten";
import { type GruppeData, type StornoPayload } from "./constants";

interface Props {
  gruppe:   GruppeData;
  kuerzel:  string;
  onStorno: (item: StornoPayload) => void;
}

export default function AnfragenGruppe({ gruppe, kuerzel, onStorno }: Props) {
  const anfragen     = gruppe.anfragen;
  const hasRealLogId = !!(gruppe.logId && gruppe.logId !== "unbekannt");

  const alleErledigt   = anfragen.every((a) => a.status === "ABGESCHLOSSEN" || a.status === "STORNIERT");
  const irgendErledigt = anfragen.some((a) => a.status === "ABGESCHLOSSEN");
  const hatBedarf      = anfragen.some((a) => a.status === "BEDARF");

  const headerBg         = alleErledigt ? "#16a34a" : "var(--primary)";
  const headerBorderLeft = !alleErledigt && irgendErledigt
    ? "5px solid #16a34a"
    : !alleErledigt && hatBedarf
    ? "5px solid #f97316"
    : undefined;

  const datum    = new Date(gruppe.datum);
  const datumStr = datum.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });

  const headerText = hasRealLogId
    ? `LogID: ${gruppe.logId}`
    : gruppe.geraeteName
    ? gruppe.geraeteName
    : gruppe.gruppenNr
    ? `Anfrage ${gruppe.gruppenNr.slice(-6)}`
    : `Anfrage ${datumStr}`;

  const headerIcon = hasRealLogId ? "📡" : "🔍";

  return (
    /*
     * ⚠️  KEIN overflow: hidden!
     * ⚠️  KEIN max-height!
     * Jede Karte wird so hoch wie nötig.
     * Scrolling findet NUR im Außen-Container statt.
     */
    <div style={{
      background:   "var(--card-bg)",
      borderRadius: 12,
      border:       "1px solid var(--border)",
      boxShadow:    "0 2px 8px rgba(0,0,0,0.06)",
      width:        "100%",
      minWidth:     0,
    }}>
      {/* ── Gruppen-Header ── */}
      <div style={{
        background:     headerBg,
        borderLeft:     headerBorderLeft,
        color:          "white",
        padding:        "12px 16px",
        borderRadius:   "12px 12px 0 0",
        display:        "flex",
        justifyContent: "space-between",
        alignItems:     "center",
        gap:            8,
        minWidth:       0,
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {headerIcon} {headerText}
          </div>
          {hasRealLogId && gruppe.geraeteName && (
            <div style={{ fontSize: "0.75rem", opacity: 0.9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {gruppe.geraeteName}
            </div>
          )}
        </div>
        <small style={{ opacity: 0.85, flexShrink: 0, fontSize: "0.72rem" }}>{datumStr}</small>
      </div>

      {/* ── Items — ALL of them, no clipping ── */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {anfragen.map((a, idx) => (
          <AnfragenItem
            key={a.id}
            anfrage={a}
            idx={idx}
            onStorno={() => onStorno({ id: a.id, teil: a.teil, techniker: a.techniker, logId: a.logId })}
          />
        ))}
      </div>

      {/* ── Chat-Bereich (immer anzeigen wenn Anfragen vorhanden) ── */}
      {gruppe.anfragen.length > 0 && (
        <GruppenNachrichten
          anfrageIds={gruppe.anfragen.map((a) => a.id)}
          kuerzel={kuerzel}
          bezugInfo={[gruppe.geraeteName, hasRealLogId ? gruppe.logId : undefined].filter(Boolean).join(" · ") || undefined}
        />
      )}

      {/* ── Footer ── */}
      <div style={{
        padding:      "8px 16px",
        background:   "var(--bg)",
        fontSize:     "0.78rem",
        color:        "var(--text-dim)",
        textAlign:    "right",
        borderTop:    "1px solid var(--border)",
        borderRadius: "0 0 12px 12px",
      }}>
        {anfragen.length} {anfragen.length === 1 ? "Teil" : "Teile"}
      </div>
    </div>
  );
}

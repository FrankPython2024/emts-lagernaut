"use client";
import { TEIL_ICONS, STATUS_CFG, type AnfrageRow } from "./constants";

interface Props {
  anfrage: AnfrageRow;
  idx:     number;
  onStorno: () => void;
}

export default function AnfragenItem({ anfrage, idx, onStorno }: Props) {
  const cfg             = STATUS_CFG[anfrage.status] ?? STATUS_CFG["STORNIERT"]!;
  const canStorno       = anfrage.status === "NEU" || anfrage.status === "BEDARF";
  const isAbgeschlossen = anfrage.status === "ABGESCHLOSSEN";
  const isStorniert     = anfrage.status === "STORNIERT";
  const isInBearbeitung = anfrage.status === "IN_BEARBEITUNG";
  const odd             = idx % 2 === 1;

  const bearbeitetSeitStr = anfrage.bearbeitetSeit
    ? new Date(anfrage.bearbeitetSeit).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div style={{
      padding:    "10px 16px",
      background: isInBearbeitung
        ? "rgba(251,191,36,0.07)"
        : odd ? "var(--card-bg)" : "var(--bg)",
      borderTop:  idx > 0 ? "1px solid var(--border)" : "none",
    }}>
      {/* Row 1: Icon + Name + Grade + Status + Action */}
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: "1.1rem", flexShrink: 0 }}>
          {TEIL_ICONS[anfrage.teil] ?? "🔧"}
        </span>

        <strong style={{ fontSize: "0.9rem", flex: "1 1 80px", minWidth: 0 }}>
          {anfrage.teil}
        </strong>

        {anfrage.grading ? (
          <span style={{ padding: "2px 7px", borderRadius: 5, background: "var(--border)", color: "var(--text-dim)", fontSize: "0.72rem", fontWeight: 700, flexShrink: 0 }}>
            {anfrage.grading}
          </span>
        ) : (
          <span style={{ padding: "2px 7px", borderRadius: 5, background: "rgba(0,100,210,0.1)", color: "var(--primary)", fontSize: "0.68rem", fontWeight: 600, flexShrink: 0 }}>
            Bestmöglich
          </span>
        )}

        <span style={{
          padding: "3px 9px", borderRadius: 12, fontWeight: 800, fontSize: "0.7rem",
          textTransform: "uppercase", whiteSpace: "nowrap", flexShrink: 0,
          background: cfg.bg, color: cfg.color,
        }}>
          {cfg.label}
        </span>

        {isAbgeschlossen && (
          <small style={{ color: "var(--text-dim)", fontSize: "0.7rem", flexShrink: 0 }}>
            {new Date(anfrage.datum).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
          </small>
        )}

        {canStorno && (
          <button
            onClick={onStorno}
            style={{
              background: "none", border: "1px solid var(--danger)", color: "var(--danger)",
              padding: "10px 12px", minHeight: 44, borderRadius: 8, cursor: "pointer",
              fontSize: "0.72rem", fontWeight: "bold", fontFamily: "'Ubuntu', sans-serif",
              flexShrink: 0, display: "flex", alignItems: "center",
            }}
          >
            Storno
          </button>
        )}
      </div>

      {/* Row 2: Statushinweise */}
      {isAbgeschlossen && (
        <div style={{ fontSize: "0.78rem", color: "var(--success)", fontWeight: 700, marginTop: 4, paddingLeft: 28 }}>
          ✅ Bereit zur Abholung!
          {anfrage.bearbeitetVon && (
            <span style={{ fontWeight: 400, color: "var(--text-dim)", marginLeft: 8 }}>
              bearbeitet von {anfrage.bearbeitetVon}
            </span>
          )}
        </div>
      )}
      {isInBearbeitung && anfrage.bearbeitetVon && (
        <div style={{ fontSize: "0.75rem", color: "#92400e", fontWeight: 600, marginTop: 4, paddingLeft: 28 }}>
          🔧 {anfrage.bearbeitetVon} bearbeitet gerade
          {bearbeitetSeitStr && <span style={{ fontWeight: 400, marginLeft: 4 }}>· seit {bearbeitetSeitStr}</span>}
        </div>
      )}
      {isStorniert && (
        <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", fontStyle: "italic", marginTop: 4, paddingLeft: 28 }}>
          Storniert
        </div>
      )}
      {anfrage.kommentar && !isAbgeschlossen && !isInBearbeitung && (
        <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", fontStyle: "italic", marginTop: 4, paddingLeft: 28 }}>
          💬 {anfrage.kommentar}
        </div>
      )}
    </div>
  );
}

export type { AnfrageRow };

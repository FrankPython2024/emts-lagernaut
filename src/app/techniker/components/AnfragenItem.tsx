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
  const odd             = idx % 2 === 1;

  return (
    <div style={{
      padding:    "10px 16px",
      background: odd ? "var(--card-bg)" : "var(--bg)",
      borderTop:  idx > 0 ? "1px solid var(--border)" : "none",
      // NO overflow: hidden — every item must be fully visible!
    }}>
      {/* Row 1: Icon + Name + Grade + Status + Action */}
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, minWidth: 0 }}>
        {/* Icon */}
        <span style={{ fontSize: "1.1rem", flexShrink: 0 }}>
          {TEIL_ICONS[anfrage.teil] ?? "🔧"}
        </span>

        {/* Part name */}
        <strong style={{ fontSize: "0.9rem", flex: "1 1 80px", minWidth: 0 }}>
          {anfrage.teil}
        </strong>

        {/* Grading badge */}
        {anfrage.grading && (
          <span style={{
            padding:      "2px 7px",
            borderRadius: 5,
            background:   "var(--border)",
            color:        "var(--text-dim)",
            fontSize:     "0.72rem",
            fontWeight:   700,
            flexShrink:   0,
          }}>
            {anfrage.grading}
          </span>
        )}

        {/* Status badge */}
        <span style={{
          padding:       "3px 9px",
          borderRadius:  12,
          fontWeight:    800,
          fontSize:      "0.7rem",
          textTransform: "uppercase",
          whiteSpace:    "nowrap",
          flexShrink:    0,
          background:    cfg.bg,
          color:         cfg.color,
        }}>
          {cfg.label}
        </span>

        {/* Abgeschlossen time */}
        {isAbgeschlossen && (
          <small style={{ color: "var(--text-dim)", fontSize: "0.7rem", flexShrink: 0 }}>
            {new Date(anfrage.datum).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
          </small>
        )}

        {/* Storno button — min 44px touch target */}
        {canStorno && (
          <button
            onClick={onStorno}
            style={{
              background:   "none",
              border:       "1px solid var(--danger)",
              color:        "var(--danger)",
              padding:      "10px 12px",
              minHeight:    44,
              borderRadius: 8,
              cursor:       "pointer",
              fontSize:     "0.72rem",
              fontWeight:   "bold",
              fontFamily:   "'Ubuntu', sans-serif",
              flexShrink:   0,
              display:      "flex",
              alignItems:   "center",
            }}
          >
            Storno
          </button>
        )}
      </div>

      {/* Row 2: Kommentar / Status-Hinweis */}
      {isAbgeschlossen && (
        <div style={{ fontSize: "0.78rem", color: "var(--success)", fontWeight: 700, marginTop: 4, paddingLeft: 28 }}>
          ✅ Bereit zur Abholung!
        </div>
      )}
      {isStorniert && (
        <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", fontStyle: "italic", marginTop: 4, paddingLeft: 28 }}>
          Storniert
        </div>
      )}
      {anfrage.kommentar && !isAbgeschlossen && (
        <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", fontStyle: "italic", marginTop: 4, paddingLeft: 28 }}>
          💬 {anfrage.kommentar}
        </div>
      )}
    </div>
  );
}

export type { AnfrageRow };

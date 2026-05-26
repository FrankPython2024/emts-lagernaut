"use client";
import { useState } from "react";

// ── Keyboard layout constants (mirrors techniker.html exactly) ───────────────
const B = 36, G = 2;
const kw = (units: number) => Math.round(units * (B + G) - G);

type KeyDef   = { id: string; b: string; t?: string; w: number } | null;
type RowDef   = { h: number; keys: KeyDef[] };
type NavRow   = ({ id: string; b: string; w: number } | null)[] | null;
type NumKey   = [string, string, string | null, number, number, number, number];

const KB_ROWS: RowDef[] = [
  { h: 28, keys: [
    { id: "Esc",    b: "Esc",     w: kw(1) }, null,
    { id: "F1",  b: "F1",  w: kw(1) }, { id: "F2",  b: "F2",  w: kw(1) },
    { id: "F3",  b: "F3",  w: kw(1) }, { id: "F4",  b: "F4",  w: kw(1) }, null,
    { id: "F5",  b: "F5",  w: kw(1) }, { id: "F6",  b: "F6",  w: kw(1) },
    { id: "F7",  b: "F7",  w: kw(1) }, { id: "F8",  b: "F8",  w: kw(1) }, null,
    { id: "F9",  b: "F9",  w: kw(1) }, { id: "F10", b: "F10", w: kw(1) },
    { id: "F11", b: "F11", w: kw(1) }, { id: "F12", b: "F12", w: kw(1) }, null,
    { id: "Druck",  b: "Druck",  t: "S-Abf",  w: kw(1.1) },
    { id: "Rollen", b: "Rollen", t: "↓",      w: kw(1.1) },
    { id: "Pause",  b: "Pause",  t: "Untbr",  w: kw(1.1) },
  ]},
  { h: 36, keys: [
    { id: "°^",  t: "°",  b: "^",  w: kw(1) }, { id: "!1",  t: "!",  b: "1",  w: kw(1) },
    { id: '"2',  t: '"',  b: "2",  w: kw(1) }, { id: "§3",  t: "§",  b: "3",  w: kw(1) },
    { id: "$4",  t: "$",  b: "4",  w: kw(1) }, { id: "%5",  t: "%",  b: "5",  w: kw(1) },
    { id: "&6",  t: "&",  b: "6",  w: kw(1) }, { id: "/7",  t: "/",  b: "7",  w: kw(1) },
    { id: "(8",  t: "(",  b: "8",  w: kw(1) }, { id: ")9",  t: ")",  b: "9",  w: kw(1) },
    { id: "=0",  t: "=",  b: "0",  w: kw(1) }, { id: "?ß",  t: "?",  b: "ß",  w: kw(1) },
    { id: "`´",  t: "`",  b: "´",  w: kw(1) }, { id: "Backspace", b: "⌫", w: kw(2) },
  ]},
  { h: 36, keys: [
    { id: "Tab",   b: "Tab ⇥", w: kw(1.5) },
    { id: "Q", t: "@", b: "Q", w: kw(1) }, { id: "W",        b: "W", w: kw(1) },
    { id: "E", t: "€", b: "E", w: kw(1) }, { id: "R",        b: "R", w: kw(1) },
    { id: "T",        b: "T", w: kw(1) }, { id: "Z",        b: "Z", w: kw(1) },
    { id: "U",        b: "U", w: kw(1) }, { id: "I",        b: "I", w: kw(1) },
    { id: "O",        b: "O", w: kw(1) }, { id: "P",        b: "P", w: kw(1) },
    { id: "Ü",        b: "Ü", w: kw(1) }, { id: "+*", t: "*", b: "+", w: kw(1) },
    { id: "Enter", b: "Enter ↵", w: kw(1.8) },
  ]},
  { h: 36, keys: [
    { id: "Caps", b: "⇪ Caps", w: kw(1.8) },
    { id: "A", b: "A", w: kw(1) }, { id: "S", b: "S", w: kw(1) }, { id: "D", b: "D", w: kw(1) },
    { id: "F", b: "F", w: kw(1) }, { id: "G", b: "G", w: kw(1) }, { id: "H", b: "H", w: kw(1) },
    { id: "J", b: "J", w: kw(1) }, { id: "K", b: "K", w: kw(1) }, { id: "L", b: "L", w: kw(1) },
    { id: "Ö", b: "Ö", w: kw(1) }, { id: "Ä", b: "Ä", w: kw(1) },
    { id: "'#", t: "'", b: "#", w: kw(1.3) },
  ]},
  { h: 36, keys: [
    { id: "Shift-L", b: "⇧ Shift", w: kw(2.3) },
    { id: "<>", t: ">", b: "<", w: kw(1) },
    { id: "Y", b: "Y", w: kw(1) }, { id: "X", b: "X", w: kw(1) }, { id: "C", b: "C", w: kw(1) },
    { id: "V", b: "V", w: kw(1) }, { id: "B", b: "B", w: kw(1) }, { id: "N", b: "N", w: kw(1) },
    { id: "M", b: "M", w: kw(1) },
    { id: ";,", t: ";", b: ",", w: kw(1) }, { id: ":.", t: ":", b: ".", w: kw(1) },
    { id: "-_", t: "_", b: "-", w: kw(1) }, { id: "Shift-R", b: "Shift ⇧", w: kw(2.9) },
  ]},
  { h: 36, keys: [
    { id: "Strg-L",   b: "Strg",   w: kw(1.4) }, { id: "Win-L",  b: "⊞ Win", w: kw(1.3) },
    { id: "FN",        b: "FN",     w: kw(1.1) }, { id: "Alt",    b: "Alt",   w: kw(1.3) },
    { id: "Leertaste", b: "",       w: kw(6.3) },
    { id: "AltGr",     b: "AltGr",  w: kw(1.3) }, { id: "Win-R",  b: "⊞",    w: kw(1.1) },
    { id: "Menü",      b: "☰",      w: kw(1.1) }, { id: "Strg-R", b: "Strg",  w: kw(1.4) },
  ]},
];

const NAV_ROWS: NavRow[] = [
  [{ id: "Einfg", b: "Einfg", w: kw(1) }, { id: "Pos1", b: "Pos1", w: kw(1) }, { id: "Bild↑", b: "Bild↑", w: kw(1) }],
  [{ id: "Entf",  b: "Entf",  w: kw(1) }, { id: "Ende", b: "Ende", w: kw(1) }, { id: "Bild↓", b: "Bild↓", w: kw(1) }],
  null,
  [null, { id: "↑", b: "↑", w: kw(1) }, null],
  [{ id: "←", b: "←", w: kw(1) }, { id: "↓", b: "↓", w: kw(1) }, { id: "→", b: "→", w: kw(1) }],
];

const NUM_GRID: NumKey[] = [
  ["Num",      "Num",   "↓",     1, 1, 1, 1],
  ["Num÷",     "÷",     null,    2, 1, 1, 1],
  ["Num×",     "×",     null,    3, 1, 1, 1],
  ["Num-",     "−",     null,    4, 1, 1, 1],
  ["Num7",     "7",     "Pos1",  1, 2, 1, 1],
  ["Num8",     "8",     "↑",     2, 2, 1, 1],
  ["Num9",     "9",     "Bild↑", 3, 2, 1, 1],
  ["Num+",     "+",     null,    4, 2, 1, 2],
  ["Num4",     "4",     "←",     1, 3, 1, 1],
  ["Num5",     "5",     null,    2, 3, 1, 1],
  ["Num6",     "6",     "→",     3, 3, 1, 1],
  ["Num1",     "1",     "Ende",  1, 4, 1, 1],
  ["Num2",     "2",     "↓",     2, 4, 1, 1],
  ["Num3",     "3",     "Bild↓", 3, 4, 1, 1],
  ["NumEnter", "Enter", null,    4, 4, 1, 2],
  ["Num0",     "0",     "Einfg", 1, 5, 2, 1],
  ["Num,",     ",",     "Entf",  3, 5, 1, 1],
];

const KEY_LABELS: Record<string, string> = {
  "Shift-L": "Shift", "Shift-R": "Shift",
  "Strg-L": "Strg",   "Strg-R": "Strg",
  "Win-L": "Win",     "Win-R": "Win",
  "Backspace": "Backspace", "Tab": "Tab", "Caps": "Caps Lock",
  "Enter": "Enter",   "Leertaste": "Leertaste",
  "Druck": "Druck/S-Abf", "Rollen": "Rollen", "Pause": "Pause/Untbr",
  "°^": "°/^",   '"2': '"/2',  "§3": "§/3",  "$4": "$/4",
  "%5": "%/5",   "&6": "&/6",   "/7": "//7",  "(8": "(/8",
  ")9": ")/9",   "=0": "=/0",   "?ß": "?/ß",  "`´": "`/´",
  "+*": "+/*",   "'#": "'/#",  "<>": "</>",  ";,": ";/,",
  ":.": ":/.",   "-_": "-/_",   "!1": "!/1",
  "Num÷": "Num÷", "Num×": "Num×", "Num-": "Num−", "Num+": "Num+",
  "NumEnter": "Num↵", "Num0": "Num 0", "Num,": "Num ,",
  "Bild↑": "Bild↑", "Bild↓": "Bild↓", "FN": "FN",
};

// ── Key button styles ─────────────────────────────────────────────────────────

const KEY_BASE: React.CSSProperties = {
  fontSize: "9px",
  background: "linear-gradient(180deg, #e0e0e0 0%, #d0d0d0 100%)",
  border: "1px solid #b0b0b0",
  borderBottom: "2px solid #999",
  color: "#222",
  borderRadius: "4px",
  cursor: "pointer",
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  justifyContent: "space-between",
  padding: "3px 4px 2px",
  flexShrink: 0,
  transition: "all 0.07s",
  fontFamily: "'Ubuntu', sans-serif",
  boxShadow: "0 2px 0 #999, 0 1px 3px rgba(0,0,0,0.2)",
  overflow: "hidden",
  position: "relative",
};

const KEY_SELECTED: React.CSSProperties = {
  background: "linear-gradient(180deg, #1a7fe8 0%, #0055b8 100%)",
  color: "white",
  borderColor: "#004fa3",
  borderBottom: "2px solid #003070",
  boxShadow: "0 2px 0 #003070",
};

const FN_H = 28;
const SPACER_H = FN_H + G;

// ── Component ─────────────────────────────────────────────────────────────────

interface TastaturModalProps {
  open:        boolean;
  articleName: string;
  onConfirm:   (kommentar: string) => void;
  onClose:     () => void;
}

export function TastaturModal({ open, articleName, onConfirm, onClose }: TastaturModalProps) {
  const [step,         setStep]         = useState<1 | 2>(1);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  if (!open) return null;

  function toggleKey(id: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function resetAndClose() {
    setStep(1);
    setSelectedKeys(new Set());
    onClose();
  }

  function handleKomplett() {
    onConfirm("Komplette Tastatur");
    resetAndClose();
  }

  function handleWeiter() {
    if (selectedKeys.size === 0) return;
    const labels = Array.from(selectedKeys)
      .map((k) => KEY_LABELS[k] ?? k)
      .join(", ");
    onConfirm(`Tasten: ${labels}`);
    resetAndClose();
  }

  function renderKey(key: KeyDef, h: number) {
    if (!key) return <div key={Math.random()} style={{ width: 6, flexShrink: 0 }} />;
    const sel = selectedKeys.has(key.id);
    return (
      <button
        key={key.id}
        onClick={() => toggleKey(key.id)}
        style={{
          ...KEY_BASE,
          width:  key.w + "px",
          height: h + "px",
          ...(sel ? KEY_SELECTED : {}),
        }}
      >
        {key.t && (
          <span style={{ fontSize: "7px", color: sel ? "rgba(255,255,255,0.75)" : "#555", lineHeight: 1 }}>
            {key.t}
          </span>
        )}
        <span style={{
          fontSize:   key.t ? "10px" : "9px",
          fontWeight: 700,
          lineHeight: 1,
          ...(key.t ? {} : { width: "100%", textAlign: "center", alignSelf: "center" }),
        }}>
          {key.b}
        </span>
      </button>
    );
  }

  const selectedLabel = Array.from(selectedKeys).map((k) => KEY_LABELS[k] ?? k).join(", ");

  // ── Overlay styles ──────────────────────────────────────────────────────────
  const overlayStyle: React.CSSProperties = {
    display:        "flex",
    position:       "fixed",
    top: 0, left: 0,
    width: "100%", height: "100%",
    background:     "rgba(0,0,0,0.75)",
    backdropFilter: "blur(4px)",
    zIndex:         10000,
    justifyContent: "center",
    alignItems:     "flex-start",
    overflowY:      "auto",
    padding:        "10px",
    boxSizing:      "border-box",
  };

  const contentStyle: React.CSSProperties = {
    background:   "var(--card-bg)",
    width:        "fit-content",
    maxWidth:     "97vw",
    minWidth:     "500px",
    border:       "2px solid var(--primary)",
    borderRadius: "15px",
    padding:      "1.5rem",
    margin:       "auto",
    textAlign:    "left",
    boxShadow:    "0 20px 40px rgba(0,0,0,0.3)",
    color:        "var(--text)",
  };

  return (
    <div style={overlayStyle} onClick={resetAndClose}>
      <div style={contentStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <span style={{ fontSize: "2rem", lineHeight: 1 }}>⌨️</span>
          <div>
            <h3 style={{ margin: 0, color: "var(--primary)", fontSize: "1.1rem" }}>Tastatur-Anfrage</h3>
            <p style={{ margin: "2px 0 0", color: "var(--text-dim)", fontSize: "0.9rem" }}>{articleName}</p>
          </div>
        </div>
        <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "1rem 0" }} />

        {/* ── Step 1: Komplett / Einzeln ── */}
        {step === 1 && (
          <div>
            <p style={{ fontWeight: "bold", textAlign: "center", marginBottom: "1.2rem" }}>Was wird benötigt?</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 15, marginBottom: "1.2rem" }}>
              <button
                onClick={handleKomplett}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center",
                  justifyContent: "center", gap: 8, padding: "1.5rem 1rem",
                  borderRadius: 12, border: "2px solid transparent",
                  cursor: "pointer", background: "var(--primary)", color: "white",
                  fontFamily: "'Ubuntu', sans-serif", fontWeight: "bold",
                  transition: "all 0.2s",
                }}
              >
                <span style={{ fontSize: "2.5rem", lineHeight: 1 }}>⌨️</span>
                <span style={{ fontSize: "1rem" }}>Komplette Tastatur</span>
                <span style={{ fontSize: "0.75rem", opacity: 0.85, fontWeight: "normal" }}>
                  Die gesamte Tastatur ist defekt / fehlt
                </span>
              </button>
              <button
                onClick={() => setStep(2)}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center",
                  justifyContent: "center", gap: 8, padding: "1.5rem 1rem",
                  borderRadius: 12, border: "2px solid transparent",
                  cursor: "pointer", background: "var(--purple)", color: "white",
                  fontFamily: "'Ubuntu', sans-serif", fontWeight: "bold",
                  transition: "all 0.2s",
                }}
              >
                <span style={{ fontSize: "2.5rem", lineHeight: 1 }}>🔑</span>
                <span style={{ fontSize: "1rem" }}>Einzelne Tasten</span>
                <span style={{ fontSize: "0.75rem", opacity: 0.85, fontWeight: "normal" }}>
                  Nur bestimmte Tasten fehlen oder sind defekt
                </span>
              </button>
            </div>
            <button
              onClick={resetAndClose}
              style={{
                width: "100%", padding: "0.8rem",
                background: "var(--bg)", border: "1px solid var(--border)",
                color: "var(--text-dim)", borderRadius: 8, cursor: "pointer",
                fontFamily: "'Ubuntu', sans-serif",
              }}
            >
              Abbrechen
            </button>
          </div>
        )}

        {/* ── Step 2: QWERTZ Keyboard ── */}
        {step === 2 && (
          <div>
            <p style={{ fontWeight: "bold", margin: "0 0 8px" }}>Defekte / fehlende Tasten auswählen:</p>
            <p style={{ color: "var(--text-dim)", margin: "0 0 12px", fontSize: "0.9rem" }}>
              Klicke auf die betroffenen Tasten. Ausgewählte Tasten werden blau markiert.
            </p>

            {/* Keyboard container — Desktop-only, immer vollständig sichtbar */}
            <div
              style={{
                background: "linear-gradient(160deg, #c8c8c8 0%, #b8b8b8 100%)",
                borderRadius: 10,
                padding: "10px 12px 12px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.3)",
                display: "inline-flex",
                marginBottom: 14,
                position: "relative",
              }}
            >
              {/* EMTS Label + LED */}
              <div style={{
                position: "absolute", top: 8, right: 10,
                display: "flex", alignItems: "center", gap: 5,
                fontSize: 9, fontWeight: 700, letterSpacing: 1,
                color: "#888", zIndex: 10, pointerEvents: "none",
                userSelect: "none",
              }}>
                <span>EMTS</span>
                <span style={{
                  width: 7, height: 7, borderRadius: "50%",
                  background: "#2ecc40",
                  boxShadow: "0 0 4px 1px rgba(46,204,64,0.7)",
                  display: "inline-block",
                }} />
              </div>

              {/* Main keyboard */}
              <div style={{ display: "flex", flexDirection: "column", gap: G, flexShrink: 0 }}>
                {KB_ROWS.map((rowDef, ri) => (
                  <div key={ri} style={{ display: "flex", gap: G, alignItems: "flex-end" }}>
                    {rowDef.keys.map((k, ki) => (
                      <div key={ki}>{renderKey(k, rowDef.h)}</div>
                    ))}
                  </div>
                ))}
              </div>

              {/* Navigation block */}
              <div style={{ display: "flex", flexDirection: "column", gap: G, flexShrink: 0, marginLeft: 8 }}>
                <div style={{ height: SPACER_H }} />
                {NAV_ROWS.map((row, ri) => {
                  if (row === null) {
                    return <div key={ri} style={{ height: B + G }} />;
                  }
                  return (
                    <div key={ri} style={{ display: "flex", gap: G }}>
                      {row.map((k, ki) => {
                        if (!k) return <div key={ki} style={{ width: kw(1) }} />;
                        const sel = selectedKeys.has(k.id);
                        return (
                          <button key={k.id} onClick={() => toggleKey(k.id)} style={{
                            ...KEY_BASE,
                            width: k.w + "px",
                            height: B + "px",
                            ...(sel ? KEY_SELECTED : {}),
                          }}>
                            <span style={{ fontSize: "9px", fontWeight: 700, width: "100%", textAlign: "center", alignSelf: "center", lineHeight: 1 }}>
                              {k.b}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>

              {/* Numpad */}
              <div style={{
                display: "grid",
                gridTemplateColumns: `repeat(4, ${kw(1)}px)`,
                gridTemplateRows:    `repeat(5, ${B}px)`,
                gap: G,
                marginLeft: 8,
                marginTop: SPACER_H + G,
                flexShrink: 0,
              }}>
                {NUM_GRID.map(([id, b, t, col, row, cs, rs]) => {
                  const sel = selectedKeys.has(id);
                  return (
                    <button
                      key={id}
                      onClick={() => toggleKey(id)}
                      style={{
                        ...KEY_BASE,
                        gridColumn:    `${col} / span ${cs}`,
                        gridRow:       `${row} / span ${rs}`,
                        width:         "auto",
                        height:        "auto",
                        flexDirection: "column",
                        ...(sel ? KEY_SELECTED : {}),
                      }}
                    >
                      {t && (
                        <span style={{ fontSize: "7px", color: sel ? "rgba(255,255,255,0.75)" : "#555", lineHeight: 1 }}>
                          {t}
                        </span>
                      )}
                      <span style={{ fontSize: "9px", fontWeight: 700, width: "100%", textAlign: "center", alignSelf: "center", lineHeight: 1 }}>
                        {b}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Selected keys display */}
            <div style={{ marginBottom: 14 }}>
              <small style={{ color: "var(--text-dim)", fontWeight: "bold" }}>Ausgewählte Tasten:</small>
              <div style={{
                minHeight: 40, padding: "8px 12px",
                background: "var(--bg)", borderRadius: 8, marginTop: 6,
                fontWeight: "bold", color: "var(--primary)",
                border: "1px solid var(--border)", wordBreak: "break-all", lineHeight: 1.6,
              }}>
                {selectedLabel || "— noch keine Tasten gewählt —"}
              </div>
            </div>

            {/* Navigation buttons */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <button
                onClick={() => setStep(1)}
                style={{
                  padding: "0.9rem",
                  background: "var(--bg)", border: "1px solid var(--border)",
                  color: "var(--text)", borderRadius: 8, cursor: "pointer",
                  fontFamily: "'Ubuntu', sans-serif", fontWeight: 600,
                }}
              >
                ← Zurück
              </button>
              <button
                onClick={handleWeiter}
                disabled={selectedKeys.size === 0}
                style={{
                  padding: "0.9rem",
                  background: selectedKeys.size === 0 ? "var(--border)" : "var(--primary)",
                  color: selectedKeys.size === 0 ? "var(--text-dim)" : "white",
                  border: "none", borderRadius: 8,
                  cursor: selectedKeys.size === 0 ? "not-allowed" : "pointer",
                  fontFamily: "'Ubuntu', sans-serif", fontWeight: "bold",
                }}
              >
                Weiter → ({selectedKeys.size})
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

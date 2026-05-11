"use client";
import { useState, useEffect, useRef } from "react";
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement,
  LineElement, Filler, Tooltip,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { api }       from "@/trpc/react";
import { useSocket } from "@/hooks/useSocket";
import { EVENTS }    from "@/modules/realtime/events";
import type { TestEvent, MetricUpdate, FinalResult, ErrorDetail, ErrorKategorie, LoadMode } from "@/modules/stresstest/types";
import { LOAD_MODES } from "@/modules/stresstest/types";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

// ── Design Tokens ─────────────────────────────────────────────────────────────

const C = {
  bg:      "#0a0a0f",
  card:    "#14141a",
  border:  "#2a2a35",
  text:    "#e0e0e8",
  dim:     "#666680",
  cyan:    "#00d9ff",
  green:   "#00ff88",
  magenta: "#ff00aa",
  yellow:  "#ffd700",
  red:     "#ff4060",
} as const;

const GLOW_CYAN    = `0 0 12px ${C.cyan}88`;
const GLOW_GREEN   = `0 0 12px ${C.green}88`;
const GLOW_MAGENTA = `0 0 12px ${C.magenta}88`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(ms: number) {
  const s  = Math.floor(ms / 1000);
  const m  = Math.floor(s / 60);
  const h  = Math.floor(m / 60);
  return `${String(h).padStart(2,"0")}:${String(m % 60).padStart(2,"0")}:${String(s % 60).padStart(2,"0")}`;
}

function fmtNum(n: number) {
  return n.toLocaleString("de-DE");
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ data, color, width = 120, height = 24 }: {
  data: number[]; color: string; width?: number; height?: number;
}) {
  if (data.length < 2) {
    return <svg width={width} height={height}><line x1="0" y1={height/2} x2={width} y2={height/2} stroke={color} strokeWidth="1" opacity="0.3" /></svg>;
  }
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - (v / max) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={width} height={height} style={{ overflow: "visible" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
        style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
    </svg>
  );
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, unit = "", color = C.cyan, sub }: {
  label: string; value: string | number; unit?: string; color?: string; sub?: string;
}) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      padding: "1.2rem 1.5rem", display: "flex", flexDirection: "column", gap: 6,
      boxShadow: `inset 0 0 30px ${color}08`,
    }}>
      <div style={{ fontSize: "0.7rem", color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "monospace" }}>
        {label}
      </div>
      <div style={{
        fontSize: "2.2rem", fontWeight: 900, color, fontFamily: "monospace",
        textShadow: `0 0 20px ${color}`, lineHeight: 1,
        transition: "all 0.3s",
      }}>
        {typeof value === "number" ? fmtNum(value) : value}
        {unit && <span style={{ fontSize: "1rem", marginLeft: 4, color: `${color}99` }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: "0.72rem", color: C.dim }}>{sub}</div>}
    </div>
  );
}

// ── Ops Chart ─────────────────────────────────────────────────────────────────

const CHART_OPTIONS = {
  responsive:          true,
  maintainAspectRatio: false,
  animation:           { duration: 200 },
  plugins:             { legend: { display: false }, tooltip: { enabled: true } },
  scales: {
    x: { display: false },
    y: {
      min: 0,
      grid: { color: `${C.border}88` },
      ticks: { color: C.dim, font: { family: "monospace", size: 10 } },
    },
  },
} as const;

// ── Action Color ─────────────────────────────────────────────────────────────

function actionColor(action: string, success: boolean): string {
  if (!success) return C.red;
  if (action.includes("erstellt"))       return C.cyan;
  if (action.includes("erledigt") || action.includes("erledigt")) return C.green;
  if (action.includes("chat"))           return C.yellow;
  if (action.includes("bearbeitung"))    return "#a78bfa";
  if (action.includes("storno"))         return C.magenta;
  if (action.includes("buchung"))        return "#fb923c";
  if (action.includes("race"))           return C.magenta;
  return C.dim;
}

// ── Config Screen ─────────────────────────────────────────────────────────────

const MODE_WARN: Partial<Record<LoadMode, string>> = {
  burst:   "🔥 Hohe Last — viele Aktionen pro Minute",
  extreme: "💀 Extreme Last — DB stark beansprucht",
};

function ConfigScreen({ onStart }: { onStart: (cfg: { duration: number; numTechniker: number; numAdmins: number; loadMode: LoadMode }) => void }) {
  const [duration,     setDuration]     = useState(300_000);
  const [numTechniker, setNumTechniker] = useState(5);
  const [numAdmins,    setNumAdmins]    = useState(2);
  const [loadMode,     setLoadMode]     = useState<LoadMode>("burst");

  const durationOptions = [
    { label: "1 Minute (Smoke)",  value: 60_000 },
    { label: "5 Minuten",         value: 300_000 },
    { label: "15 Minuten",        value: 900_000 },
    { label: "30 Minuten",        value: 1_800_000 },
    { label: "1 Stunde",          value: 3_600_000 },
  ];

  const sel: React.CSSProperties = {
    background: C.card, border: `1px solid ${C.border}`, color: C.text,
    padding: "0.5rem 1rem", borderRadius: 8, fontSize: "0.9rem",
    fontFamily: "monospace", outline: "none", cursor: "pointer", width: "100%",
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace", color: C.text }}>
      <div style={{ background: C.card, border: `1px solid ${C.cyan}44`, borderRadius: 20, padding: "3rem", width: 460, boxShadow: `0 0 60px ${C.cyan}18` }}>

        {/* Titel */}
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: 8 }}>🔬</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 900, color: C.cyan, textShadow: GLOW_CYAN, letterSpacing: "0.05em" }}>
            LAGERNAUT BENCHMARK
          </div>
          <div style={{ fontSize: "0.75rem", color: C.dim, marginTop: 6 }}>Stress-Test · Live Dashboard</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>

          {/* ── Modus-Auswahl ── */}
          <div>
            <div style={{ fontSize: "0.7rem", color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
              Test-Modus
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(Object.entries(LOAD_MODES) as [LoadMode, typeof LOAD_MODES[LoadMode]][]).map(([mode, cfg]) => {
                const active = loadMode === mode;
                return (
                  <button
                    key={mode}
                    onClick={() => setLoadMode(mode)}
                    style={{
                      display:        "flex",
                      alignItems:     "center",
                      gap:            10,
                      padding:        "0.65rem 1rem",
                      borderRadius:   10,
                      border:         `1px solid ${active ? C.cyan : C.border}`,
                      background:     active ? `${C.cyan}18` : "transparent",
                      cursor:         "pointer",
                      textAlign:      "left",
                      fontFamily:     "monospace",
                      color:          C.text,
                      transition:     "all 0.15s",
                    }}
                  >
                    <span style={{ fontSize: "1.1rem", width: 24, textAlign: "center", flexShrink: 0 }}>{cfg.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "0.85rem", fontWeight: active ? 900 : 400, color: active ? C.cyan : C.text }}>
                        {cfg.label}
                      </div>
                      <div style={{ fontSize: "0.62rem", color: C.dim, marginTop: 1 }}>{cfg.beschreibung}</div>
                    </div>
                    <span style={{
                      width: 14, height: 14, borderRadius: "50%",
                      border: `2px solid ${active ? C.cyan : C.border}`,
                      background: active ? C.cyan : "transparent",
                      flexShrink: 0,
                    }} />
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Dauer ── */}
          <div>
            <label style={{ display: "block", fontSize: "0.7rem", color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
              Dauer
            </label>
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} style={sel}>
              {durationOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* ── Akteure ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.7rem", color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
                Techniker ({numTechniker})
              </label>
              <input type="range" min={1} max={10} value={numTechniker} onChange={(e) => setNumTechniker(Number(e.target.value))}
                style={{ width: "100%", accentColor: C.cyan }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.7rem", color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
                Admins ({numAdmins})
              </label>
              <input type="range" min={1} max={3} value={numAdmins} onChange={(e) => setNumAdmins(Number(e.target.value))}
                style={{ width: "100%", accentColor: C.cyan }} />
            </div>
          </div>

          {/* Warnung */}
          {MODE_WARN[loadMode] && (
            <div style={{ background: "#ffd70018", border: "1px solid #ffd70044", borderRadius: 8, padding: "0.7rem 1rem", fontSize: "0.75rem", color: C.yellow }}>
              {MODE_WARN[loadMode]}
            </div>
          )}
          <div style={{ background: "#ffffff08", border: `1px solid ${C.border}`, borderRadius: 8, padding: "0.6rem 1rem", fontSize: "0.7rem", color: C.dim }}>
            ⚠️ Test erzeugt echte Daten in der DB. Markierung: <strong style={{ color: C.text }}>STRESSTEST_*</strong>
          </div>

          <button
            onClick={() => onStart({ duration, numTechniker, numAdmins, loadMode })}
            style={{
              background:    `linear-gradient(135deg, ${C.cyan}33, ${C.cyan}66)`,
              border:        `1px solid ${C.cyan}`,
              color:         C.cyan,
              padding:       "0.9rem",
              borderRadius:  12,
              fontSize:      "1rem",
              fontWeight:    900,
              fontFamily:    "monospace",
              cursor:        "pointer",
              letterSpacing: "0.1em",
              textShadow:    GLOW_CYAN,
              boxShadow:     `0 0 20px ${C.cyan}33`,
              transition:    "all 0.2s",
            }}
          >
            ▶ TEST STARTEN
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Fehler-Sektion ────────────────────────────────────────────────────────────

const KAT_CFG: Record<ErrorKategorie, { label: string; color: string; icon: string }> = {
  race:       { label: "Race Condition",      color: C.green,   icon: "🟢" },
  validation: { label: "Validierung",         color: C.yellow,  icon: "🟡" },
  duplicate:  { label: "Duplikat",            color: C.yellow,  icon: "🟡" },
  stale:      { label: "Stale Reference",     color: "#fb923c", icon: "🟠" },
  api:        { label: "API-Fehler",          color: "#a78bfa", icon: "🟣" },
  bug:        { label: "Echter Bug",          color: C.red,     icon: "🔴" },
};

// Fehler nach Typ + Nachricht (erste 50 Zeichen) gruppieren
interface FehlerGruppe {
  key:       string;
  kategorie: ErrorKategorie;
  beispiel:  ErrorDetail;
  count:     number;
  akteure:   Record<string, number>;
  letzteTs:  number;
  offen:     boolean;
}

function gruppiereErrors(errors: ErrorDetail[]): FehlerGruppe[] {
  const map = new Map<string, FehlerGruppe>();
  for (const err of errors) {
    const key = `${err.kategorie}:${err.message.slice(0, 50)}`;
    if (!map.has(key)) {
      map.set(key, { key, kategorie: err.kategorie, beispiel: err, count: 0, akteure: {}, letzteTs: 0, offen: false });
    }
    const g = map.get(key)!;
    g.count++;
    g.akteure[err.actor] = (g.akteure[err.actor] ?? 0) + 1;
    if (err.ts > g.letzteTs) { g.letzteTs = err.ts; g.beispiel = err; }
  }
  return Array.from(map.values()).sort((a, b) => b.letzteTs - a.letzteTs);
}

function FehlerGruppeKarte({ gruppe, idx }: { gruppe: FehlerGruppe; idx: number }) {
  const [offen, setOffen] = useState(false);
  const kat  = KAT_CFG[gruppe.kategorie];
  const zeit = new Date(gruppe.letzteTs).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const top3Akteure = Object.entries(gruppe.akteure).sort(([, a], [, b]) => b - a).slice(0, 3);

  return (
    <div style={{ background: "#1c1c24", border: `1px solid ${kat.color}44`, borderLeft: `3px solid ${kat.color}`, borderRadius: 8, overflow: "hidden" }}>

      {/* ── Header ── */}
      <button
        onClick={() => setOffen((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "0.6rem 1rem", background: "none", border: "none", cursor: "pointer", color: C.text, fontFamily: "monospace", textAlign: "left" }}
      >
        <span style={{ color: C.dim, fontSize: "0.62rem", flexShrink: 0, width: 18 }}>#{idx + 1}</span>
        <span style={{ fontSize: "0.85rem" }}>{kat.icon}</span>
        <span style={{ color: kat.color, fontSize: "0.7rem", fontWeight: 700, flexShrink: 0 }}>{kat.label}</span>
        {gruppe.count > 1 && (
          <span style={{ background: `${kat.color}33`, color: kat.color, fontSize: "0.62rem", fontWeight: 900, padding: "1px 6px", borderRadius: 99 }}>
            ×{gruppe.count}
          </span>
        )}
        <span style={{ color: C.dim, fontSize: "0.62rem" }}>[{zeit}]</span>
        <span style={{ color: C.cyan, fontSize: "0.7rem", fontWeight: 700, flex: 1 }}>{gruppe.beispiel.action}</span>
        <span style={{ color: offen ? C.cyan : C.dim, fontSize: "0.65rem" }}>{offen ? "▲" : "▼"}</span>
      </button>

      {/* ── Nachricht immer sichtbar ── */}
      <div style={{ padding: "0 1rem 0.5rem 2.8rem" }}>
        <div style={{ fontSize: "0.73rem", color: kat.color, marginBottom: 3 }}>
          {gruppe.beispiel.message.slice(0, 100)}{gruppe.beispiel.message.length > 100 ? "…" : ""}
        </div>
        <div style={{ fontSize: "0.65rem", color: "#00cc99" }}>
          💡 {gruppe.beispiel.empfehlung}
        </div>
      </div>

      {/* ── Details aufgeklappt ── */}
      {offen && (
        <div style={{ padding: "0.6rem 1rem", borderTop: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 8 }}>

          {/* Akteure */}
          <div>
            <div style={{ fontSize: "0.6rem", color: C.dim, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Akteure ({Object.keys(gruppe.akteure).length})
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {top3Akteure.map(([actor, cnt]) => (
                <span key={actor} style={{ background: "#ffffff0d", padding: "2px 8px", borderRadius: 99, fontSize: "0.65rem", color: C.text }}>
                  {actor} <span style={{ color: C.dim }}>×{cnt}</span>
                </span>
              ))}
              {Object.keys(gruppe.akteure).length > 3 && (
                <span style={{ fontSize: "0.65rem", color: C.dim }}>+{Object.keys(gruppe.akteure).length - 3} weitere</span>
              )}
            </div>
          </div>

          {/* ErrorName */}
          <div style={{ fontSize: "0.65rem", color: C.dim }}>
            Error-Typ: <span style={{ color: "#fb923c", fontWeight: 700 }}>{gruppe.beispiel.errorName}</span>
          </div>

          {/* Stack-Trace */}
          {gruppe.beispiel.stack && (
            <div>
              <div style={{ fontSize: "0.6rem", color: C.dim, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Stack Trace (Beispiel)
              </div>
              <pre style={{ margin: 0, fontSize: "0.6rem", color: "#888", lineHeight: 1.5, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 120 }}>
                {gruppe.beispiel.stack}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FehlerSektion({ errors }: { errors: ErrorDetail[] }) {
  const [filter,       setFilter]       = useState<ErrorKategorie | "alle">("alle");
  const [filterAkteur, setFilterAkteur] = useState("");

  if (errors.length === 0) return null;

  const gefiltert = errors.filter((e) => {
    if (filter !== "alle" && e.kategorie !== filter) return false;
    if (filterAkteur && !e.actor.toUpperCase().includes(filterAkteur.toUpperCase())) return false;
    return true;
  });

  const gruppen = gruppiereErrors(gefiltert);

  const counts: Partial<Record<ErrorKategorie, number>> = {};
  for (const e of errors) counts[e.kategorie] = (counts[e.kategorie] ?? 0) + 1;

  function exportJson() {
    const blob = new Blob([JSON.stringify(errors, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `stresstest-errors-${Date.now()}.json`;
    a.click(); URL.revokeObjectURL(url);
  }

  const tabStyle = (active: boolean, color: string): React.CSSProperties => ({
    padding: "3px 10px", borderRadius: 99, border: `1px solid ${active ? color : C.border}`,
    background: active ? `${color}22` : "transparent",
    color: active ? color : C.dim, fontSize: "0.65rem", fontFamily: "monospace",
    fontWeight: active ? 700 : 400, cursor: "pointer",
  });

  return (
    <div style={{ background: C.card, border: `1px solid ${C.red}44`, borderRadius: 12, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "0.7rem 1rem", background: "#1c1c24", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ color: C.red, fontSize: "0.65rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>
          ❌ Fehler ({errors.length})
        </span>

        {/* Kategorie-Badges */}
        <div style={{ display: "flex", gap: 4, flex: 1, flexWrap: "wrap" }}>
          <button onClick={() => setFilter("alle")} style={tabStyle(filter === "alle", C.text)}>
            Alle {errors.length}
          </button>
          {(Object.entries(KAT_CFG) as [ErrorKategorie, typeof KAT_CFG[ErrorKategorie]][]).map(([kat, cfg]) =>
            (counts[kat] ?? 0) > 0 ? (
              <button key={kat} onClick={() => setFilter(kat)} style={tabStyle(filter === kat, cfg.color)}>
                {cfg.icon} {cfg.label} {counts[kat]}
              </button>
            ) : null
          )}
        </div>

        {/* Akteur-Filter */}
        <input
          value={filterAkteur}
          onChange={(e) => setFilterAkteur(e.target.value)}
          placeholder="Akteur…"
          style={{
            background: "#14141a", border: `1px solid ${C.border}`, color: C.text,
            padding: "3px 8px", borderRadius: 6, fontSize: "0.65rem", fontFamily: "monospace",
            width: 80, outline: "none",
          }}
        />

        {/* Export */}
        <button
          onClick={exportJson}
          style={{
            background: "#ffffff08", border: `1px solid ${C.border}`, color: C.dim,
            padding: "3px 10px", borderRadius: 6, fontSize: "0.65rem", fontFamily: "monospace",
            cursor: "pointer",
          }}
        >
          ⬇ JSON
        </button>
      </div>

      {/* Erklärung Kategorien */}
      <div style={{ padding: "0.45rem 1rem", background: "#14141a", borderBottom: `1px solid ${C.border}`, display: "flex", gap: "1.5rem", flexWrap: "wrap", fontSize: "0.6rem", color: C.dim }}>
        <span>🟢 Race — erwartet, kein Bug</span>
        <span>🟡 Validierung / Duplikat — Eingaben prüfen</span>
        <span>🟠 Stale Ref — Timing-Problem</span>
        <span>🟣 API — Logik-Fehler</span>
        <span>🔴 Bug — Code prüfen</span>
      </div>

      {/* Gruppiete Fehler-Liste */}
      <div style={{ padding: "0.75rem", display: "flex", flexDirection: "column", gap: 6, maxHeight: 500, overflowY: "auto" }}>
        {gruppen.length === 0 && (
          <div style={{ textAlign: "center", padding: "1.5rem", color: C.dim, fontSize: "0.75rem" }}>
            Keine Fehler für diesen Filter
          </div>
        )}
        {gruppen.map((g, i) => (
          <FehlerGruppeKarte key={g.key} gruppe={g} idx={i} />
        ))}
      </div>
    </div>
  );
}

// ── Running Dashboard ─────────────────────────────────────────────────────────

function RunningDashboard({
  runId, config, onStop, onDone,
}: {
  runId: string;
  config: { duration: number; numTechniker: number; numAdmins: number; loadMode: LoadMode };
  onStop: () => void;
  onDone: (r: FinalResult) => void;
}) {
  const { on, off, connected } = useSocket();

  // State
  const [elapsed,     setElapsed]     = useState(0);
  const [metrics,     setMetrics]     = useState<MetricUpdate | null>(null);
  const [events,      setEvents]      = useState<TestEvent[]>([]);
  const [chartLabels, setChartLabels] = useState<string[]>([]);
  const [chartOps,    setChartOps]    = useState<number[]>([]);
  const [workerHist,  setWorkerHist]  = useState<Record<string, number[]>>({});
  const [errors,      setErrors]      = useState<ErrorDetail[]>([]);
  const logRef       = useRef<HTMLDivElement>(null);
  const atBottomRef  = useRef(true);
  const startRef     = useRef(Date.now());
  const seenTsRef    = useRef<Set<number>>(new Set());

  // ── Polling-Fallback (1s) — funktioniert auch ohne Socket.io ──────────────
  const { data: pollData } = api.stresstest.getStatus.useQuery(undefined, {
    refetchInterval: 1_000,
  });

  useEffect(() => {
    if (!pollData?.recentEvents?.length) return;
    const neu = pollData.recentEvents.filter((ev) => !seenTsRef.current.has(ev.ts));
    if (!neu.length) return;
    neu.forEach((ev) => seenTsRef.current.add(ev.ts));
    setEvents((prev) => [...neu.reverse(), ...prev].slice(0, 150));
  }, [pollData]);

  // Fehler aus Poll-State synchronisieren
  useEffect(() => {
    const serverErrors = pollData?.state?.errors;
    if (serverErrors?.length) {
      setErrors(serverErrors as ErrorDetail[]);
    }
  }, [pollData?.state?.errors?.length]);

  // Stoppe wenn Server sagt: nicht mehr running
  useEffect(() => {
    if (pollData && !pollData.running && elapsed > 5_000) {
      // Test auf Server beendet — kein Socket-Event empfangen
      // Warte kurz, dann Config-Screen
      setTimeout(() => onStop(), 1_000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollData?.running]);

  // Timer
  useEffect(() => {
    const iv = setInterval(() => setElapsed(Date.now() - startRef.current), 1000);
    return () => clearInterval(iv);
  }, []);

  // ── Socket: direkte Events (sofort, kein Polling-Delay) ────────────────────
  useEffect(() => {
    on(EVENTS.STRESSTEST_EVENT, (d: unknown) => {
      const ev = d as TestEvent;
      if (seenTsRef.current.has(ev.ts)) return;
      seenTsRef.current.add(ev.ts);
      setEvents((prev) => [ev, ...prev].slice(0, 150));
    });

    on(EVENTS.STRESSTEST_METRICS, (d: unknown) => {
      const m = d as MetricUpdate;
      setMetrics(m);

      const t = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setChartLabels((prev) => [...prev, t].slice(-60));
      setChartOps((prev)    => [...prev, m.opsPerSecond].slice(-60));

      setWorkerHist((prev) => {
        const next = { ...prev };
        for (const [actor, val] of Object.entries(m.workerActivity)) {
          next[actor] = [...(next[actor] ?? []), val].slice(-30);
        }
        return next;
      });
    });

    on(EVENTS.STRESSTEST_DONE, (d: unknown) => {
      onDone(d as FinalResult);
    });

    return () => {
      off(EVENTS.STRESSTEST_EVENT);
      off(EVENTS.STRESSTEST_METRICS);
      off(EVENTS.STRESSTEST_DONE);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current && atBottomRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events]);

  const progress = Math.min(100, (elapsed / config.duration) * 100);
  const m = metrics;

  const chartData = {
    labels: chartLabels,
    datasets: [{
      label: "Ops/s",
      data:  chartOps,
      borderColor:     C.cyan,
      backgroundColor: `${C.cyan}18`,
      fill: true,
      tension: 0.4,
      pointRadius: 0,
      borderWidth: 2,
    }],
  };

  const panel: React.CSSProperties = {
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden",
  };
  const panelHead: React.CSSProperties = {
    padding: "0.6rem 1rem", background: "#1c1c24", borderBottom: `1px solid ${C.border}`,
    fontSize: "0.65rem", color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em",
  };

  const workerActors = Object.keys(workerHist);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "monospace", color: C.text, padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>

      {/* ── Header ── */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "1rem", fontWeight: 900, color: C.cyan, letterSpacing: "0.15em", textShadow: GLOW_CYAN }}>
          LAGERNAUT STRESS-TEST
        </div>
        <div style={{ fontSize: "2rem", fontWeight: 900, color: C.text, marginTop: 4, letterSpacing: "0.05em" }}>
          {fmtTime(elapsed)} <span style={{ color: C.dim, fontSize: "1rem" }}>/ {fmtTime(config.duration)}</span>
        </div>
        <div style={{ margin: "0.5rem auto", maxWidth: 600, height: 8, background: C.border, borderRadius: 99, overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${progress}%`,
            background: `linear-gradient(90deg, ${C.cyan}, ${C.green})`,
            borderRadius: 99, transition: "width 1s linear",
            boxShadow: GLOW_CYAN,
          }} />
        </div>
        <div style={{ fontSize: "0.8rem", color: C.cyan }}>{progress.toFixed(1)}%</div>
        <div style={{ fontSize: "0.65rem", marginTop: 4, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <span style={{ color: connected ? C.green : C.yellow }}>
            {connected ? "⬤ Socket live" : "⬤ Polling-Fallback aktiv"}
          </span>
          <span style={{ color: C.dim }}>·</span>
          <span style={{ color: C.dim }}>Run: {runId}</span>
          <span style={{ color: C.dim }}>·</span>
          <span style={{ color: C.yellow }}>{LOAD_MODES[config.loadMode]?.icon} {LOAD_MODES[config.loadMode]?.label}</span>
          <span style={{ color: C.dim }}>·</span>
          <span style={{ color: C.dim }}>{events.length} Events</span>
        </div>
      </div>

      {/* ── Ops Chart ── */}
      <div style={panel}>
        <div style={panelHead}>Operations / Second</div>
        <div style={{ padding: "1rem", height: 140 }}>
          <Line data={chartData} options={CHART_OPTIONS as Parameters<typeof Line>[0]["options"]} />
        </div>
        <div style={{ display: "flex", gap: "2rem", padding: "0 1rem 0.8rem", fontSize: "0.75rem", color: C.dim }}>
          <span>Live: <strong style={{ color: C.cyan, textShadow: GLOW_CYAN }}>{m?.opsPerSecond ?? 0} ops/s</strong></span>
          <span>Peak: <strong style={{ color: C.green }}>{m ? Math.max(...chartOps, 0) : 0}</strong></span>
          <span>Total: <strong style={{ color: C.text }}>{fmtNum(m?.totalOps ?? 0)}</strong></span>
        </div>
      </div>

      {/* ── KPI Row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem" }}>
        <KpiCard label="Total Ops"       value={m?.totalOps ?? 0}         color={C.cyan}    sub={`+${m?.opsPerSecond ?? 0}/s`} />
        <KpiCard label="Avg Response"    value={m?.avgResponseTime ?? 0}  color={C.green}   unit="ms" sub={`Peak: ${m?.peakResponseTime ?? 0}ms`} />
        <KpiCard label="Error Rate"      value={(m?.errorRate ?? 0).toFixed(1)} color={m && m.errorRate > 2 ? C.red : C.yellow} unit="%" sub={`${m?.totalErrors ?? 0} Fehler`} />
        <KpiCard label="Memory"          value={m?.memMB ?? 0}            color="#a78bfa"   unit="MB" sub={`${m?.socketClients ?? 0} Socket-Clients`} />
      </div>

      {/* ── Log + Worker Activity ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "0.75rem" }}>

        {/* Log Stream */}
        <div style={panel}>
          <div style={{ ...panelHead, display: "flex", justifyContent: "space-between" }}>
            <span>Live Log Stream</span>
            <span style={{ color: C.green }}>{events.length} Events</span>
          </div>
          <div
            ref={logRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
            style={{ height: 240, overflowY: "auto", padding: "0.4rem 0" }}
          >
            {events.map((ev, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "1px 1rem", fontSize: "0.72rem", opacity: i > 0 ? 0.85 : 1 }}>
                <span style={{ color: C.dim, flexShrink: 0, width: 68 }}>
                  {new Date(ev.ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <span style={{ color: C.cyan, width: 80, flexShrink: 0, fontWeight: 700 }}>
                  {ev.actor.slice(0, 10).padEnd(10)}
                </span>
                <span style={{ color: actionColor(ev.action, ev.success), flex: 1 }}>
                  {ev.action}
                  {ev.error && <span style={{ color: C.red, marginLeft: 6 }}>→ {ev.error.slice(0, 40)}</span>}
                </span>
                <span style={{ color: C.dim, flexShrink: 0 }}>{ev.dauer}ms</span>
              </div>
            ))}
            {events.length === 0 && (
              <div style={{ textAlign: "center", padding: "2rem", color: C.dim }}>
                Warte auf Aktionen…
              </div>
            )}
          </div>
        </div>

        {/* Worker Activity */}
        <div style={panel}>
          <div style={panelHead}>Worker Activity (30s)</div>
          <div style={{ padding: "0.8rem", display: "flex", flexDirection: "column", gap: 6, height: 240, overflowY: "auto" }}>
            {workerActors.length === 0 && (
              <div style={{ color: C.dim, fontSize: "0.75rem", textAlign: "center", marginTop: "2rem" }}>
                Starte…
              </div>
            )}
            {workerActors.map((actor) => {
              const hist = workerHist[actor] ?? [];
              const isAdmin = ["FRANK","CHRISTIAN","RONNY","ADMIN"].some((a) => actor.includes(a));
              const color  = isAdmin ? C.magenta : C.cyan;
              const last   = hist.at(-1) ?? 0;
              return (
                <div key={actor} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: "0.65rem", color, width: 50, flexShrink: 0, fontWeight: 700 }}>
                    {actor.slice(0, 6).padEnd(6)}
                  </span>
                  <Sparkline data={hist} color={color} width={160} height={18} />
                  <span style={{ fontSize: "0.6rem", color: C.dim, flexShrink: 0 }}>
                    {last > 0 ? `${last}×` : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Lock Stats + Stop ── */}
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
        <div style={{ ...panel, flex: 1, padding: "0.8rem 1.2rem", display: "flex", gap: "2rem", alignItems: "center" }}>
          <div style={{ fontSize: "0.7rem" }}>
            <span style={{ color: C.dim }}>Lock-Konflikte: </span>
            <strong style={{ color: C.yellow }}>{m ? metrics?.totalErrors : 0}</strong>
          </div>
          <div style={{ fontSize: "0.7rem" }}>
            <span style={{ color: C.dim }}>Run-ID: </span>
            <strong style={{ color: C.dim }}>{runId}</strong>
          </div>
        </div>
        <button
          onClick={onStop}
          style={{
            background:   `${C.red}22`,
            border:       `1px solid ${C.red}`,
            color:        C.red,
            padding:      "0.75rem 2rem",
            borderRadius: 10,
            fontSize:     "0.85rem",
            fontWeight:   900,
            fontFamily:   "monospace",
            cursor:       "pointer",
            letterSpacing: "0.05em",
            textShadow:   GLOW_MAGENTA,
            boxShadow:    `0 0 12px ${C.red}33`,
            transition:   "all 0.2s",
          }}
        >
          ⏹ STOP TEST
        </button>
      </div>

      {/* ── Fehler-Sektion ── */}
      <FehlerSektion errors={errors} />
    </div>
  );
}

// ── Cleanup Panel ─────────────────────────────────────────────────────────────

function CleanupPanel({ currentRunId }: { currentRunId?: string }) {
  const [confirm, setConfirm] = useState(false);
  const [input,   setInput]   = useState("");

  const { data: counts, refetch } = api.stresstest.getTestDataCount.useQuery(undefined, { staleTime: 10_000 });
  const cleanupMut = api.stresstest.cleanup.useMutation({
    onSuccess: (r) => {
      setConfirm(false); setInput("");
      refetch();
      alert(`✅ Gelöscht: ${r.anfragen} Anfragen, ${r.buchungen} Buchungen, ${r.anfragen} Chat-Nachrichten`);
    },
  });

  const s: React.CSSProperties = { fontFamily: "monospace" };

  if (!counts || counts.gesamt === 0) return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "0.8rem 1.2rem" }}>
      <span style={{ fontSize: "0.72rem", color: C.dim, ...s }}>🧹 Keine Test-Daten in DB</span>
    </div>
  );

  return (
    <>
      <div style={{ background: C.card, border: `1px solid ${C.yellow}44`, borderRadius: 10, padding: "1rem 1.2rem" }}>
        <div style={{ fontSize: "0.65rem", color: C.yellow, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, ...s }}>
          🧹 Test-Daten in DB
        </div>
        <div style={{ display: "flex", gap: "1.5rem", marginBottom: 10 }}>
          {[["Anfragen", counts.anfragen], ["Buchungen", counts.buchungen], ["Nachrichten", counts.nachrichten]].map(([l, v]) => (
            <div key={String(l)}>
              <div style={{ fontSize: "1.2rem", fontWeight: 900, color: C.yellow, ...s }}>{fmtNum(Number(v))}</div>
              <div style={{ fontSize: "0.6rem", color: C.dim, ...s }}>{l}</div>
            </div>
          ))}
        </div>
        <button
          onClick={() => setConfirm(true)}
          style={{ background: `${C.red}22`, border: `1px solid ${C.red}44`, color: C.red, padding: "0.45rem 1rem", borderRadius: 8, fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", ...s }}
        >
          🗑️ Alle Test-Daten löschen
        </button>
      </div>

      {confirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 20000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: C.card, border: `2px solid ${C.red}`, borderRadius: 16, padding: "2rem", width: 380, ...s }}>
            <div style={{ fontSize: "1.5rem", marginBottom: 8 }}>⚠️</div>
            <div style={{ fontSize: "1rem", fontWeight: 900, color: C.red, marginBottom: 12 }}>Wirklich löschen?</div>
            <div style={{ fontSize: "0.78rem", color: C.dim, marginBottom: 16, lineHeight: 1.6 }}>
              Folgende Daten werden <strong style={{ color: C.text }}>permanent</strong> entfernt:<br />
              • {fmtNum(counts.anfragen)} Test-Anfragen<br />
              • {fmtNum(counts.buchungen)} Test-Buchungen<br />
              • {fmtNum(counts.nachrichten)} Chat-Nachrichten
            </div>
            <div style={{ fontSize: "0.72rem", color: C.dim, marginBottom: 6 }}>
              Zum Bestätigen <strong style={{ color: C.text }}>LÖSCHEN</strong> eingeben:
            </div>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="LÖSCHEN"
              style={{ width: "100%", background: "#0a0a0f", border: `1px solid ${C.border}`, color: C.text, padding: "0.5rem 0.75rem", borderRadius: 8, fontSize: "0.85rem", boxSizing: "border-box", outline: "none", ...s }}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 14 }}>
              <button onClick={() => { setConfirm(false); setInput(""); }}
                style={{ background: "#ffffff08", border: `1px solid ${C.border}`, color: C.text, padding: "0.6rem", borderRadius: 8, cursor: "pointer", fontSize: "0.8rem", fontWeight: 700, ...s }}>
                Abbrechen
              </button>
              <button
                disabled={input !== "LÖSCHEN" || cleanupMut.isPending}
                onClick={() => cleanupMut.mutate({ runId: currentRunId })}
                style={{ background: input === "LÖSCHEN" ? `${C.red}44` : "#ffffff08", border: `1px solid ${input === "LÖSCHEN" ? C.red : C.border}`, color: input === "LÖSCHEN" ? C.red : C.dim, padding: "0.6rem", borderRadius: 8, cursor: input === "LÖSCHEN" ? "pointer" : "not-allowed", fontSize: "0.8rem", fontWeight: 900, ...s }}
              >
                {cleanupMut.isPending ? "…" : "Ja, löschen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── History Section ────────────────────────────────────────────────────────────

function HistorySection() {
  const { data: history } = api.stresstest.getHistory.useQuery();
  if (!history?.length) return null;

  const rating = (score: number) =>
    score > 5000 ? C.green : score > 1000 ? C.cyan : score > 200 ? C.yellow : C.red;

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", fontFamily: "monospace" }}>
      <div style={{ padding: "0.6rem 1rem", background: "#1c1c24", borderBottom: `1px solid ${C.border}`, fontSize: "0.62rem", color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em" }}>
        📜 Test-Historie ({history.length})
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.7rem" }}>
          <thead>
            <tr style={{ background: "#14141a" }}>
              {["Datum", "Modus", "Score", "Ops", "Fehler", "Ø ms", "P95"].map((h) => (
                <th key={h} style={{ padding: "5px 10px", textAlign: "left", color: C.dim, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {history.map((r) => (
              <tr key={r.id} style={{ borderBottom: `1px solid ${C.border}22` }}>
                <td style={{ padding: "5px 10px", color: C.dim }}>
                  {new Date(r.startedAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}{" "}
                  {new Date(r.startedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                </td>
                <td style={{ padding: "5px 10px", color: C.text }}>
                  {LOAD_MODES[r.modus as LoadMode]?.icon ?? "⚪"} {r.modus}
                </td>
                <td style={{ padding: "5px 10px", color: rating(r.score), fontWeight: 900 }}>{fmtNum(r.score)}</td>
                <td style={{ padding: "5px 10px", color: C.cyan }}>{fmtNum(r.totalOps)}</td>
                <td style={{ padding: "5px 10px", color: r.fehler > 0 ? C.red : C.green }}>{r.fehler}</td>
                <td style={{ padding: "5px 10px", color: C.text }}>{r.avgResponseMs}</td>
                <td style={{ padding: "5px 10px", color: r.p95Ms > 500 ? C.yellow : C.text }}>{r.p95Ms}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Recommendations Engine ────────────────────────────────────────────────────

interface Empfehlung { level: "rot" | "gelb" | "gruen"; text: string }

function genEmpfehlungen(r: FinalResult): Empfehlung[] {
  const empf: Empfehlung[] = [];
  const errorRate = r.totalOps > 0 ? r.fehler / r.totalOps : 0;
  const bugCount  = r.fehlerPerKategorie?.bug ?? 0;
  const raceCount = r.fehlerPerKategorie?.race ?? 0;

  if (bugCount > 0)        empf.push({ level: "rot",   text: `${bugCount} Echter Bug(s) — Fehler-Sektion + Stack-Traces prüfen` });
  if (r.p95 > 500)         empf.push({ level: "gelb",  text: `P95 ${r.p95}ms hoch — DB-Indexes auf oft abgefragten Spalten prüfen` });
  if (r.avgResponseTime > 300) empf.push({ level: "gelb", text: `Ø Response ${r.avgResponseTime}ms — Langsame Queries identifizieren` });
  if ((r.memMBPeak ?? 0) > 400) empf.push({ level: "gelb", text: `Memory-Peak ${r.memMBPeak}MB — Heap-Wachstum bei Extreme-Mode beobachten` });
  if (raceCount > 0 && bugCount === 0) empf.push({ level: "gruen", text: `Lock-System: ${raceCount} Race Conditions korrekt abgefangen` });
  if (errorRate < 0.01 && r.totalOps > 50) empf.push({ level: "gruen", text: `${((1 - errorRate) * 100).toFixed(1)}% Erfolgsrate — System ist stabil` });
  if (r.lockKonflikte > 0) empf.push({ level: "gruen", text: `${r.lockKonflikte} Lock-Konflikte behandelt — Optimistic Locking funktioniert` });
  if (empf.length === 0)   empf.push({ level: "gruen", text: "Keine Probleme gefunden — System produktionsreif" });

  return empf;
}

// ── Detailed Report Screen ────────────────────────────────────────────────────

function DetailedReportScreen({ result, onNew }: { result: FinalResult; onNew: () => void }) {
  const [shown, setShown] = useState(false);
  useEffect(() => { setTimeout(() => setShown(true), 80); }, []);

  const score  = result.score;
  const rating = score > 5000 ? { label: "EXCELLENT",  color: C.green  }
               : score > 1000 ? { label: "GOOD",       color: C.cyan   }
               : score > 200  ? { label: "OK",         color: C.yellow }
               :                 { label: "NEEDS WORK", color: C.red    };

  const empfehlungen = genEmpfehlungen(result);
  const successRate  = result.totalOps > 0 ? ((1 - result.fehler / result.totalOps) * 100).toFixed(1) : "100.0";

  // Ranking aus aktionenPerAkteur
  const ranking = Object.entries(result.aktionenPerAkteur ?? {})
    .sort(([, a], [, b]) => b - a);
  const admins   = ["FRANK","CHRISTIAN","RONNY","ADMIN"];
  const tkRank   = ranking.filter(([a]) => !admins.some((x) => a.toUpperCase().includes(x)));
  const admRank  = ranking.filter(([a]) => admins.some((x) => a.toUpperCase().includes(x)));

  const medals = ["🥇","🥈","🥉"];

  function downloadJson() {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a"); a.href = url;
    a.download = `stresstest-${result.runId}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  function copyToClipboard() {
    const lines = [
      `LAGERNAUT BENCHMARK REPORT — ${new Date(result.startTime ?? Date.now()).toLocaleString("de-DE")}`,
      `Modus: ${LOAD_MODES[result.modus]?.label ?? result.modus} | Score: ${fmtNum(score)} (${rating.label})`,
      `Ops: ${fmtNum(result.totalOps)} | Ø ${result.avgResponseTime}ms | P95: ${result.p95}ms | Fehler: ${result.fehler}`,
    ].join("\n");
    navigator.clipboard.writeText(lines).catch(() => {});
  }

  const panel: React.CSSProperties = {
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", fontFamily: "monospace",
  };
  const head: React.CSSProperties = {
    padding: "0.6rem 1rem", background: "#1c1c24", borderBottom: `1px solid ${C.border}`,
    fontSize: "0.65rem", color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em",
  };
  const kv = (label: string, value: string, color: string = C.text) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "0.3rem 0", borderBottom: `1px solid ${C.border}22` }}>
      <span style={{ color: C.dim, fontSize: "0.78rem" }}>{label}</span>
      <span style={{ color, fontWeight: 700, fontSize: "0.78rem" }}>{value}</span>
    </div>
  );

  return (
    <div style={{
      minHeight: "100vh", background: C.bg, fontFamily: "monospace", color: C.text,
      padding: "1.5rem", overflowY: "auto",
      opacity: shown ? 1 : 0, transition: "opacity 0.4s",
    }}>
      <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: "1rem" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: "0.65rem", color: C.dim, letterSpacing: "0.12em" }}>📊 LAGERNAUT BENCHMARK REPORT</div>
            <div style={{ fontSize: "0.8rem", color: C.cyan, fontWeight: 700 }}>
              {result.modus ? `${LOAD_MODES[result.modus]?.icon} ${LOAD_MODES[result.modus]?.label}` : ""}
              {" · "}{fmtTime(result.duration)}
              {result.startTime ? ` · ${new Date(result.startTime).toLocaleString("de-DE")}` : ""}
            </div>
          </div>
          <button onClick={onNew} style={{
            background: `${C.cyan}22`, border: `1px solid ${C.cyan}`, color: C.cyan,
            padding: "0.5rem 1.2rem", borderRadius: 8, cursor: "pointer", fontSize: "0.8rem", fontWeight: 900,
          }}>↻ Neuer Test</button>
        </div>

        {/* ── Score ── */}
        <div style={{ ...panel, textAlign: "center", padding: "2rem", boxShadow: `0 0 40px ${rating.color}18` }}>
          <div style={{ fontSize: "0.65rem", color: C.dim, letterSpacing: "0.15em" }}>OVERALL SCORE</div>
          <div style={{ fontSize: "5rem", fontWeight: 900, color: rating.color, textShadow: `0 0 40px ${rating.color}`, lineHeight: 1.1 }}>
            {fmtNum(score)}
          </div>
          <div style={{ display: "inline-block", padding: "4px 16px", borderRadius: 99, background: `${rating.color}22`, border: `1px solid ${rating.color}`, color: rating.color, fontSize: "0.8rem", fontWeight: 900 }}>
            {rating.label}
          </div>
          <div style={{ color: C.dim, fontSize: "0.7rem", marginTop: 8 }}>
            {result.numTechniker} Techniker · {result.numAdmins} Admins · Erfolgsrate: <span style={{ color: C.green }}>{successRate}%</span>
          </div>
        </div>

        {/* ── Kennzahlen + Aktionen ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <div style={panel}>
            <div style={head}>📈 Performance</div>
            <div style={{ padding: "0.8rem 1rem" }}>
              {kv("Total Ops",       fmtNum(result.totalOps),       C.cyan)}
              {kv("Ø Response",      `${result.avgResponseTime} ms`, result.avgResponseTime > 300 ? C.yellow : C.green)}
              {kv("P95 Response",    `${result.p95} ms`,            result.p95 > 500 ? C.yellow : C.text)}
              {kv("Peak Response",   `${result.peakResponseTime} ms`, C.text)}
              {kv("Fehlerrate",      `${(result.fehler / Math.max(result.totalOps, 1) * 100).toFixed(2)}%`, result.fehler > 0 ? C.red : C.green)}
            </div>
          </div>

          <div style={panel}>
            <div style={head}>🎯 Aktionen</div>
            <div style={{ padding: "0.8rem 1rem" }}>
              {kv("Anfragen erstellt",  fmtNum(result.anfrageErstellt),  C.text)}
              {kv("Anfragen erledigt",  fmtNum(result.anfrageErledigt),  C.green)}
              {kv("Anfragen storniert", fmtNum(result.anfrageStorniert), C.dim)}
              {kv("Chat-Nachrichten",   fmtNum(result.chat),            C.yellow)}
              {kv("Buchungen",          fmtNum(result.buchungen),       C.text)}
              {kv("Lock-Konflikte",     fmtNum(result.lockKonflikte),   C.green)}
            </div>
          </div>
        </div>

        {/* ── Fehler-Breakdown ── */}
        {result.fehlerPerKategorie && Object.keys(result.fehlerPerKategorie).length > 0 && (() => {
          const KAT_ICONS: Record<string, string> = { race: "🟢", validation: "🟡", duplicate: "🟡", stale: "🟠", api: "🟣", bug: "🔴" };
          return (
            <div style={panel}>
              <div style={head}>❌ Fehler-Breakdown ({result.fehler})</div>
              <div style={{ padding: "0.8rem 1rem", display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
                {Object.entries(result.fehlerPerKategorie).map(([kat, cnt]) => (
                  <div key={kat} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "1.5rem", fontWeight: 900, color: C.text }}>{cnt}</div>
                    <div style={{ fontSize: "0.65rem", color: C.dim }}>{KAT_ICONS[kat]} {kat}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* ── Ranking ── */}
        {ranking.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            {tkRank.length > 0 && (
              <div style={panel}>
                <div style={head}>👥 Techniker-Ranking</div>
                <div style={{ padding: "0.6rem 0.8rem" }}>
                  {tkRank.slice(0, 8).map(([actor, cnt], i) => (
                    <div key={actor} style={{ display: "flex", justifyContent: "space-between", padding: "4px 4px", fontSize: "0.75rem" }}>
                      <span>{medals[i] ?? "  "} <span style={{ color: C.cyan }}>{actor}</span></span>
                      <span style={{ color: C.text, fontWeight: 700 }}>{fmtNum(cnt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {admRank.length > 0 && (
              <div style={panel}>
                <div style={head}>🔑 Admin-Ranking</div>
                <div style={{ padding: "0.6rem 0.8rem" }}>
                  {admRank.map(([actor, cnt], i) => (
                    <div key={actor} style={{ display: "flex", justifyContent: "space-between", padding: "4px 4px", fontSize: "0.75rem" }}>
                      <span>{medals[i] ?? "  "} <span style={{ color: C.magenta }}>{actor}</span></span>
                      <span style={{ color: C.text, fontWeight: 700 }}>{fmtNum(cnt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── System-Ressourcen ── */}
        {((result.memMBStart ?? 0) > 0 || (result.memMBPeak ?? 0) > 0) && (
          <div style={panel}>
            <div style={head}>🔧 System-Ressourcen</div>
            <div style={{ padding: "0.8rem 1rem" }}>
              {kv("Memory Start",  `${result.memMBStart ?? "—"} MB`, C.text)}
              {kv("Memory Peak",   `${result.memMBPeak ?? "—"} MB`, (result.memMBPeak ?? 0) > 400 ? C.yellow : C.text)}
            </div>
          </div>
        )}

        {/* ── Empfehlungen ── */}
        <div style={panel}>
          <div style={head}>⚠️ Empfehlungen</div>
          <div style={{ padding: "0.8rem 1rem", display: "flex", flexDirection: "column", gap: 6 }}>
            {empfehlungen.map((e, i) => {
              const col = e.level === "rot" ? C.red : e.level === "gelb" ? C.yellow : C.green;
              const icon = e.level === "rot" ? "🔴" : e.level === "gelb" ? "🟡" : "🟢";
              return (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span style={{ flexShrink: 0 }}>{icon}</span>
                  <span style={{ fontSize: "0.78rem", color: col }}>{e.text}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Cleanup + Export ── */}
        <CleanupPanel currentRunId={result.runId} />

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={downloadJson} style={{ flex: 1, background: "#ffffff08", border: `1px solid ${C.border}`, color: C.text, padding: "0.65rem", borderRadius: 8, cursor: "pointer", fontSize: "0.78rem", fontWeight: 700, fontFamily: "monospace" }}>
            📊 Als JSON
          </button>
          <button onClick={copyToClipboard} style={{ flex: 1, background: "#ffffff08", border: `1px solid ${C.border}`, color: C.text, padding: "0.65rem", borderRadius: 8, cursor: "pointer", fontSize: "0.78rem", fontWeight: 700, fontFamily: "monospace" }}>
            📋 Kopieren
          </button>
        </div>

      </div>
    </div>
  );
}

// ── Haupt-Page ────────────────────────────────────────────────────────────────

type Phase = "config" | "running" | "done";

export default function StressTestPage() {
  const [phase,       setPhase]       = useState<Phase>("config");
  const [runId,       setRunId]       = useState<string>("");
  const [config,      setConfig]      = useState<{ duration: number; numTechniker: number; numAdmins: number; loadMode: LoadMode }>({ duration: 300_000, numTechniker: 5, numAdmins: 2, loadMode: "burst" });
  const [finalResult, setFinalResult] = useState<FinalResult | null>(null);

  const startMutation   = api.stresstest.start.useMutation();
  const stopMutation    = api.stresstest.stop.useMutation();

  // Re-sync bei Page-Reload (falls Test noch läuft)
  const { data: statusData } = api.stresstest.getStatus.useQuery(undefined, {
    refetchInterval: phase === "running" ? 3_000 : false,
  });

  useEffect(() => {
    if (statusData?.running && phase === "config") {
      setPhase("running");
      setRunId(statusData.state?.runId ?? "");
    }
  }, [statusData, phase]);

  async function handleStart(cfg: typeof config) {
    setConfig(cfg);
    const r = await startMutation.mutateAsync({
      duration:     cfg.duration,
      numTechniker: cfg.numTechniker,
      numAdmins:    cfg.numAdmins,
      loadMode:     cfg.loadMode,
    });
    setRunId(r.runId);
    setPhase("running");
  }

  async function handleStop() {
    await stopMutation.mutateAsync();
    // Done event arrives via socket; fallback: after 3s go to config
    setTimeout(() => setPhase((p) => p === "running" ? "config" : p), 3_000);
  }

  function handleDone(result: FinalResult) {
    setFinalResult(result);
    setPhase("done");
  }

  if (phase === "config") {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "monospace", color: C.text, overflowY: "auto", display: "flex", flexDirection: "column", alignItems: "center", paddingBottom: "2rem" }}>
        <ConfigScreen onStart={handleStart} />
        <div style={{ width: "100%", maxWidth: 480, padding: "0 1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <CleanupPanel />
          <HistorySection />
        </div>
      </div>
    );
  }

  if (phase === "running") {
    return (
      <>
        <style>{`body { overflow: hidden; }`}</style>
        <RunningDashboard
          runId={runId}
          config={config}
          onStop={handleStop}
          onDone={handleDone}
        />
      </>
    );
  }

  return (
    <DetailedReportScreen
      result={finalResult!}
      onNew={() => { setPhase("config"); setFinalResult(null); }}
    />
  );
}

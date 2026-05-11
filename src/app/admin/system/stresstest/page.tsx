"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement,
  LineElement, Filler, Tooltip,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { api }       from "@/trpc/react";
import { useSocket } from "@/hooks/useSocket";
import { EVENTS }    from "@/modules/realtime/events";
import type { TestEvent, MetricUpdate, FinalResult } from "@/modules/stresstest/runner";

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

function ConfigScreen({ onStart }: { onStart: (cfg: { duration: number; numTechniker: number; numAdmins: number }) => void }) {
  const [duration,     setDuration]     = useState(300_000);
  const [numTechniker, setNumTechniker] = useState(5);
  const [numAdmins,    setNumAdmins]    = useState(2);

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
    fontFamily: "monospace", outline: "none", cursor: "pointer",
    width: "100%",
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace", color: C.text }}>
      <div style={{ background: C.card, border: `1px solid ${C.cyan}44`, borderRadius: 20, padding: "3rem", width: 440, boxShadow: `0 0 60px ${C.cyan}18` }}>
        <div style={{ textAlign: "center", marginBottom: "2.5rem" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: 8 }}>🔬</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 900, color: C.cyan, textShadow: GLOW_CYAN, letterSpacing: "0.05em" }}>
            LAGERNAUT BENCHMARK
          </div>
          <div style={{ fontSize: "0.75rem", color: C.dim, marginTop: 6 }}>
            Stress-Test · Live Dashboard
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.7rem", color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
              Test-Dauer
            </label>
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} style={sel}>
              {durationOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.7rem", color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
                Techniker ({numTechniker})
              </label>
              <input type="range" min={1} max={10} value={numTechniker} onChange={(e) => setNumTechniker(Number(e.target.value))}
                style={{ width: "100%", accentColor: C.cyan }} />
              <div style={{ fontSize: "0.65rem", color: C.dim, marginTop: 2 }}>1 – 10 Techniker</div>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.7rem", color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
                Admins ({numAdmins})
              </label>
              <input type="range" min={1} max={3} value={numAdmins} onChange={(e) => setNumAdmins(Number(e.target.value))}
                style={{ width: "100%", accentColor: C.cyan }} />
              <div style={{ fontSize: "0.65rem", color: C.dim, marginTop: 2 }}>1 – 3 Admins</div>
            </div>
          </div>

          <div style={{ background: "#ffd70018", border: "1px solid #ffd70044", borderRadius: 8, padding: "0.8rem 1rem", fontSize: "0.78rem", color: C.yellow }}>
            ⚠️ Test erzeugt echte Daten in der DB.
            Markierung: <strong>STRESSTEST_*</strong>
            <br />Cleanup nach Test-Ende möglich.
          </div>

          <button
            onClick={() => onStart({ duration, numTechniker, numAdmins })}
            style={{
              background:  `linear-gradient(135deg, ${C.cyan}33, ${C.cyan}66)`,
              border:      `1px solid ${C.cyan}`,
              color:       C.cyan,
              padding:     "0.9rem",
              borderRadius: 12,
              fontSize:    "1rem",
              fontWeight:  900,
              fontFamily:  "monospace",
              cursor:      "pointer",
              letterSpacing: "0.1em",
              textShadow:  GLOW_CYAN,
              boxShadow:   `0 0 20px ${C.cyan}33`,
              transition:  "all 0.2s",
            }}
          >
            ▶ TEST STARTEN
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Running Dashboard ─────────────────────────────────────────────────────────

function RunningDashboard({
  runId, config, onStop, onDone,
}: {
  runId: string;
  config: { duration: number; numTechniker: number; numAdmins: number };
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
    </div>
  );
}

// ── Score Screen ──────────────────────────────────────────────────────────────

function ScoreScreen({ result, runId, onNew, onCleanup }: {
  result: FinalResult;
  runId: string;
  onNew: () => void;
  onCleanup: () => void;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => { setTimeout(() => setShown(true), 100); }, []);

  const score = result.score;
  const rating = score > 5000 ? { label: "EXCELLENT", color: C.green }
               : score > 1000 ? { label: "GOOD",      color: C.cyan  }
               : score > 200  ? { label: "OK",         color: C.yellow }
               : { label: "NEEDS WORK", color: C.red };

  function downloadReport() {
    const txt = [
      "LAGERNAUT STRESS-TEST REPORT",
      "=".repeat(40),
      `Run ID:           ${result.runId}`,
      `Laufzeit:         ${fmtTime(result.duration)}`,
      "",
      "AKTIONEN",
      `Gesamt:           ${fmtNum(result.totalOps)}`,
      `Anfragen erstellt: ${fmtNum(result.anfrageErstellt)}`,
      `Anfragen erledigt: ${fmtNum(result.anfrageErledigt)}`,
      `Anfragen storniert: ${fmtNum(result.anfrageStorniert)}`,
      `Buchungen:        ${fmtNum(result.buchungen)}`,
      `Chat-Nachrichten: ${fmtNum(result.chat)}`,
      `Lock-Konflikte:   ${fmtNum(result.lockKonflikte)}`,
      "",
      "PERFORMANCE",
      `Ø Response:       ${result.avgResponseTime} ms`,
      `Peak Response:    ${result.peakResponseTime} ms`,
      `P95:              ${result.p95} ms`,
      `Fehler:           ${result.fehler}`,
      "",
      `SCORE: ${score} — ${rating.label}`,
    ].join("\n");

    const blob = new Blob([txt], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `stresstest-${result.runId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const row = (label: string, val: string, color: string = C.dim) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "0.35rem 0", borderBottom: `1px solid ${C.border}` }}>
      <span style={{ color: C.dim, fontSize: "0.85rem" }}>{label}</span>
      <span style={{ color, fontWeight: 700, fontFamily: "monospace" }}>{val}</span>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace", color: C.text }}>
      <div style={{
        background: C.card, border: `2px solid ${rating.color}44`, borderRadius: 20, padding: "3rem",
        width: 480, boxShadow: `0 0 80px ${rating.color}22`,
        transform: shown ? "scale(1) translateY(0)" : "scale(0.9) translateY(30px)",
        opacity: shown ? 1 : 0, transition: "all 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
      }}>
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <div style={{ fontSize: "0.7rem", color: C.dim, letterSpacing: "0.15em", marginBottom: 8 }}>LAGERNAUT SCORE</div>
          <div style={{
            fontSize: "5rem", fontWeight: 900, color: rating.color,
            textShadow: `0 0 40px ${rating.color}`, letterSpacing: "-0.02em",
            transition: "all 0.3s",
          }}>
            {fmtNum(score)}
          </div>
          <div style={{
            display: "inline-block", padding: "4px 16px", borderRadius: 99,
            background: `${rating.color}22`, border: `1px solid ${rating.color}`,
            color: rating.color, fontSize: "0.75rem", fontWeight: 900, letterSpacing: "0.1em",
          }}>
            {rating.label}
          </div>
        </div>

        <div style={{ margin: "1.5rem 0" }}>
          {row("Total Ops",       fmtNum(result.totalOps),       C.cyan)}
          {row("Anfragen erstellt", fmtNum(result.anfrageErstellt), C.text)}
          {row("Anfragen erledigt", fmtNum(result.anfrageErledigt), C.green)}
          {row("Lock-Konflikte",  fmtNum(result.lockKonflikte),  C.yellow)}
          {row("Ø Response",      `${result.avgResponseTime} ms`, C.text)}
          {row("P95 Response",    `${result.p95} ms`,            C.text)}
          {row("Fehler",          `${result.fehler}`,            result.fehler > 0 ? C.red : C.green)}
          {row("Uptime",          result.fehler === 0 ? "100%" : `${((1 - result.fehler / Math.max(result.totalOps, 1)) * 100).toFixed(1)}%`, C.green)}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginTop: "1.5rem" }}>
          <button onClick={downloadReport} style={{
            background: "#ffffff0f", border: `1px solid ${C.border}`, color: C.text,
            padding: "0.7rem", borderRadius: 10, cursor: "pointer", fontSize: "0.8rem",
            fontFamily: "monospace", fontWeight: 700, transition: "all 0.2s",
          }}>
            ⬇ Report
          </button>
          <button onClick={onCleanup} style={{
            background: `${C.yellow}15`, border: `1px solid ${C.yellow}44`, color: C.yellow,
            padding: "0.7rem", borderRadius: 10, cursor: "pointer", fontSize: "0.8rem",
            fontFamily: "monospace", fontWeight: 700, transition: "all 0.2s",
          }}>
            🗑 Cleanup
          </button>
        </div>

        <button onClick={onNew} style={{
          marginTop: "0.75rem", width: "100%",
          background:  `linear-gradient(135deg, ${C.cyan}33, ${C.cyan}66)`,
          border:      `1px solid ${C.cyan}`, color: C.cyan,
          padding:     "0.85rem", borderRadius: 10, cursor: "pointer",
          fontSize:    "0.9rem", fontFamily: "monospace", fontWeight: 900,
          letterSpacing: "0.1em", textShadow: GLOW_CYAN, boxShadow: `0 0 16px ${C.cyan}22`,
          transition:  "all 0.2s",
        }}>
          ↻ NEUER TEST
        </button>
      </div>
    </div>
  );
}

// ── Haupt-Page ────────────────────────────────────────────────────────────────

type Phase = "config" | "running" | "done";

export default function StressTestPage() {
  const [phase,      setPhase]      = useState<Phase>("config");
  const [runId,      setRunId]      = useState<string>("");
  const [config,     setConfig]     = useState({ duration: 300_000, numTechniker: 5, numAdmins: 2 });
  const [finalResult, setFinalResult] = useState<FinalResult | null>(null);

  const startMutation   = api.stresstest.start.useMutation();
  const stopMutation    = api.stresstest.stop.useMutation();
  const cleanupMutation = api.stresstest.cleanup.useMutation();

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
    const r = await startMutation.mutateAsync(cfg);
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

  async function handleCleanup() {
    await cleanupMutation.mutateAsync({ runId });
    alert(`Cleanup abgeschlossen für Run ${runId}`);
  }

  if (phase === "config") {
    return (
      <>
        <style>{`body { overflow: hidden; }`}</style>
        <ConfigScreen onStart={handleStart} />
      </>
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
    <>
      <style>{`body { overflow: hidden; }`}</style>
      <ScoreScreen
        result={finalResult!}
        runId={runId}
        onNew={() => { setPhase("config"); setFinalResult(null); }}
        onCleanup={handleCleanup}
      />
    </>
  );
}

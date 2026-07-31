"use client";
import { useMemo, useState } from "react";
import { api } from "@/trpc/react";

// ═══════════════════════════════════════════════════════════════════════════════
// Dashboard-Ansicht der Statistiken (alternative Optik zur klassischen Seite)
//
// FARBEN: Die Serienfarben sind KEINE freie Wahl — sie wurden mit dem
// Paletten-Validator gegen beide Kartenflächen geprüft (hell #ffffff, dunkel
// #242526) und bestehen Helligkeitsband, Chroma-Boden, Farbfehlsichtigkeits-
// Trennung (ΔE ≥ 8) und Normalsicht-Boden (ΔE ≥ 15).
//   • Reihenfolge ist Teil der Prüfung: Violett trennt Grün und Gelb, weil
//     Gelb↔Grün bei Rot-Grün-Schwäche sonst nur ΔE 7.8 auseinanderliegen.
//   • Drei helle Töne liegen unter 3:1 Kontrast auf Weiß → deshalb trägt JEDER
//     Wert zusätzlich eine sichtbare Beschriftung bzw. steht in der Tabelle.
//     Farbe allein transportiert hier nie eine Information.
// Wer Farben ändert, muss den Validator erneut laufen lassen.
// ═══════════════════════════════════════════════════════════════════════════════

const VIZ_CSS = `
.lgn-viz{
  --s1:#008BD2; --s2:#eb6834; --s3:#04B475; --s4:#4a3aa7; --s5:#eda100; --s6:#e87ba4;
  --surface:#ffffff; --ink:#1a1a1a; --ink2:#52514e; --muted:#898781;
  --grid:#e1e0d9; --axis:#c3c2b7; --hair:rgba(11,11,11,0.10);
}
html.dark .lgn-viz{
  --s1:#1A8FD0; --s2:#d95926; --s3:#039E66; --s4:#9085e9; --s5:#c98500; --s6:#d55181;
  --surface:#242526; --ink:#e4e6eb; --ink2:#c3c2b7; --muted:#898781;
  --grid:#2c2c2a; --axis:#383835; --hair:rgba(255,255,255,0.10);
}
`;

// Serien des Verlaufs — Farbe folgt der Kennzahl, nie ihrem Rang.
const SERIEN = [
  { key: "anfragen",        label: "Anfragen",        farbe: "var(--s1)" },
  { key: "erledigt",        label: "Erledigt",        farbe: "var(--s3)" },
  { key: "bedarf",          label: "Bedarf",          farbe: "var(--s5)" },
  { key: "nichtVerfuegbar", label: "Nicht verfügbar", farbe: "var(--s2)" },
] as const;

type SerienKey = (typeof SERIEN)[number]["key"];

type VerlaufPunkt = {
  datum: string; anfragen: number; erledigt: number; bedarf: number; nichtVerfuegbar?: number;
};

// Status → Serien-Slot. Feste Zuordnung: die Farbe gehört dem Status,
// nicht seiner aktuellen Position in der Liste (kein Umfärben beim Filtern).
const STATUS_SLOT: Record<string, string> = {
  NEU:              "var(--s1)",
  ABGESCHLOSSEN:    "var(--s3)",
  BEDARF:           "var(--s5)",
  IN_BEARBEITUNG:   "var(--s4)",
  NICHT_VERFUEGBAR: "var(--s2)",
  STORNIERT:        "var(--s6)",
};
const STATUS_TEXT: Record<string, string> = {
  NEU: "Neu", ABGESCHLOSSEN: "Erledigt", BEDARF: "Bedarf",
  IN_BEARBEITUNG: "In Bearbeitung", NICHT_VERFUEGBAR: "Nicht verfügbar", STORNIERT: "Storniert",
};

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

const nf = (n: number) => n.toLocaleString("de-DE");
/** Große Zahlen kompakt — Kacheln sollen nicht umbrechen. */
function kompakt(n: number): string {
  if (Math.abs(n) >= 10_000) return (n / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + "K";
  return nf(n);
}
/**
 * Achsen-Schritte auf runde Zahlen bringen (0 · 10 · 20 · 30 statt 0 · 8 · 15 · 23 · 30).
 * Sucht die nächstgrößere „schöne" Schrittweite (1/2/2,5/5/10 × Zehnerpotenz) für
 * etwa vier Abschnitte; der letzte Tick ist zugleich die Obergrenze der Skala.
 */
function achsenTicks(max: number): number[] {
  const roh = Math.max(max, 1) / 4;
  const p   = Math.pow(10, Math.floor(Math.log10(roh)));
  const schritt = [1, 2, 2.5, 5, 10].map((k) => k * p).find((k) => k >= roh) ?? 10 * p;
  const ticks: number[] = [];
  for (let v = 0; v <= Math.ceil(max / schritt) * schritt + 1e-9; v += schritt) {
    ticks.push(Math.round(v));
  }
  return ticks;
}
const kurzDatum = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
};

// ── Karten-Grundgerüst ────────────────────────────────────────────────────────

function Karte({ titel, sub, rechts, children }: {
  titel: string; sub?: string; rechts?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm">
      <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-[#f0f2f5] dark:border-[#3e4042]">
        <div className="min-w-0">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[#1a1a1a] dark:text-[#e4e6eb]">{titel}</h2>
          {sub && <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-0.5">{sub}</p>}
        </div>
        {rechts}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Laden({ h = "h-32" }: { h?: string }) {
  return <div className={`${h} bg-[#f0f2f5] dark:bg-[#3e4042] rounded-lg animate-pulse`} />;
}
function Leer() {
  return <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] text-center py-8">Keine Daten im Zeitraum</p>;
}

// ── Sparkline (12 Punkte, entspannte Linie) ───────────────────────────────────

function Sparkline({ werte, farbe }: { werte: number[]; farbe: string }) {
  if (werte.length < 2) return <div className="h-8" />;
  const W = 120, H = 32, max = Math.max(...werte, 1);
  const pts = werte.map((v, i) => {
    const x = (i / (werte.length - 1)) * W;
    const y = H - 3 - (v / max) * (H - 6);
    return [x, y] as const;
  });
  const linie = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const flaeche = `${linie} ${W},${H} 0,${H}`;
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-8 overflow-visible" aria-hidden="true" preserveAspectRatio="none">
      <polygon points={flaeche} fill={farbe} opacity={0.1} />
      <polyline points={linie} fill="none" stroke={farbe} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
        vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r={3.2} fill={farbe} stroke="var(--surface)" strokeWidth={2} />
    </svg>
  );
}

// ── Kennzahl-Kachel ───────────────────────────────────────────────────────────
// Aufbau: Beschriftung · Wert · optionaler Verlauf. Der Wert nutzt bewusst
// proportionale Ziffern (kein tabular-nums) — bei großen Zahlen wirkt es sonst
// auseinandergezogen. Tabellenspalten weiter unten nutzen tabular-nums.

function Kachel({ label, wert, farbe, verlauf, fussnote }: {
  label: string; wert: number; farbe: string; verlauf?: number[]; fussnote?: string;
}) {
  return (
    <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: farbe }} aria-hidden="true" />
        <span className="text-xs font-semibold text-[#65676b] dark:text-[#b0b3b8] truncate">{label}</span>
      </div>
      <div className="text-[28px] leading-none font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{kompakt(wert)}</div>
      {fussnote && <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">{fussnote}</div>}
      {verlauf && verlauf.length > 1 && <Sparkline werte={verlauf} farbe={farbe} />}
    </div>
  );
}

// ── Verlaufs-Diagramm mit Reitern, Fadenkreuz und Tabellen-Ansicht ────────────

function VerlaufChart({ data, aktiv }: { data: VerlaufPunkt[]; aktiv: SerienKey | "alle" }) {
  const [hover, setHover] = useState<number | null>(null);

  const serien = aktiv === "alle" ? SERIEN : SERIEN.filter((s) => s.key === aktiv);
  const wert = (d: VerlaufPunkt, k: SerienKey) => (k === "nichtVerfuegbar" ? d.nichtVerfuegbar ?? 0 : d[k]);

  const roh    = Math.max(...data.flatMap((d) => serien.map((s) => wert(d, s.key))), 1);
  const ticks  = achsenTicks(roh);
  const max    = ticks[ticks.length - 1]; // Skala endet auf dem letzten runden Tick

  // Zeichenfläche in Nutzerkoordinaten; die x-Achsenbeschriftung liegt INNERHALB
  // der Box — sonst schneidet ein fixes Container-Maß die Datumszeile ab.
  const W = 720, H = 240, PL = 44, PR = 12, PT = 10, PB = 26;
  const iw = W - PL - PR, ih = H - PT - PB;
  const n = data.length;
  const px = (i: number) => (n > 1 ? PL + (i / (n - 1)) * iw : PL + iw / 2);
  const py = (v: number) => PT + ih - (v / max) * ih;

  const beschriftet = new Set<number>();
  const schritt = Math.max(1, Math.ceil(n / 7));
  for (let i = 0; i < n; i += schritt) beschriftet.add(i);
  if (n > 0) beschriftet.add(n - 1);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 240 }}
        role="img" aria-label="Verlauf der Anfragen im Zeitraum">
        {/* Gitter: durchgezogene Haarlinien, zurückhaltend — nie gestrichelt */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PL} x2={W - PR} y1={py(t)} y2={py(t)} stroke="var(--grid)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <text x={PL - 8} y={py(t) + 3.5} textAnchor="end" fontSize={10} fill="var(--muted)"
              style={{ fontVariantNumeric: "tabular-nums" }}>{nf(t)}</text>
          </g>
        ))}
        <line x1={PL} x2={W - PR} y1={py(0)} y2={py(0)} stroke="var(--axis)" strokeWidth={1} vectorEffect="non-scaling-stroke" />

        {serien.map((s) => {
          const pts = data.map((d, i) => `${px(i).toFixed(1)},${py(wert(d, s.key)).toFixed(1)}`).join(" ");
          return (
            <g key={s.key}>
              <polygon points={`${pts} ${px(n - 1)},${py(0)} ${px(0)},${py(0)}`} fill={s.farbe} opacity={0.1} />
              <polyline points={pts} fill="none" stroke={s.farbe} strokeWidth={2}
                strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}

        {/* Fadenkreuz + Punkte mit 2px-Ring in Flächenfarbe (bleiben lesbar, wo Linien kreuzen) */}
        {hover !== null && (
          <g>
            <line x1={px(hover)} x2={px(hover)} y1={PT} y2={py(0)} stroke="var(--axis)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            {serien.map((s) => (
              <circle key={s.key} cx={px(hover)} cy={py(wert(data[hover], s.key))} r={4.5}
                fill={s.farbe} stroke="var(--surface)" strokeWidth={2} />
            ))}
          </g>
        )}

        {data.map((d, i) => beschriftet.has(i) && (
          <text key={i} x={px(i)} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--muted)"
            style={{ fontVariantNumeric: "tabular-nums" }}>{kurzDatum(d.datum)}</text>
        ))}

        {/* Trefferflächen: breiter als die Marke, damit Zeigen leichtfällt */}
        {data.map((_, i) => (
          <rect key={i} x={px(i) - iw / Math.max(n, 1) / 2} y={PT} width={Math.max(iw / Math.max(n, 1), 8)} height={ih}
            fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>

      {hover !== null && (
        <div className="absolute top-0 left-0 pointer-events-none w-full">
          {/* Position am Rand begrenzen — sonst ragt der Kasten beim ersten bzw.
              letzten Tag zur Hälfte aus der Karte heraus und wird abgeschnitten. */}
          <div className="inline-block rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] shadow-md px-3 py-2"
            style={{
              marginLeft: `${Math.min(Math.max((px(hover) / W) * 100, 10), 90)}%`,
              transform:  "translateX(-50%)",
            }}>
            <div className="text-xs font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">{kurzDatum(data[hover].datum)}</div>
            {serien.map((s) => (
              <div key={s.key} className="flex items-center gap-2 text-xs whitespace-nowrap">
                <span className="w-2 h-2 rounded-sm" style={{ background: s.farbe }} />
                <span className="text-[#65676b] dark:text-[#b0b3b8]">{s.label}</span>
                <span className="ml-auto font-bold text-[#1a1a1a] dark:text-[#e4e6eb]" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {nf(wert(data[hover], s.key))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function VerlaufTabelle({ data }: { data: VerlaufPunkt[] }) {
  return (
    <div className="overflow-x-auto max-h-[240px] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-white dark:bg-[#242526]">
          <tr className="text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] border-b border-[#ced4da] dark:border-[#3e4042]">
            <th className="text-left py-2 pr-3">Tag</th>
            {SERIEN.map((s) => <th key={s.key} className="text-right py-2 px-3">{s.label}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#f0f2f5] dark:divide-[#3e4042]">
          {[...data].reverse().map((d) => (
            <tr key={d.datum}>
              <td className="py-1.5 pr-3 text-[#1a1a1a] dark:text-[#e4e6eb]" style={{ fontVariantNumeric: "tabular-nums" }}>{kurzDatum(d.datum)}</td>
              {SERIEN.map((s) => (
                <td key={s.key} className="py-1.5 px-3 text-right text-[#65676b] dark:text-[#b0b3b8]" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {nf(s.key === "nichtVerfuegbar" ? d.nichtVerfuegbar ?? 0 : d[s.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Ring: Anteil am Ganzen ────────────────────────────────────────────────────
// Bewusst nur hier eingesetzt: Die Status bilden ein echtes Ganzes und es sind
// höchstens sechs. Für Ranglisten (Top-Geräte usw.) wären Balken richtig — ein
// Ring taugt nicht zum Vergleichen ähnlich großer Werte.

function Ring({ items }: { items: { label: string; value: number; farbe: string }[] }) {
  const gesamt = items.reduce((s, i) => s + i.value, 0);
  if (!gesamt) return <Leer />;

  const R = 54, SW = 18, C = 2 * Math.PI * R, LUECKE = 2; // 2px Fläche trennt die Segmente
  let acc = 0;

  // Bewusst gestapelt statt nebeneinander: Die Karte ist nur ein Drittel breit —
  // daneben blieben der Legende ~100px, die Bezeichnungen wurden abgeschnitten
  // und „210 · 81 %" brach hinter der Zahl um. Gestapelt hat sie die volle Breite.
  return (
    <div className="flex flex-col items-center gap-4">
      <svg viewBox="0 0 140 140" className="w-[140px] h-[140px] shrink-0" role="img" aria-label="Verteilung nach Status">
        <g transform="translate(70,70) rotate(-90)">
          {items.map((i) => {
            const frac = i.value / gesamt;
            const len  = Math.max(frac * C - LUECKE, 0.5);
            const off  = -acc * C;
            acc += frac;
            return (
              <circle key={i.label} r={R} fill="none" stroke={i.farbe} strokeWidth={SW}
                strokeDasharray={`${len} ${C - len}`} strokeDashoffset={off} />
            );
          })}
        </g>
        <text x="70" y="66" textAnchor="middle" fontSize={22} fontWeight={700} fill="var(--ink)">{kompakt(gesamt)}</text>
        <text x="70" y="82" textAnchor="middle" fontSize={10} fill="var(--muted)">gesamt</text>
      </svg>

      {/* Legende trägt Prozent UND absolute Zahl — Farbe allein erklärt nichts */}
      <ul className="w-full space-y-1.5">
        {items.map((i) => (
          <li key={i.label} className="flex items-center gap-2 text-sm">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: i.farbe }} aria-hidden="true" />
            <span className="text-[#1a1a1a] dark:text-[#e4e6eb] truncate">{i.label}</span>
            <span className="ml-auto shrink-0 whitespace-nowrap text-[#65676b] dark:text-[#b0b3b8]"
              style={{ fontVariantNumeric: "tabular-nums" }}>
              {nf(i.value)} · {Math.round((i.value / gesamt) * 100)} %
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Balkenliste ───────────────────────────────────────────────────────────────
// Eine Farbe für alle Balken: Die Kategorien haben keine natürliche Ordnung, und
// die Länge zeigt die Größe bereits. Ein Farbverlauf nach Wert würde dieselbe
// Information doppelt kodieren.

function BalkenListe({ items }: { items: { label: string; value: number }[] }) {
  if (!items.length) return <Leer />;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.label}>
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <span className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb] truncate">{i.label}</span>
            <span className="text-sm font-bold shrink-0 text-[#1a1a1a] dark:text-[#e4e6eb]" style={{ fontVariantNumeric: "tabular-nums" }}>
              {nf(i.value)}
            </span>
          </div>
          <div className="h-2 rounded-sm bg-[#f0f2f5] dark:bg-[#3e4042] overflow-hidden">
            <div className="h-full rounded-r-sm" style={{ width: `${(i.value / max) * 100}%`, background: "var(--s1)" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Hauptansicht ──────────────────────────────────────────────────────────────

export function DashboardAnsicht({ tage, standortId }: { tage: number; standortId: number | null | undefined }) {
  const [reiter, setReiter] = useState<SerienKey | "alle">("alle");
  const [alsTabelle, setAlsTabelle] = useState(false);

  const sId = standortId;
  const kpi        = api.statistik.getKpiOverview.useQuery({ tage, standortId: sId });
  const verlauf    = api.statistik.getAnfragenVerlauf.useQuery({ tage, standortId: sId });
  const status     = api.statistik.getAnfragenNachStatus.useQuery({ standortId: sId });
  const topGeraete = api.statistik.getMeistgefragteGeraete.useQuery({ tage, standortId: sId });
  const topTeile   = api.statistik.getMeistgefragteTeile.useQuery({ tage, standortId: sId });

  // Verlaufsdaten für die Kachel-Sparklines: letzte 12 Tage je Kennzahl.
  const spark = useMemo(() => {
    const d = verlauf.data ?? [];
    const letzte = d.slice(-12);
    return {
      anfragen:        letzte.map((x) => x.anfragen),
      erledigt:        letzte.map((x) => x.erledigt),
      bedarf:          letzte.map((x) => x.bedarf),
      nichtVerfuegbar: letzte.map((x) => x.nichtVerfuegbar ?? 0),
    };
  }, [verlauf.data]);

  const statusItems = (status.data ?? []).map((s) => ({
    label: STATUS_TEXT[s.status] ?? s.status,
    value: s.anzahl,
    farbe: STATUS_SLOT[s.status] ?? "var(--s1)",
  }));

  return (
    <div className="lgn-viz space-y-5">
      <style>{VIZ_CSS}</style>

      {/* ── Kennzahlen ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        {kpi.isLoading ? (
          Array.from({ length: 5 }).map((_, i) => <Laden key={i} h="h-[132px]" />)
        ) : (
          <>
            <Kachel label="Anfragen gesamt" wert={kpi.data?.gesamtAnfragen ?? 0} farbe="var(--s1)" verlauf={spark.anfragen} />
            <Kachel label="Erledigt" wert={kpi.data?.abgeschlossen ?? 0} farbe="var(--s3)" verlauf={spark.erledigt}
              fussnote={`${kpi.data?.erledigungsquote ?? 0} % Erledigungsrate`} />
            <Kachel label="Bedarf / Offen" wert={kpi.data?.bedarf ?? 0} farbe="var(--s5)" verlauf={spark.bedarf} />
            <Kachel label="Nicht verfügbar" wert={kpi.data?.nichtVerfuegbar ?? 0} farbe="var(--s2)" verlauf={spark.nichtVerfuegbar} />
            <Kachel label="Storniert" wert={kpi.data?.storniert ?? 0} farbe="var(--s6)" />
          </>
        )}
      </div>

      {/* ── Verlauf (mit Reitern) + Status-Ring ─────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2">
          <Karte
            titel="Anfragen-Verlauf"
            sub={`Täglich · letzte ${tage} Tage`}
            rechts={
              <button
                onClick={() => setAlsTabelle((v) => !v)}
                className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] shrink-0"
              >
                {alsTabelle ? "Diagramm" : "Tabelle"}
              </button>
            }
          >
            {/* Reiter: eine Kennzahl herausgreifen, wenn sich die Linien überlagern */}
            <div className="flex flex-wrap gap-1 mb-4">
              {([{ key: "alle", label: "Alle" }, ...SERIEN] as { key: SerienKey | "alle"; label: string }[]).map((r) => (
                <button
                  key={r.key}
                  onClick={() => setReiter(r.key)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                    reiter === r.key
                      ? "bg-[#202F61] text-white"
                      : "text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* Legende immer sichtbar, sobald mehr als eine Reihe gezeigt wird */}
            {!alsTabelle && reiter === "alle" && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2">
                {SERIEN.map((s) => (
                  <span key={s.key} className="flex items-center gap-1.5 text-xs text-[#65676b] dark:text-[#b0b3b8]">
                    <span className="w-3 h-[3px] rounded-sm" style={{ background: s.farbe }} aria-hidden="true" />
                    {s.label}
                  </span>
                ))}
              </div>
            )}

            {verlauf.isLoading && <Laden h="h-[240px]" />}
            {verlauf.data && (verlauf.data.length === 0
              ? <Leer />
              : alsTabelle
                ? <VerlaufTabelle data={verlauf.data} />
                : <VerlaufChart data={verlauf.data} aktiv={reiter} />)}
          </Karte>
        </div>

        <Karte titel="Status-Verteilung" sub="Anteil am Gesamtbestand">
          {status.isLoading ? <Laden h="h-[140px]" /> : <Ring items={statusItems} />}
        </Karte>
      </div>

      {/* ── Ranglisten ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Karte titel="Top Geräte" sub={`Letzte ${tage} Tage`}>
          {topGeraete.isLoading ? <Laden /> : (
            <BalkenListe items={(topGeraete.data ?? []).map((g) => ({ label: g.geraet, value: g.anzahl }))} />
          )}
        </Karte>
        <Karte titel="Top Ersatzteile" sub={`Letzte ${tage} Tage`}>
          {topTeile.isLoading ? <Laden /> : (
            <BalkenListe items={(topTeile.data ?? []).map((t) => ({ label: t.teil, value: t.anzahl }))} />
          )}
        </Karte>
      </div>
    </div>
  );
}

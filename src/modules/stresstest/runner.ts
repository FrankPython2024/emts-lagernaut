/**
 * Stress-Test Runner — läuft als Background-Promise im Next.js Serverprozess.
 * Emittiert Socket.io Events an alle Admins für das Live-Dashboard.
 */

import { AnfrageStatus, BuchungsTyp, UserRolle } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma }  from "@/core/db/prisma";
import { emitToAdmins } from "@/modules/realtime/socket";
import { EVENTS }        from "@/modules/realtime/events";
import {
  erstelleAnfrage,
  storniereAnfrage,
  setzeStatus,
  gruppeInBearbeitungNehmen,
  gruppeZurueckgeben,
} from "@/modules/anfragen/service";
import { addItem, submit }      from "@/modules/warenkorb/service";
import { bucheLager }           from "@/modules/buchungen/service";
import { senden as chatSenden } from "@/modules/chat/service";

// ── Typen ─────────────────────────────────────────────────────────────────────

export interface TestConfig {
  duration:     number;   // ms
  numTechniker: number;   // 1-10
  numAdmins:    number;   // 1-3
}

export interface TestEvent {
  ts:      number;
  actor:   string;
  action:  string;
  dauer:   number;
  success: boolean;
  error?:  string;
}

export interface MetricUpdate {
  elapsed:         number;
  opsPerSecond:    number;
  totalOps:        number;
  totalErrors:     number;
  errorRate:       number;
  avgResponseTime: number;
  peakResponseTime: number;
  workerActivity:  Record<string, number>;  // Ops in last 5s
  memMB:           number;
  socketClients:   number;
}

export interface FinalResult {
  runId:        string;
  duration:     number;
  totalOps:     number;
  anfrageErstellt: number;
  anfrageErledigt: number;
  anfrageStorniert: number;
  buchungen:    number;
  chat:         number;
  lockKonflikte: number;
  avgResponseTime: number;
  peakResponseTime: number;
  p95:          number;
  fehler:       number;
  score:        number;
}

interface RunnerStats {
  anfrageErstellt:   number;
  anfrageErledigt:   number;
  anfrageStorniert:  number;
  inBearbeitung:     number;
  buchungen:         number;
  chat:              number;
  lockKonflikte:     number;
  lockGewonnen:      number;
  fehler:            number;
  aktionen:          number;
  responseTimes:     number[];
  recentEvents:      TestEvent[];
  workerActivity:    Record<string, number[]>;  // rolling 10s
}

interface RunnerState {
  runId:       string;
  running:     boolean;
  stopSignal:  boolean;
  config:      TestConfig;
  startTime:   number;
  stats:       RunnerStats;
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let state: RunnerState | null = null;

export function isRunning(): boolean { return state?.running ?? false; }

export function getState(): Omit<RunnerState, "stats"> & {
  elapsed: number;
  totalOps: number;
  fehler: number;
  recentEvents: TestEvent[];
} | null {
  if (!state) return null;
  return {
    runId:       state.runId,
    running:     state.running,
    stopSignal:  state.stopSignal,
    config:      state.config,
    startTime:   state.startTime,
    elapsed:     Date.now() - state.startTime,
    totalOps:    state.stats.aktionen,
    fehler:      state.stats.fehler,
    recentEvents: state.stats.recentEvents.slice(-50),
  };
}

export function stopRunner() {
  if (state) state.stopSignal = true;
}

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

const TEILE   = ["Displaymodul","Tastatur","Touchpad","D Cover","USB Board","Lüfter","Akku","Lautsprecher"];
const GRADINGS = ["A+","A+","A+","A","A","B"];
const ADMIN_CHAT = ["Bitte Gerät bereitstellen","Rückfrage zum Gerät","Teil liegt bereit","Bitte melden"];
const TECH_CHAT  = ["✅ Verstanden","🏃 Hole es gleich ab","📅 Kommt morgen","❓ Habe eine Frage"];

function rand<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]!; }
function p(pct: number): boolean { return Math.random() * 100 < pct; }
function warte(min: number, max: number): Promise<void> {
  return new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
}
function percentile(arr: number[], pct: number): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor((pct / 100) * s.length)] ?? 0;
}

function logEvent(actor: string, action: string, dauer: number, success: boolean, error?: string) {
  if (!state) return;
  const ev: TestEvent = { ts: Date.now(), actor, action, dauer, success, error };
  state.stats.recentEvents = [ev, ...state.stats.recentEvents].slice(0, 100);

  if (!state.stats.workerActivity[actor]) state.stats.workerActivity[actor] = [];
  state.stats.workerActivity[actor]!.push(dauer);
  if (state.stats.workerActivity[actor]!.length > 10) {
    state.stats.workerActivity[actor]!.shift();
  }

  emitToAdmins(EVENTS.STRESSTEST_EVENT, ev);
}

async function messe<T>(actor: string, action: string, fn: () => Promise<T>): Promise<T> {
  if (!state) throw new Error("Nicht gestartet");
  const start = Date.now();
  try {
    const r = await fn();
    const dauer = Date.now() - start;
    state.stats.responseTimes.push(dauer);
    if (state.stats.responseTimes.length > 5000) state.stats.responseTimes.shift();
    state.stats.aktionen++;
    logEvent(actor, action, dauer, true);
    return r;
  } catch (err) {
    const dauer = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    state.stats.fehler++;
    logEvent(actor, action, dauer, false, msg.slice(0, 80));
    throw err;
  }
}

// ── User Setup ────────────────────────────────────────────────────────────────

async function ensureUser(kuerzel: string, rolle: UserRolle) {
  const ex = await prisma.user.findUnique({ where: { kuerzel } });
  if (ex) return;
  const hash = await bcrypt.hash("stress123", 10);
  await prisma.user.create({
    data: {
      kuerzel,
      name:     `Stress-${kuerzel}`,
      email:    `${kuerzel.toLowerCase()}@stress.test`,
      password: hash,
      rolle,
      aktiv:    true,
    },
  }).catch(() => {});
}

// ── Test-Daten ────────────────────────────────────────────────────────────────

async function ladeTestDaten() {
  const [geraete, artikel] = await Promise.all([
    prisma.geraeteLookup.findMany({ take: 20, select: { logId: true, bezeichnung: true } }),
    prisma.artikel.findMany({ where: { bestand: { gt: 0 } }, take: 20, select: { id: true } }),
  ]);
  const logIds    = geraete.length > 0 ? geraete : [
    { logId: "STRESS-A", bezeichnung: "Test-Gerät A" },
    { logId: "STRESS-B", bezeichnung: "Test-Gerät B" },
  ];
  const artikelIds = artikel.map((a) => a.id);
  return { logIds, artikelIds };
}

// ── Techniker-Aktionen ────────────────────────────────────────────────────────

async function tkErstellt(kuerzel: string, logIds: { logId: string; bezeichnung: string }[], artikelIds: number[]) {
  const { logId, bezeichnung } = rand(logIds);
  const n = 2 + Math.floor(Math.random() * 3);
  let korbId: number | null = null;

  for (let i = 0; i < n; i++) {
    const korb = await addItem({
      techniker:   kuerzel,
      logId,
      geraeteName: bezeichnung,
      artikelId:   artikelIds.length > 0 && p(70) ? rand(artikelIds) : null,
      teiltyp:     rand(TEILE),
      grading:     rand(GRADINGS),
      zusatzinfo:  i === 0 ? `STRESSTEST_${state!.runId}` : undefined,
    });
    korbId = korb?.id ?? korbId;
  }

  if (!korbId) return;
  const r = await submit({ korbId, zusatzinfo: `STRESSTEST_${state!.runId}` });
  if (state) state.stats.anfrageErstellt += r.anzahl;
}

async function tkStorno(kuerzel: string) {
  const a = await prisma.anfrage.findFirst({
    where:   { techniker: kuerzel.toUpperCase(), status: { in: [AnfrageStatus.NEU, AnfrageStatus.BEDARF] }, kommentar: { contains: "STRESSTEST" } },
    orderBy: { datum: "desc" },
    select:  { id: true, logId: true, teil: true },
  });
  if (!a) return;
  await storniereAnfrage({ techniker: kuerzel, logId: a.logId, teil: a.teil });
  if (state) state.stats.anfrageStorniert++;
}

async function tkChat(kuerzel: string) {
  const a = await prisma.anfrage.findFirst({
    where:   { techniker: kuerzel.toUpperCase(), status: { in: [AnfrageStatus.NEU, AnfrageStatus.BEDARF, AnfrageStatus.IN_BEARBEITUNG] }, kommentar: { contains: "STRESSTEST" } },
    orderBy: { datum: "desc" },
    select:  { id: true },
  });
  if (!a) return;
  await chatSenden({ anfrageId: a.id, vonKuerzel: kuerzel, empfKuerzel: "ADMIN", inhalt: rand(TECH_CHAT) });
  if (state) state.stats.chat++;
}

// ── Admin-Aktionen ────────────────────────────────────────────────────────────

async function adNehmen(kuerzel: string) {
  const a = await prisma.anfrage.findFirst({
    where:   { status: { in: [AnfrageStatus.NEU, AnfrageStatus.BEDARF] }, bearbeitetVon: null, kommentar: { contains: "STRESSTEST" } },
    orderBy: { datum: "asc" },
    select:  { id: true },
  });
  if (!a) return;
  await gruppeInBearbeitungNehmen([a.id], kuerzel);
  if (state) { state.stats.inBearbeitung++; state.stats.lockGewonnen++; }
}

async function adErledigt(kuerzel: string) {
  const a = await prisma.anfrage.findFirst({
    where:   { status: AnfrageStatus.IN_BEARBEITUNG, bearbeitetVon: kuerzel, kommentar: { contains: "STRESSTEST" } },
    orderBy: { bearbeitetSeit: "desc" },
    select:  { id: true },
  });
  if (!a) return;
  await setzeStatus(a.id, AnfrageStatus.ABGESCHLOSSEN);
  if (state) state.stats.anfrageErledigt++;
}

async function adChat(kuerzel: string) {
  const a = await prisma.anfrage.findFirst({
    where:   { status: { in: [AnfrageStatus.NEU, AnfrageStatus.BEDARF, AnfrageStatus.IN_BEARBEITUNG] }, kommentar: { contains: "STRESSTEST" } },
    orderBy: { datum: "desc" },
    select:  { id: true, techniker: true },
  });
  if (!a) return;
  await chatSenden({ anfrageId: a.id, vonKuerzel: kuerzel, empfKuerzel: a.techniker, inhalt: rand(ADMIN_CHAT) });
  if (state) state.stats.chat++;
}

async function adBuchung(kuerzel: string) {
  const art = await prisma.artikel.findFirst({ where: { bestand: { gt: 0 } }, select: { id: true } });
  if (!art) return;
  await bucheLager({ artikelId: art.id, menge: 1, typ: BuchungsTyp.EINGANG, mitarbeiter: kuerzel, notiz: `STRESSTEST_${state!.runId}` });
  if (state) state.stats.buchungen++;
}

// ── Race-Condition-Test ───────────────────────────────────────────────────────

async function raceTest(adA: string, adB: string) {
  const a = await prisma.anfrage.findFirst({
    where:   { status: { in: [AnfrageStatus.NEU, AnfrageStatus.BEDARF] }, bearbeitetVon: null, kommentar: { contains: "STRESSTEST" } },
    select:  { id: true },
  });
  if (!a) return;

  const [rA, rB] = await Promise.allSettled([
    gruppeInBearbeitungNehmen([a.id], adA),
    gruppeInBearbeitungNehmen([a.id], adB),
  ]);

  const konflikte = [rA, rB].filter((r) => r.status === "rejected").length;
  if (state) state.stats.lockKonflikte += konflikte;

  const gewinner = rA.status === "fulfilled" ? adA : adB;
  logEvent("RACE", "lock_race_test", 0, konflikte === 1,
    konflikte !== 1 ? "RACE_CONDITION_FEHLER!" : undefined);

  await gruppeZurueckgeben([a.id], gewinner).catch(() => {});
}

// ── Agenten-Schleifen ─────────────────────────────────────────────────────────

async function technikerAgent(kuerzel: string, data: { logIds: { logId: string; bezeichnung: string }[]; artikelIds: number[] }, isDone: () => boolean) {
  await warte(5_000, 20_000);  // Verzögerter Start
  while (!isDone()) {
    await warte(60_000, 180_000);
    if (isDone()) break;
    const r = Math.random() * 100;
    try {
      if (r < 70)       await messe(kuerzel, "anfrage_erstellt",  () => tkErstellt(kuerzel, data.logIds, data.artikelIds));
      else if (r < 85)  await messe(kuerzel, "chat_antwort",      () => tkChat(kuerzel));
      else if (r < 95)  await messe(kuerzel, "storno",            () => tkStorno(kuerzel));
    } catch { /* Fehler bereits in messe() geloggt */ }
  }
}

async function adminAgent(kuerzel: string, isDone: () => boolean) {
  await warte(20_000, 40_000);  // Admins starten später
  while (!isDone()) {
    await warte(30_000, 90_000);
    if (isDone()) break;
    const r = Math.random() * 100;
    try {
      if (r < 40)       await messe(kuerzel, "in_bearbeitung",    () => adNehmen(kuerzel));
      else if (r < 70)  await messe(kuerzel, "erledigt",          () => adErledigt(kuerzel));
      else if (r < 85)  await messe(kuerzel, "chat",              () => adChat(kuerzel));
      else if (r < 95)  await messe(kuerzel, "buchung",           () => adBuchung(kuerzel));
    } catch { /* Fehler bereits in messe() geloggt */ }
  }
}

async function raceAgent(admins: string[], isDone: () => boolean) {
  await warte(90_000, 120_000);
  while (!isDone()) {
    await warte(120_000, 300_000);
    if (isDone()) break;
    if (admins.length >= 2) {
      await raceTest(admins[0]!, admins[1]!).catch(() => {});
    }
  }
}

// ── Metriken-Emitter ──────────────────────────────────────────────────────────

function startMetricsEmitter(): NodeJS.Timeout {
  let prevOps = 0;
  let prevTs  = Date.now();

  return setInterval(() => {
    if (!state) return;
    const now     = Date.now();
    const dtSec   = (now - prevTs) / 1000;
    const newOps  = state.stats.aktionen - prevOps;
    const opsPerSec = dtSec > 0 ? Math.round(newOps / dtSec) : 0;
    prevOps = state.stats.aktionen;
    prevTs  = now;

    const rt      = state.stats.responseTimes;
    const avg     = rt.length > 0 ? Math.round(rt.reduce((s, n) => s + n, 0) / rt.length) : 0;
    const peak    = rt.length > 0 ? Math.max(...rt.slice(-200)) : 0;
    const errRate = state.stats.aktionen > 0
      ? parseFloat(((state.stats.fehler / state.stats.aktionen) * 100).toFixed(2))
      : 0;

    const activity: Record<string, number> = {};
    for (const [actor, times] of Object.entries(state.stats.workerActivity)) {
      const recent = times.slice(-5);
      activity[actor] = recent.length;
    }

    const mem = process.memoryUsage();
    const io  = (global as { io?: { sockets?: { sockets?: Map<unknown, unknown> } } }).io;
    const socketCount = io?.sockets?.sockets?.size ?? 0;

    const update: MetricUpdate = {
      elapsed:          now - state.startTime,
      opsPerSecond:     opsPerSec,
      totalOps:         state.stats.aktionen,
      totalErrors:      state.stats.fehler,
      errorRate:        errRate,
      avgResponseTime:  avg,
      peakResponseTime: peak,
      workerActivity:   activity,
      memMB:            Math.round(mem.heapUsed / 1024 / 1024),
      socketClients:    socketCount,
    };

    emitToAdmins(EVENTS.STRESSTEST_METRICS, update);
  }, 1000);
}

// ── Hauptfunktion ─────────────────────────────────────────────────────────────

export async function startRunner(config: TestConfig): Promise<string> {
  if (state?.running) throw new Error("Ein Test läuft bereits. Bitte zuerst stoppen.");

  const runId = Date.now().toString(36).toUpperCase();
  const TECHNIKER = ["FS","VS","MG","HG","AB","AB2","MF","JS2","TH1","WH"].slice(0, config.numTechniker);
  const ADMINS    = ["FRANK","CHRISTIAN","RONNY"].slice(0, config.numAdmins);

  state = {
    runId,
    running:     true,
    stopSignal:  false,
    config,
    startTime:   Date.now(),
    stats: {
      anfrageErstellt: 0, anfrageErledigt: 0, anfrageStorniert: 0,
      inBearbeitung: 0, buchungen: 0, chat: 0, lockKonflikte: 0,
      lockGewonnen: 0, fehler: 0, aktionen: 0,
      responseTimes: [], recentEvents: [], workerActivity: {},
    },
  };

  // Hintergrund-Promise starten (detached)
  void (async () => {
    const metricsTimer = startMetricsEmitter();
    try {
      // User sicherstellen
      await Promise.all([
        ...TECHNIKER.map((k) => ensureUser(k, UserRolle.TECHNIKER)),
        ...ADMINS.map((k)    => ensureUser(k, UserRolle.ADMIN)),
      ]);

      const testDaten = await ladeTestDaten();
      const isDone = () => !state || state.stopSignal || (Date.now() - state.startTime) >= config.duration;

      await Promise.allSettled([
        ...TECHNIKER.map((k) => technikerAgent(k, testDaten, isDone)),
        ...ADMINS.map((k)    => adminAgent(k, isDone)),
        raceAgent(ADMINS, isDone),
      ]);
    } finally {
      clearInterval(metricsTimer);
      if (!state) return;

      const rt   = state.stats.responseTimes;
      const avg  = rt.length > 0 ? Math.round(rt.reduce((s, n) => s + n, 0) / rt.length) : 0;
      const peak = rt.length > 0 ? Math.max(...rt) : 0;
      const p95  = percentile(rt, 95);
      const errRate = state.stats.aktionen > 0 ? (state.stats.fehler / state.stats.aktionen) * 100 : 0;
      const score = state.stats.aktionen > 0 && avg > 0
        ? Math.round((state.stats.aktionen * 100) / (avg + errRate * 1000))
        : 0;

      const result: FinalResult = {
        runId,
        duration:         Date.now() - state.startTime,
        totalOps:         state.stats.aktionen,
        anfrageErstellt:  state.stats.anfrageErstellt,
        anfrageErledigt:  state.stats.anfrageErledigt,
        anfrageStorniert: state.stats.anfrageStorniert,
        buchungen:        state.stats.buchungen,
        chat:             state.stats.chat,
        lockKonflikte:    state.stats.lockKonflikte,
        avgResponseTime:  avg,
        peakResponseTime: peak,
        p95,
        fehler:           state.stats.fehler,
        score,
      };

      state.running = false;
      emitToAdmins(EVENTS.STRESSTEST_DONE, result);
    }
  })();

  return runId;
}

export async function cleanupTestData(runId?: string) {
  const marker = runId ? `STRESSTEST_${runId}` : "STRESSTEST";
  const anfragen = await prisma.anfrage.findMany({
    where:  { kommentar: { contains: marker } },
    select: { id: true },
  });
  const ids = anfragen.map((a) => a.id);

  if (ids.length > 0) {
    const chatLogIds = ids.map((id) => `chat:${id}`);
    const nachrichten = await prisma.nachricht.findMany({ where: { logId: { in: chatLogIds } }, select: { id: true } });
    const nIds = nachrichten.map((n) => n.id);
    if (nIds.length > 0) {
      await prisma.nachrichtEmpf.deleteMany({ where: { nachrichtId: { in: nIds } } });
      await prisma.nachrichtAntwort.deleteMany({ where: { nachrichtId: { in: nIds } } });
      await prisma.nachricht.deleteMany({ where: { id: { in: nIds } } });
    }
    await prisma.anfrage.deleteMany({ where: { id: { in: ids } } });
  }

  const buchungen = await prisma.buchung.deleteMany({ where: { notiz: { contains: marker } } });
  return { anfragen: ids.length, buchungen: buchungen.count };
}

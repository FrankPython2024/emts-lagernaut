/**
 * Stress-Test Runner — Background-Promise im Next.js Serverprozess.
 * Emittiert Socket.io Events an Admins für das Live-Dashboard.
 *
 * INTERVALLE: Bewusst kurz (3–15s) für sichtbare Dashboard-Aktivität.
 * Das Scripts/stressTest.ts nutzt realistische 1–3min für Produktions-Simulation.
 */

import { AnfrageStatus, BuchungsTyp, UserRolle } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma }        from "@/core/db/prisma";
import { emitToAdmins }  from "@/modules/realtime/socket";
import { EVENTS }        from "@/modules/realtime/events";
export type { LoadMode, ErrorKategorie, TestEvent, MetricUpdate, FinalResult, ErrorDetail, TestConfig } from "./types";
export { LOAD_MODES } from "./types";
import type { LoadMode, ErrorKategorie, ErrorDetail, FinalResult, MetricUpdate, TestEvent, TestConfig } from "./types";
import { LOAD_MODES } from "./types";
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
  errors:            ErrorDetail[];
  workerActivity:    Record<string, number[]>;
  aktionenPerAkteur: Record<string, number>;
  fehlerPerAkteur:   Record<string, number>;
  memMBStart:        number;
  memMBPeak:         number;
}

interface RunnerState {
  runId:      string;
  running:    boolean;
  stopSignal: boolean;
  config:     TestConfig;
  startTime:  number;
  stats:      RunnerStats;
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let state: RunnerState | null = null;

export function isRunning(): boolean { return state?.running ?? false; }

export function getState() {
  if (!state) return null;
  return {
    runId:        state.runId,
    running:      state.running,
    stopSignal:   state.stopSignal,
    config:       state.config,
    startTime:    state.startTime,
    elapsed:      Date.now() - state.startTime,
    totalOps:     state.stats.aktionen,
    fehler:       state.stats.fehler,
    recentEvents: state.stats.recentEvents.slice(-100),
    errors:       state.stats.errors.slice(-50),
  };
}

export function getErrors(): ErrorDetail[] {
  return state?.stats.errors ?? [];
}

export function stopRunner() {
  if (state) {
    state.stopSignal = true;
    console.log("[Stresstest] Stop-Signal gesetzt");
  }
}

// ── Fehler-Kategorisierung + Empfehlungen ────────────────────────────────────

function kategorisiere(message: string, errorName: string): ErrorKategorie {
  const m = message.toLowerCase();
  const n = errorName.toLowerCase();

  // ZodError: Validierungsproblem
  if (n === "zoderror" || m.includes("zoderror") || m.includes("expected") || m.includes("too_small") || m.includes("too_big")) return "validation";

  // Prisma P2002: Unique Constraint
  if (m.includes("p2002") || m.includes("unique constraint") || m.includes("duplicate entry")) return "duplicate";

  // Prisma P2025: Record Not Found
  if (m.includes("p2025") || m.includes("record to update not found") || m.includes("record to delete not found")) return "stale";

  // Lock / Race Conditions
  if (m.includes("bearbeitung") || m.includes("bereits") || m.includes("conflict") || m.includes("lock") || m.includes("gewonnen") || m.includes("übernommen")) return "race";

  // tRPC API-Fehler
  if (m.includes("bad_request") || m.includes("not_found") || m.includes("forbidden") || m.includes("not möglich") || m.includes("nicht gefunden")) return "api";

  return "bug";
}

function getEmpfehlung(kategorie: ErrorKategorie, message: string): string {
  switch (kategorie) {
    case "race":       return "✅ Erwartet: Lock-System verhindert Doppelarbeit. Kein Code-Fehler.";
    case "validation": return "Prüfe Zod-Schema im Router. Optional vs. required korrekt?";
    case "duplicate":  return "Unique-Constraint verletzt. Race Condition bei gleichzeitiger Erstellung?";
    case "stale":      return "Ressource während Operation gelöscht. Stale-Reference-Problem.";
    case "api":        return `API-Logik-Fehler: ${message.slice(0, 60)}`;
    case "bug":        return "Echten Bug untersuchen — Stack-Trace und Kontext prüfen.";
  }
}

// ── Konstanten ────────────────────────────────────────────────────────────────

const TEILE    = ["Displaymodul","Tastatur","Touchpad","D Cover","USB Board","Lüfter","Akku","Lautsprecher"];
const GRADINGS = ["A+","A+","A+","A","A","B"];
const ADMIN_CHAT = ["Bitte Gerät bereitstellen","Rückfrage","Teil liegt bereit","Bitte melden"];
const TECH_CHAT  = ["✅ Verstanden","🏃 Hole ab","📅 Morgen","❓ Frage"];

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

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

  // Im Server-Log sichtbar
  if (success) {
    console.log(`[Stresstest] ${actor.padEnd(12)} ${action.padEnd(20)} ${dauer}ms`);
  } else {
    console.warn(`[Stresstest] ${actor.padEnd(12)} ${action.padEnd(20)} FEHLER: ${error}`);
  }

  state.stats.recentEvents = [ev, ...state.stats.recentEvents].slice(0, 200);

  if (!state.stats.workerActivity[actor]) state.stats.workerActivity[actor] = [];
  state.stats.workerActivity[actor]!.push(dauer);
  if (state.stats.workerActivity[actor]!.length > 30) {
    state.stats.workerActivity[actor]!.shift();
  }

  emitToAdmins(EVENTS.STRESSTEST_EVENT, ev);
}

async function messe<T>(actor: string, action: string, fn: () => Promise<T>): Promise<T> {
  if (!state) throw new Error("Runner nicht aktiv");
  const start = Date.now();
  try {
    const result = await fn();
    const dauer  = Date.now() - start;
    state.stats.responseTimes.push(dauer);
    if (state.stats.responseTimes.length > 10_000) state.stats.responseTimes.shift();
    state.stats.aktionen++;
    state.stats.aktionenPerAkteur[actor] = (state.stats.aktionenPerAkteur[actor] ?? 0) + 1;
    logEvent(actor, action, dauer, true);
    return result;
  } catch (err) {
    const dauer = Date.now() - start;
    const msg   = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack?.split("\n").slice(0, 6).join("\n") : undefined;
    state.stats.fehler++;
    state.stats.fehlerPerAkteur[actor] = (state.stats.fehlerPerAkteur[actor] ?? 0) + 1;
    logEvent(actor, action, dauer, false, msg.slice(0, 120));

    const errorName = err instanceof Error ? err.constructor.name : "Error";
    const kat       = kategorisiere(msg, errorName);

    // Vollständige Fehlerdetails für Dashboard
    const detail: ErrorDetail = {
      ts:         Date.now(),
      actor,
      action,
      errorName,
      message:    msg,
      stack,
      kategorie:  kat,
      empfehlung: getEmpfehlung(kat, msg),
    };
    state.stats.errors = [detail, ...state.stats.errors].slice(0, 200);

    throw err;
  }
}

// ── User-Setup ────────────────────────────────────────────────────────────────

async function ensureUser(kuerzel: string, rolle: UserRolle) {
  try {
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
    });
    console.log(`[Stresstest] User angelegt: ${kuerzel} (${rolle})`);
  } catch (err) {
    console.warn(`[Stresstest] ensureUser ${kuerzel} → ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Test-Daten ────────────────────────────────────────────────────────────────

async function ladeTestDaten() {
  const [geraete, artikel] = await Promise.all([
    prisma.geraeteLookup.findMany({ take: 30, select: { logId: true, bezeichnung: true } }),
    prisma.artikel.findMany({ where: { bestand: { gt: 0 } }, take: 30, select: { id: true } }),
  ]);

  const logIds = geraete.length > 0 ? geraete : [
    { logId: "STRESS-A", bezeichnung: "Test-Gerät A" },
    { logId: "STRESS-B", bezeichnung: "Test-Gerät B" },
    { logId: "STRESS-C", bezeichnung: "Test-Gerät C" },
  ];

  const artikelIds = artikel.map((a) => a.id);

  console.log(`[Stresstest] Daten geladen: ${logIds.length} LogIDs, ${artikelIds.length} Artikel`);
  return { logIds, artikelIds };
}

// ── Techniker-Aktionen ────────────────────────────────────────────────────────

async function tkErstellt(kuerzel: string, logIds: { logId: string; bezeichnung: string }[], artikelIds: number[]) {
  const { logId, bezeichnung } = rand(logIds);
  const n = 1 + Math.floor(Math.random() * 3); // 1–3 Teile
  let korbId: number | null = null;

  for (let i = 0; i < n; i++) {
    const korb = await addItem({
      techniker:   kuerzel,
      logId,
      geraeteName: bezeichnung,
      artikelId:   artikelIds.length > 0 && p(65) ? rand(artikelIds) : null,
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
    where:   {
      techniker: kuerzel.toUpperCase(),
      status:    { in: [AnfrageStatus.NEU, AnfrageStatus.BEDARF, AnfrageStatus.IN_BEARBEITUNG] },
      kommentar: { contains: "STRESSTEST" },
    },
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
  logEvent("RACE_TEST", "lock_race", 0, konflikte === 1,
    konflikte !== 1 ? "RACE_CONDITION_FEHLER!" : undefined);

  await gruppeZurueckgeben([a.id], gewinner).catch(() => {});
}

// ── Agenten-Schleifen ─────────────────────────────────────────────────────────
//
// WICHTIG: Kurze Intervalle (3–15s) für Dashboard-Sichtbarkeit.
// Das scripts/stressTest.ts nutzt 1–3min für echte Produktions-Simulation.

async function technikerAgent(
  kuerzel: string,
  data: { logIds: { logId: string; bezeichnung: string }[]; artikelIds: number[] },
  isDone: () => boolean,
  iv: { min: number; max: number },
) {
  console.log(`[Stresstest] Techniker-Agent gestartet: ${kuerzel}`);
  await warte(0, Math.min(3_000, iv.min));  // gestaffelt, aber max 3s

  while (!isDone()) {
    const r = Math.random() * 100;
    try {
      if (r < 70)       await messe(kuerzel, "anfrage_erstellt", () => tkErstellt(kuerzel, data.logIds, data.artikelIds));
      else if (r < 85)  await messe(kuerzel, "chat_antwort",     () => tkChat(kuerzel));
      else if (r < 95)  await messe(kuerzel, "storno",           () => tkStorno(kuerzel));
    } catch { /* Fehler bereits in messe() geloggt */ }

    if (isDone()) break;
    await warte(iv.min, iv.max);
  }

  console.log(`[Stresstest] Techniker-Agent beendet: ${kuerzel}`);
}

async function adminAgent(
  kuerzel: string,
  isDone: () => boolean,
  iv: { min: number; max: number },
) {
  console.log(`[Stresstest] Admin-Agent gestartet: ${kuerzel}`);
  await warte(Math.min(5_000, iv.max), Math.min(15_000, iv.max * 2));  // Admins starten später

  while (!isDone()) {
    const r = Math.random() * 100;
    try {
      if (r < 40)       await messe(kuerzel, "in_bearbeitung", () => adNehmen(kuerzel));
      else if (r < 70)  await messe(kuerzel, "erledigt",       () => adErledigt(kuerzel));
      else if (r < 85)  await messe(kuerzel, "chat",           () => adChat(kuerzel));
      else if (r < 95)  await messe(kuerzel, "buchung",        () => adBuchung(kuerzel));
    } catch { /* Fehler bereits in messe() geloggt */ }

    if (isDone()) break;
    await warte(iv.min, iv.max);
  }

  console.log(`[Stresstest] Admin-Agent beendet: ${kuerzel}`);
}

async function raceAgent(admins: string[], isDone: () => boolean) {
  await warte(20_000, 30_000); // Erst nach 20–30s starten (braucht erst Anfragen)

  while (!isDone()) {
    await warte(15_000, 40_000);
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
    const now      = Date.now();
    const dtSec    = (now - prevTs) / 1000;
    const newOps   = state.stats.aktionen - prevOps;
    const opsPerSec = dtSec > 0 ? parseFloat((newOps / dtSec).toFixed(1)) : 0;
    prevOps = state.stats.aktionen;
    prevTs  = now;

    const rt      = state.stats.responseTimes;
    const avg     = rt.length > 0 ? Math.round(rt.reduce((s, n) => s + n, 0) / rt.length) : 0;
    const recent  = rt.slice(-500);
    const peak    = recent.length > 0 ? Math.max(...recent) : 0;
    const errRate = state.stats.aktionen > 0
      ? parseFloat(((state.stats.fehler / state.stats.aktionen) * 100).toFixed(2))
      : 0;

    const activity: Record<string, number> = {};
    for (const [actor, times] of Object.entries(state.stats.workerActivity)) {
      activity[actor] = times.slice(-5).length;
    }

    const io = (global as { io?: { sockets?: { sockets?: Map<unknown, unknown> } } }).io;

    const update: MetricUpdate = {
      elapsed:          now - state.startTime,
      opsPerSecond:     opsPerSec,
      totalOps:         state.stats.aktionen,
      totalErrors:      state.stats.fehler,
      errorRate:        errRate,
      avgResponseTime:  avg,
      peakResponseTime: peak,
      workerActivity:   activity,
      memMB:            Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      socketClients:    io?.sockets?.sockets?.size ?? 0,
    };

    emitToAdmins(EVENTS.STRESSTEST_METRICS, update);

    // Memory-Peak tracken
    if (state && update.memMB > state.stats.memMBPeak) {
      state.stats.memMBPeak = update.memMB;
    }
  }, 1_000);
}

// ── Startfunktion ─────────────────────────────────────────────────────────────

export async function startRunner(config: TestConfig): Promise<string> {
  if (state?.running) throw new Error("Ein Test läuft bereits.");

  const runId     = Date.now().toString(36).toUpperCase();
  const TECHNIKER = ["FS","VS","MG","HG","AB","AB2","MF","JS2","TH1","WH"].slice(0, config.numTechniker);
  const ADMINS    = ["FRANK","CHRISTIAN","RONNY"].slice(0, config.numAdmins);

  console.log(`[Stresstest] ▶ Start — RunID: ${runId}`);
  console.log(`[Stresstest]   Dauer: ${config.duration / 1000}s | Techniker: ${TECHNIKER.length} | Admins: ${ADMINS.length}`);
  console.log(`[Stresstest]   io verfügbar: ${!!(global as { io?: unknown }).io}`);

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
      responseTimes: [], recentEvents: [], errors: [], workerActivity: {},
      aktionenPerAkteur: {}, fehlerPerAkteur: {},
      memMBStart: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      memMBPeak:  0,
    },
  };

  // Background-Promise (detached — kein await!)
  void (async () => {
    const metricsTimer = startMetricsEmitter();
    try {
      console.log("[Stresstest] Initialisierung: User-Setup + Daten laden...");

      await Promise.all([
        ...TECHNIKER.map((k) => ensureUser(k, UserRolle.TECHNIKER)),
        ...ADMINS.map((k)    => ensureUser(k, UserRolle.ADMIN)),
      ]);

      const testDaten = await ladeTestDaten();
      const modeIvs  = LOAD_MODES[config.loadMode];

      const isDone = () => !state || state.stopSignal || (Date.now() - state.startTime) >= config.duration;

      console.log(`[Stresstest] Agenten starten (${TECHNIKER.length} Techniker, ${ADMINS.length} Admins, Modus: ${modeIvs.label})...`);

      await Promise.allSettled([
        ...TECHNIKER.map((k) => technikerAgent(k, testDaten, isDone, modeIvs.technikerInterval)),
        ...ADMINS.map((k)    => adminAgent(k, isDone, modeIvs.adminInterval)),
        raceAgent(ADMINS, isDone),
      ]);

      console.log(`[Stresstest] Alle Agenten beendet.`);
    } catch (err) {
      console.error("[Stresstest] Kritischer Fehler:", err);
    } finally {
      clearInterval(metricsTimer);
      if (!state) return;

      const rt      = state.stats.responseTimes;
      const avg     = rt.length > 0 ? Math.round(rt.reduce((s, n) => s + n, 0) / rt.length) : 0;
      const peak    = rt.length > 0 ? Math.max(...rt) : 0;
      const p95     = percentile(rt, 95);
      const errRate = state.stats.aktionen > 0 ? (state.stats.fehler / state.stats.aktionen) * 100 : 0;
      const score   = state.stats.aktionen > 0 && avg > 0
        ? Math.round((state.stats.aktionen * 100) / (avg + errRate * 1000))
        : 0;

      // Fehler pro Kategorie aggregieren
      const fehlerPerKategorie: Partial<Record<ErrorKategorie, number>> = {};
      for (const e of state.stats.errors) {
        fehlerPerKategorie[e.kategorie] = (fehlerPerKategorie[e.kategorie] ?? 0) + 1;
      }

      const endTime = Date.now();
      const result: FinalResult = {
        runId,
        duration:           endTime - state.startTime,
        totalOps:           state.stats.aktionen,
        anfrageErstellt:    state.stats.anfrageErstellt,
        anfrageErledigt:    state.stats.anfrageErledigt,
        anfrageStorniert:   state.stats.anfrageStorniert,
        buchungen:          state.stats.buchungen,
        chat:               state.stats.chat,
        lockKonflikte:      state.stats.lockKonflikte,
        avgResponseTime:    avg,
        peakResponseTime:   peak,
        p95,
        fehler:             state.stats.fehler,
        score,
        // Erweitert
        modus:              state.config.loadMode,
        numTechniker:       config.numTechniker,
        numAdmins:          config.numAdmins,
        startTime:          state.startTime,
        memMBStart:         state.stats.memMBStart,
        memMBPeak:          state.stats.memMBPeak,
        aktionenPerAkteur:  { ...state.stats.aktionenPerAkteur },
        fehlerPerAkteur:    { ...state.stats.fehlerPerAkteur },
        fehlerPerKategorie,
      };

      // In DB speichern (non-blocking, optional)
      prisma.stressTestRun.create({
        data: {
          startedAt:    new Date(state.startTime),
          endedAt:      new Date(endTime),
          modus:        state.config.loadMode,
          technikerAnz: config.numTechniker,
          adminAnz:     config.numAdmins,
          score,
          totalOps:     state.stats.aktionen,
          fehler:       state.stats.fehler,
          avgResponseMs: avg,
          p95Ms:        p95,
          report:       JSON.parse(JSON.stringify(result)),
        },
      }).catch((e: Error) => console.warn("[Stresstest] DB-Save fehlgeschlagen (Migration ausgeführt?):", e.message));

      console.log(`[Stresstest] ■ Ende — Score: ${score} | Ops: ${state.stats.aktionen} | Fehler: ${state.stats.fehler}`);

      state.running = false;
      emitToAdmins(EVENTS.STRESSTEST_DONE, result);
    }
  })();

  return runId;
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

export async function cleanupTestData(runId?: string) {
  const marker = runId ? `STRESSTEST_${runId}` : "STRESSTEST";

  const anfragen = await prisma.anfrage.findMany({
    where:  { kommentar: { contains: marker } },
    select: { id: true },
  });
  const ids = anfragen.map((a) => a.id);

  if (ids.length > 0) {
    const chatLogIds  = ids.map((id) => `chat:${id}`);
    const nachrichten = await prisma.nachricht.findMany({ where: { logId: { in: chatLogIds } }, select: { id: true } });
    const nIds        = nachrichten.map((n) => n.id);
    if (nIds.length > 0) {
      await prisma.nachrichtEmpf.deleteMany({ where: { nachrichtId: { in: nIds } } });
      await prisma.nachrichtAntwort.deleteMany({ where: { nachrichtId: { in: nIds } } });
      await prisma.nachricht.deleteMany({ where: { id: { in: nIds } } });
    }
    await prisma.anfrage.deleteMany({ where: { id: { in: ids } } });
  }

  const buchungen = await prisma.buchung.deleteMany({ where: { notiz: { contains: marker } } });
  console.log(`[Stresstest] Cleanup: ${ids.length} Anfragen, ${buchungen.count} Buchungen gelöscht`);
  return { anfragen: ids.length, buchungen: buchungen.count };
}

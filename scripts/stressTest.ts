#!/usr/bin/env tsx
/**
 * scripts/stressTest.ts
 *
 * 1-Stunden Stress-Test für Lagernaut v2.
 * Simuliert 10 Techniker + 3 Admins mit realistischen Workflows.
 * Alle Test-Daten werden mit STRESSTEST_ markiert → einfaches Cleanup.
 *
 * Verwendung:
 *   npm run stresstest                          ← 1 Stunde
 *   TEST_DURATION=300000 npm run stresstest     ← 5 Minuten
 *   TEST_DURATION=60000  npm run stresstest     ← 1 Minute (smoke test)
 */

import * as readline from "readline";
import * as fs        from "fs";
import { AnfrageStatus, BuchungsTyp, UserRolle, type Anfrage } from "@prisma/client";
import bcrypt from "bcryptjs";

// ── Service-Imports (direkter Aufruf, kein HTTP) ────────────────────────────

import { prisma } from "../src/core/db/prisma";
import {
  erstelleAnfrage,
  storniereAnfrage,
  setzeStatus,
  gruppeInBearbeitungNehmen,
  gruppeFreigeben,
  gruppeZurueckgeben,
} from "../src/modules/anfragen/service";
import { addItem, submit }      from "../src/modules/warenkorb/service";
import { bucheLager }           from "../src/modules/buchungen/service";
import { senden as chatSenden } from "../src/modules/chat/service";

// ── Konfiguration ────────────────────────────────────────────────────────────

const RUN_ID = Date.now().toString().slice(-6); // 6 Stellen für Markierung

const CONFIG = {
  duration:    parseInt(process.env.TEST_DURATION ?? "") || 60 * 60 * 1000,
  techniker: ["FS", "VS", "MG", "HG", "AB", "AB2", "MF", "JS2", "TH1", "WH"],
  admins:    ["FRANK", "CHRISTIAN", "RONNY"],
  technikerInterval: { min: 60_000,  max: 180_000 },   // 1–3 Min
  adminInterval:     { min: 30_000,  max: 90_000  },   // 30 s – 1.5 Min
  raceInterval:      { min: 120_000, max: 300_000 },   // 2–5 Min (Race Tests)
  testPrefix: `STRESSTEST_${RUN_ID}`,
  logFile:    `stresstest-${RUN_ID}.log`,
  adminPass:  "admin123",
  techPass:   "techniker123",
} as const;

const TEILE = [
  "Displaymodul", "Tastatur", "Touchpad", "D Cover",
  "USB Board", "Lüfter", "Akku", "Lautsprecher", "Thermalmodul", "BIOS Batterie",
];

const GRADINGS = ["A+", "A+", "A+", "A", "A", "B", "C"];  // A+ gewichtet

const ADMIN_CHAT = [
  "Bitte Gerät bereitstellen",
  "Rückfrage zum Gerät",
  "Teil liegt zur Abholung bereit",
  "Bitte melden",
];

const TECH_CHAT = [
  "✅ Verstanden",
  "🏃 Hole es gleich ab",
  "📅 Kommt morgen",
  "❓ Habe eine Frage",
];

// ── Stats ────────────────────────────────────────────────────────────────────

interface Stats {
  anfrageErstellt:      number;
  anfrageerledigt:      number;
  anfrageStorniert:     number;
  anfrageInBearbeitung: number;
  buchungen:            number;
  chatNachrichten:      number;
  lockKonflikte:        number;
  lockGewonnen:         number;
  fehler:               number;
  aktionen:             number;
  responseZeiten:       number[];
  fehlerDetails:        { aktion: string; fehler: string; akteur: string }[];
  startZeit:            number;
}

const stats: Stats = {
  anfrageErstellt:      0,
  anfrageerledigt:      0,
  anfrageStorniert:     0,
  anfrageInBearbeitung: 0,
  buchungen:            0,
  chatNachrichten:      0,
  lockKonflikte:        0,
  lockGewonnen:         0,
  fehler:               0,
  aktionen:             0,
  responseZeiten:       [],
  fehlerDetails:        [],
  startZeit:            0,
};

// ── Logging ──────────────────────────────────────────────────────────────────

let logStream: fs.WriteStream;

type LogLevel = "INFO" | "OK" | "WARN" | "ERROR" | "RACE" | "REPORT";

const COLORS: Record<LogLevel, string> = {
  INFO:   "\x1b[36m",  // Cyan
  OK:     "\x1b[32m",  // Grün
  WARN:   "\x1b[33m",  // Gelb
  ERROR:  "\x1b[31m",  // Rot
  RACE:   "\x1b[35m",  // Magenta
  REPORT: "\x1b[34m",  // Blau
};
const RESET = "\x1b[0m";

function log(level: LogLevel, akteur: string, aktion: string, details?: Record<string, unknown>) {
  const now  = new Date();
  const time = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const det  = details ? " " + Object.entries(details).map(([k, v]) => `${k}=${v}`).join(" ") : "";
  const line = `[${time}] [${akteur}] ${aktion}${det}`;
  const colored = `${COLORS[level]}[${time}]${RESET} [${akteur.padEnd(12)}] ${aktion}${det}`;

  console.log(colored);
  if (logStream) logStream.write(line + "\n");
}

// ── Hilfsfunktionen ──────────────────────────────────────────────────────────

function warte(min: number, max: number): Promise<void> {
  return new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
}

function zufaellig<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function prozent(p: number): boolean {
  return Math.random() * 100 < p;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)]!;
}

async function messe<T>(fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  const res = await fn();
  stats.responseZeiten.push(Date.now() - start);
  return res;
}

// ── Test-Daten ───────────────────────────────────────────────────────────────

interface TestData {
  logIds:    { logId: string; bezeichnung: string }[];
  artikelIds: number[];
}

async function ladeTestDaten(): Promise<TestData> {
  // Bis zu 30 echte LogIDs aus GeraeteLookup laden
  const geraete = await prisma.geraeteLookup.findMany({
    take:    30,
    orderBy: { createdAt: "desc" },
    select:  { logId: true, bezeichnung: true },
  });

  const logIds = geraete.length > 0
    ? geraete
    : [
        { logId: `STRESS-${RUN_ID}-A`, bezeichnung: "Test-Gerät A" },
        { logId: `STRESS-${RUN_ID}-B`, bezeichnung: "Test-Gerät B" },
        { logId: `STRESS-${RUN_ID}-C`, bezeichnung: "Test-Gerät C" },
      ];

  // Bis zu 20 Artikel mit Bestand > 0
  const artikel = await prisma.artikel.findMany({
    where:   { bestand: { gt: 0 } },
    take:    20,
    orderBy: { updatedAt: "desc" },
    select:  { id: true },
  });

  const artikelIds = artikel.map((a) => a.id);

  log("INFO", "SETUP", `Test-Daten geladen`, {
    logIds:     logIds.length,
    artikel:    artikelIds.length,
  });

  return { logIds, artikelIds };
}

// ── User-Setup ───────────────────────────────────────────────────────────────

async function sicherstelleUser(kuerzel: string, rolle: UserRolle, pass: string) {
  const bestehend = await prisma.user.findUnique({ where: { kuerzel } });
  if (bestehend?.aktiv) return;

  const hash  = await bcrypt.hash(pass, 10);
  const email = `${kuerzel.toLowerCase()}@stress.test`;

  await prisma.user.upsert({
    where:  { kuerzel },
    update: { aktiv: true },
    create: {
      kuerzel,
      name:  `Stress-${kuerzel}`,
      email,
      password: hash,
      rolle,
      aktiv: true,
    },
  });

  log("INFO", "SETUP", `User angelegt`, { kuerzel, rolle });
}

// ── Hilfsfunktion: Test-Anfrage finden ────────────────────────────────────────

async function findeEigeneAnfrage(techniker: string, status: AnfrageStatus[]) {
  return prisma.anfrage.findFirst({
    where: {
      techniker: techniker.toUpperCase(),
      status:    { in: status },
      kommentar: { contains: "STRESSTEST" },
    },
    orderBy: { datum: "desc" },
  });
}

async function findeFreieAdminAnfrage(status: AnfrageStatus[]) {
  return prisma.anfrage.findFirst({
    where: {
      status:        { in: status },
      bearbeitetVon: null,
      kommentar:     { contains: "STRESSTEST" },
    },
    orderBy: { datum: "desc" },
  });
}

async function findeEigeneInBearbeitung(adminKuerzel: string) {
  return prisma.anfrage.findFirst({
    where: {
      status:        AnfrageStatus.IN_BEARBEITUNG,
      bearbeitetVon: adminKuerzel,
      kommentar:     { contains: "STRESSTEST" },
    },
    orderBy: { bearbeitetSeit: "desc" },
  });
}

// ── Techniker-Aktionen ───────────────────────────────────────────────────────

async function technikerErstelltAnfrage(kuerzel: string, daten: TestData) {
  const { logId, bezeichnung } = zufaellig(daten.logIds);
  const numItems = 2 + Math.floor(Math.random() * 3); // 2–4 Teile
  let korbId: number | null = null;

  for (let i = 0; i < numItems; i++) {
    const teiltyp   = zufaellig(TEILE);
    const grading   = zufaellig(GRADINGS);
    const artikelId = daten.artikelIds.length > 0 && prozent(70)
      ? zufaellig(daten.artikelIds)
      : null;

    const korb = await messe(() => addItem({
      techniker:   kuerzel,
      logId,
      geraeteName: bezeichnung,
      artikelId,
      teiltyp,
      grading,
      zusatzinfo:  i === 0 ? CONFIG.testPrefix : undefined,
    }));

    korbId = korb?.id ?? korbId;
  }

  if (!korbId) throw new Error("Warenkorb konnte nicht erstellt werden");

  const result = await messe(() => submit({
    korbId,
    zusatzinfo: CONFIG.testPrefix,
  }));

  stats.anfrageErstellt += result.anzahl;
  stats.aktionen++;
  log("OK", `TK:${kuerzel}`, "anfrage_erstellt", {
    logId,
    teile: result.anzahl,
    gruppenNr: result.gruppenNr,
  });
}

async function technikerStorniertAnfrage(kuerzel: string) {
  const anfrage = await findeEigeneAnfrage(kuerzel, [AnfrageStatus.NEU, AnfrageStatus.BEDARF]);
  if (!anfrage) {
    log("INFO", `TK:${kuerzel}`, "storno_skip", { grund: "keine_stornierbare_anfrage" });
    return;
  }

  await messe(() => storniereAnfrage({
    techniker: kuerzel,
    logId:     anfrage.logId,
    teil:      anfrage.teil,
  }));

  stats.anfrageStorniert++;
  stats.aktionen++;
  log("OK", `TK:${kuerzel}`, "anfrage_storniert", { anfrageId: anfrage.id });
}

async function technikerChatAntwort(kuerzel: string) {
  const anfrage = await findeEigeneAnfrage(kuerzel, [
    AnfrageStatus.NEU, AnfrageStatus.BEDARF, AnfrageStatus.IN_BEARBEITUNG,
  ]);
  if (!anfrage) return;

  const inhalt = zufaellig(TECH_CHAT);

  await messe(() => chatSenden({
    anfrageId:   anfrage.id,
    vonKuerzel:  kuerzel,
    empfKuerzel: "ADMIN",
    inhalt:      `${CONFIG.testPrefix} | ${inhalt}`,
  }));

  stats.chatNachrichten++;
  stats.aktionen++;
  log("OK", `TK:${kuerzel}`, "chat_gesendet", { anfrageId: anfrage.id });
}

async function technikerAktion(kuerzel: string, daten: TestData) {
  const r = Math.random() * 100;
  try {
    if (r < 70)       await technikerErstelltAnfrage(kuerzel, daten);
    else if (r < 85)  await technikerChatAntwort(kuerzel);
    else if (r < 95)  await technikerStorniertAnfrage(kuerzel);
    else {
      // Statistik anschauen
      const count = await prisma.anfrage.count({
        where: { techniker: kuerzel.toUpperCase() },
      });
      log("INFO", `TK:${kuerzel}`, "statistik_abgerufen", { anfragen: count });
      stats.aktionen++;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stats.fehler++;
    stats.fehlerDetails.push({ akteur: kuerzel, aktion: "techniker_aktion", fehler: msg });
    log("ERROR", `TK:${kuerzel}`, "fehler", { error: msg.slice(0, 120) });
  }
}

// ── Admin-Aktionen ────────────────────────────────────────────────────────────

async function adminNimmtInBearbeitung(kuerzel: string) {
  const anfrage = await findeFreieAdminAnfrage([AnfrageStatus.NEU, AnfrageStatus.BEDARF]);
  if (!anfrage) {
    log("INFO", `ADM:${kuerzel}`, "lock_skip", { grund: "keine_freie_anfrage" });
    return;
  }

  try {
    await messe(() => gruppeInBearbeitungNehmen([anfrage.id], kuerzel));
    stats.anfrageInBearbeitung++;
    stats.lockGewonnen++;
    stats.aktionen++;
    log("OK", `ADM:${kuerzel}`, "anfrage_übernommen", {
      anfrageId:  anfrage.id,
      techniker:  anfrage.techniker,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Bereits") || msg.includes("bearbeitet") || msg.includes("Bearbeitung")) {
      stats.lockKonflikte++;
      log("WARN", `ADM:${kuerzel}`, "lock_konflikt", { anfrageId: anfrage.id, msg: msg.slice(0, 80) });
    } else {
      throw err;
    }
  }
}

async function adminErledigt(kuerzel: string) {
  const anfrage = await findeEigeneInBearbeitung(kuerzel);
  if (!anfrage) {
    log("INFO", `ADM:${kuerzel}`, "erledigen_skip", { grund: "keine_eigene_in_bearbeitung" });
    return;
  }

  await messe(() => setzeStatus(anfrage.id, AnfrageStatus.ABGESCHLOSSEN));

  stats.anfrageerledigt++;
  stats.aktionen++;
  log("OK", `ADM:${kuerzel}`, "anfrage_erledigt", { anfrageId: anfrage.id, techniker: anfrage.techniker });
}

async function adminChatNachricht(kuerzel: string) {
  const anfrage = await prisma.anfrage.findFirst({
    where: {
      status:    { in: [AnfrageStatus.NEU, AnfrageStatus.BEDARF, AnfrageStatus.IN_BEARBEITUNG] },
      kommentar: { contains: "STRESSTEST" },
    },
    orderBy: { datum: "desc" },
  });
  if (!anfrage) return;

  const inhalt = zufaellig(ADMIN_CHAT);

  await messe(() => chatSenden({
    anfrageId:   anfrage.id,
    vonKuerzel:  kuerzel,
    empfKuerzel: anfrage.techniker,
    inhalt:      `${CONFIG.testPrefix} | ${inhalt}`,
  }));

  stats.chatNachrichten++;
  stats.aktionen++;
  log("OK", `ADM:${kuerzel}`, "chat_gesendet", { anfrageId: anfrage.id, to: anfrage.techniker });
}

async function adminBucht(kuerzel: string) {
  // Zufälligen Artikel mit Bestand > 0
  const artikel = await prisma.artikel.findFirst({
    where:   { bestand: { gt: 0 } },
    orderBy: { updatedAt: "desc" },
    select:  { id: true, bezeichnung: true },
  });
  if (!artikel) return;

  const menge = 1 + Math.floor(Math.random() * 3);
  const typ   = prozent(60) ? BuchungsTyp.EINGANG : BuchungsTyp.AUSGANG;

  await messe(() => bucheLager({
    artikelId:   artikel.id,
    menge:       typ === BuchungsTyp.AUSGANG ? 1 : menge,
    typ,
    mitarbeiter: kuerzel,
    notiz:       `${CONFIG.testPrefix}`,
  }));

  stats.buchungen++;
  stats.aktionen++;
  log("OK", `ADM:${kuerzel}`, "buchung_erstellt", {
    artikelId: artikel.id,
    typ,
    menge: typ === BuchungsTyp.AUSGANG ? 1 : menge,
  });
}

async function adminAktion(kuerzel: string) {
  const r = Math.random() * 100;
  try {
    if (r < 40)       await adminNimmtInBearbeitung(kuerzel);
    else if (r < 70)  await adminErledigt(kuerzel);
    else if (r < 85)  await adminChatNachricht(kuerzel);
    else if (r < 95)  await adminBucht(kuerzel);
    else {
      const count = await prisma.anfrage.count({
        where: { status: AnfrageStatus.IN_BEARBEITUNG },
      });
      log("INFO", `ADM:${kuerzel}`, "statistik_abgerufen", { in_bearbeitung: count });
      stats.aktionen++;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stats.fehler++;
    stats.fehlerDetails.push({ akteur: kuerzel, aktion: "admin_aktion", fehler: msg });
    log("ERROR", `ADM:${kuerzel}`, "fehler", { error: msg.slice(0, 120) });
  }
}

// ── Race Condition Test ──────────────────────────────────────────────────────

async function raceConditionTest(adminA: string, adminB: string) {
  const anfrage = await prisma.anfrage.findFirst({
    where: {
      status:        { in: [AnfrageStatus.NEU, AnfrageStatus.BEDARF] },
      bearbeitetVon: null,
      kommentar:     { contains: "STRESSTEST" },
    },
    orderBy: { datum: "asc" },
  });

  if (!anfrage) {
    log("RACE", "RACE_TEST", "skip", { grund: "keine_geeignete_anfrage" });
    return;
  }

  log("RACE", "RACE_TEST", "start", {
    anfrageId: anfrage.id,
    adminA,
    adminB,
    hinweis: "beide_versuchen_gleichzeitig",
  });

  const [resultA, resultB] = await Promise.allSettled([
    gruppeInBearbeitungNehmen([anfrage.id], adminA),
    gruppeInBearbeitungNehmen([anfrage.id], adminB),
  ]);

  const erfolge   = [resultA, resultB].filter((r) => r.status === "fulfilled").length;
  const konflikte = [resultA, resultB].filter((r) => r.status === "rejected").length;

  stats.lockGewonnen  += erfolge;
  stats.lockKonflikte += konflikte;

  const gewinner = resultA.status === "fulfilled" ? adminA : adminB;
  const verlierer = resultA.status === "fulfilled" ? adminB : adminA;

  log("RACE", "RACE_TEST", konflikte === 1 ? "KORREKT" : "FEHLER!", {
    anfrageId: anfrage.id,
    gewinner,
    verlierer: `${verlierer}=CONFLICT`,
    bewertet:  konflikte === 1 ? "Lock-System_OK" : "RACE_CONDITION_PROBLEM!",
  });

  // Freigeben für weiteren Test
  if (erfolge > 0) {
    await gruppeZurueckgeben([anfrage.id], gewinner).catch(() => {});
  }
}

// ── Agent-Schleifen ──────────────────────────────────────────────────────────

async function technikerAgent(kuerzel: string, daten: TestData, isDone: () => boolean) {
  log("INFO", `TK:${kuerzel}`, "gestartet");

  while (!isDone()) {
    await warte(CONFIG.technikerInterval.min, CONFIG.technikerInterval.max);
    if (isDone()) break;
    await technikerAktion(kuerzel, daten);
  }

  log("INFO", `TK:${kuerzel}`, "beendet");
}

async function adminAgent(kuerzel: string, isDone: () => boolean) {
  log("INFO", `ADM:${kuerzel}`, "gestartet");

  // Admins starten etwas später damit Techniker zuerst Anfragen erstellen
  await warte(15_000, 30_000);

  while (!isDone()) {
    await warte(CONFIG.adminInterval.min, CONFIG.adminInterval.max);
    if (isDone()) break;
    await adminAktion(kuerzel);
  }

  log("INFO", `ADM:${kuerzel}`, "beendet");
}

async function raceConditionAgent(admins: string[], isDone: () => boolean) {
  await warte(60_000, 90_000); // Erst nach 1 Min starten

  while (!isDone()) {
    await warte(CONFIG.raceInterval.min, CONFIG.raceInterval.max);
    if (isDone()) break;
    if (admins.length >= 2) {
      await raceConditionTest(admins[0]!, admins[1]!);
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────────────

function druckeReport() {
  const laufzeit = Math.round((Date.now() - stats.startZeit) / 1000);
  const minuten  = Math.floor(laufzeit / 60);
  const sekunden = laufzeit % 60;

  const avg    = stats.responseZeiten.length > 0
    ? Math.round(stats.responseZeiten.reduce((s, n) => s + n, 0) / stats.responseZeiten.length)
    : 0;
  const max    = stats.responseZeiten.length > 0 ? Math.max(...stats.responseZeiten) : 0;
  const p95    = percentile(stats.responseZeiten, 95);
  const p99    = percentile(stats.responseZeiten, 99);
  const qps    = laufzeit > 0 ? (stats.aktionen / laufzeit).toFixed(1) : "0";

  // Fehler-Aggregation
  const fehlerMap = new Map<string, { count: number; beispiel: string }>();
  for (const f of stats.fehlerDetails) {
    const key = f.fehler.slice(0, 60);
    const ex  = fehlerMap.get(key);
    if (ex) ex.count++;
    else fehlerMap.set(key, { count: 1, beispiel: f.akteur });
  }

  const border = "╠══════════════════════════════════════════╣";
  const line   = (label: string, value: string | number) => {
    const l = `║  ${label}:`;
    const v = String(value);
    const pad = 42 - l.length - v.length;
    return `${l}${" ".repeat(Math.max(1, pad))}${v}  ║`;
  };

  const report = [
    "",
    "╔══════════════════════════════════════════╗",
    "║         STRESS-TEST BERICHT              ║",
    border,
    line("Laufzeit",       `${minuten}:${String(sekunden).padStart(2, "0")} Min`),
    line("Techniker aktiv", CONFIG.techniker.length),
    line("Admins aktiv",    CONFIG.admins.length),
    border,
    "║  AKTIONEN:                               ║",
    line("  Anfragen erstellt",        stats.anfrageErstellt),
    line("  Anfragen erledigt",        stats.anfrageerledigt),
    line("  Anfragen storniert",       stats.anfrageStorniert),
    line("  In Bearbeitung genommen",  stats.anfrageInBearbeitung),
    line("  Buchungen",                stats.buchungen),
    line("  Chat-Nachrichten",         stats.chatNachrichten),
    line("  Gesamt-Aktionen",          stats.aktionen),
    line("  Aktionen/Sek",             qps),
    border,
    "║  LOCK-SYSTEM:                            ║",
    line("  Locks gewonnen",   stats.lockGewonnen),
    line("  Lock-Konflikte",   stats.lockKonflikte),
    line("  Race-Ergebnis",    stats.lockKonflikte > 0
      ? "OK — Konflikte korrekt behandelt"
      : "Keine Race Cond. provoziert"),
    border,
    "║  PERFORMANCE:                            ║",
    line("  Ø Response Zeit",   `${avg} ms`),
    line("  Max Response Zeit", `${max} ms`),
    line("  P95",               `${p95} ms`),
    line("  P99",               `${p99} ms`),
    border,
    "║  FEHLER:                                 ║",
    line("  Gesamt", stats.fehler),
    ...Array.from(fehlerMap.entries()).slice(0, 5).map(([msg, { count, beispiel }]) =>
      `║    ×${count} [${beispiel}]: ${msg.slice(0, 30).padEnd(30)}  ║`
    ),
    border,
    "║  EMPFEHLUNG:                             ║",
    ...(stats.fehler === 0 && avg < 500 && max < 2000
      ? ["║  ✅ System ist produktionsreif            ║"]
      : [
          ...(stats.fehler > 0 ? ["║  ⚠️  Fehler aufgetreten — Log prüfen      ║"] : []),
          ...(avg > 500       ? ["║  ⚠️  Hohe Antwortzeiten — DB-Indexes prüf  ║"] : []),
          ...(max > 2000      ? ["║  ⚠️  Timeouts aufgetreten                  ║"] : []),
        ]
    ),
    "╚══════════════════════════════════════════╝",
    "",
    `📄 Detailliertes Log: ${CONFIG.logFile}`,
    "",
  ].join("\n");

  console.log(`${COLORS.REPORT}${report}${RESET}`);
  if (logStream) logStream.write("\n" + report + "\n");
}

// ── Cleanup Angebot ──────────────────────────────────────────────────────────

async function bietCleanup() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise<void>((resolve) => {
    rl.question(
      `\nSollen Test-Daten (Prefix: ${CONFIG.testPrefix}) gelöscht werden? [j/N] `,
      async (antwort) => {
        rl.close();
        if (antwort.trim().toLowerCase() === "j") {
          console.log("🗑️  Lösche Test-Daten...");
          await loescheTestDaten();
          console.log("✅ Test-Daten gelöscht.");
        } else {
          console.log(`ℹ️  Test-Daten bleiben erhalten. Cleanup: npm run stresstest:cleanup`);
        }
        resolve();
      },
    );
  });
}

async function loescheTestDaten() {
  // 1. Test-Anfragen finden
  const testAnfragen = await prisma.anfrage.findMany({
    where:  { kommentar: { contains: "STRESSTEST" } },
    select: { id: true },
  });
  const ids = testAnfragen.map((a) => a.id);

  if (ids.length === 0) {
    console.log("  Keine Test-Anfragen gefunden.");
    return;
  }

  // 2. Chat-Nachrichten (Nachricht-Tabelle mit chat:-prefix)
  const chatLogIds = ids.map((id) => `chat:${id}`);
  const nachrichtenGeloescht = await prisma.$transaction(async (tx) => {
    const nachrichten = await tx.nachricht.findMany({
      where:  { logId: { in: chatLogIds } },
      select: { id: true },
    });
    const nachrichtIds = nachrichten.map((n) => n.id);
    if (nachrichtIds.length > 0) {
      await tx.nachrichtEmpf.deleteMany({ where: { nachrichtId: { in: nachrichtIds } } });
      await tx.nachrichtAntwort.deleteMany({ where: { nachrichtId: { in: nachrichtIds } } });
      await tx.nachricht.deleteMany({ where: { id: { in: nachrichtIds } } });
    }
    return nachrichtIds.length;
  });

  // 3. Buchungen mit STRESSTEST-Notiz
  const buchungenGeloescht = await prisma.buchung.deleteMany({
    where: { notiz: { contains: "STRESSTEST" } },
  });

  // 4. Anfragen löschen
  const anfragenGeloescht = await prisma.anfrage.deleteMany({
    where: { id: { in: ids } },
  });

  console.log(`  ✓ ${anfragenGeloescht.count} Anfragen gelöscht`);
  console.log(`  ✓ ${nachrichtenGeloescht} Chat-Nachrichten gelöscht`);
  console.log(`  ✓ ${buchungenGeloescht.count} Buchungen gelöscht`);
}

// ── Prompt / Warnung ──────────────────────────────────────────────────────────

async function warnung(): Promise<boolean> {
  const durationMin = Math.round(CONFIG.duration / 60_000);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    console.log(`
${COLORS.WARN}╔════════════════════════════════════════════╗
║         ⚠️  STRESS-TEST WARNUNG             ║
╠════════════════════════════════════════════╣
║                                            ║
║  Dieses Script startet einen ${String(durationMin).padEnd(3)}-Minuten  ║
║  Stress-Test der ECHTE DATEN in der DB     ║
║  erzeugt!                                  ║
║                                            ║
║  Markierung: STRESSTEST_${RUN_ID}        ║
║  Log-Datei:  ${CONFIG.logFile}     ║
║                                            ║
║  Techniker: ${CONFIG.techniker.length} aktiv                      ║
║  Admins:    ${CONFIG.admins.length} aktiv                         ║
║                                            ║
╚════════════════════════════════════════════╝${RESET}
`);
    rl.question("Stress-Test starten? [j/N] ", (antwort) => {
      rl.close();
      resolve(antwort.trim().toLowerCase() === "j");
    });
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Warnung + Bestätigung
  const bestaetigt = await warnung();
  if (!bestaetigt) {
    console.log("Abgebrochen.");
    process.exit(0);
  }

  // 2. Log-Datei öffnen
  logStream = fs.createWriteStream(CONFIG.logFile, { flags: "a" });
  log("INFO", "MAIN", "stresstest_gestartet", {
    duration_min: Math.round(CONFIG.duration / 60_000),
    runId: RUN_ID,
  });

  // 3. Test-User sicherstellen
  console.log("\n🔧 Prüfe/erstelle Test-User...");
  for (const kuerzel of CONFIG.techniker) {
    await sicherstelleUser(kuerzel, UserRolle.TECHNIKER, CONFIG.techPass);
  }
  for (const kuerzel of CONFIG.admins) {
    await sicherstelleUser(kuerzel, UserRolle.ADMIN, CONFIG.adminPass);
  }

  // 4. Test-Daten laden
  console.log("📦 Lade Test-Daten...");
  const testDaten = await ladeTestDaten();

  if (testDaten.artikelIds.length === 0) {
    console.warn("⚠️  Keine Artikel mit Bestand > 0 gefunden. Anfragen werden mit artikelId=null erstellt.");
  }

  // 5. Stop-Signal vorbereiten
  let gestoppt = false;
  const isDone = () => gestoppt;

  stats.startZeit = Date.now();

  setTimeout(() => {
    gestoppt = true;
    log("INFO", "MAIN", "stop_signal_gesetzt", {
      laufzeit_ms: Date.now() - stats.startZeit,
    });
  }, CONFIG.duration);

  console.log(`\n🚀 Stress-Test läuft ${Math.round(CONFIG.duration / 60_000)} Minuten...\n`);

  // 6. Alle Agenten starten
  const agenten: Promise<void>[] = [
    // 10 Techniker
    ...CONFIG.techniker.map((k) => technikerAgent(k, testDaten, isDone)),
    // 3 Admins
    ...CONFIG.admins.map((k) => adminAgent(k, isDone)),
    // Race-Condition Provokateur
    raceConditionAgent([...CONFIG.admins], isDone),
  ];

  // 7. Warte auf alle
  await Promise.allSettled(agenten);

  // 8. Kurz warten damit letzte Logs geschrieben werden
  await warte(500, 500);

  // 9. Report
  druckeReport();

  // 10. Cleanup anbieten
  await bietCleanup();

  // 11. Aufräumen
  logStream.end();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Kritischer Fehler:", err);
  process.exit(1);
});

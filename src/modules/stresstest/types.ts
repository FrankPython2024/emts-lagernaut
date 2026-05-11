/**
 * Stresstest-Typen + Konstanten — import-safe für Client und Server.
 * Keine Node.js-Only-Dependencies hier!
 */

export type LoadMode = "normal" | "heavy" | "burst" | "extreme";

export const LOAD_MODES: Record<LoadMode, {
  label:             string;
  icon:              string;
  beschreibung:      string;
  technikerInterval: { min: number; max: number };
  adminInterval:     { min: number; max: number };
}> = {
  normal:  { label: "Normal",     icon: "⚪", beschreibung: "1–3 Min zwischen Aktionen",   technikerInterval: { min: 60_000, max: 180_000 }, adminInterval: { min: 30_000, max: 90_000  } },
  heavy:   { label: "Heavy Load", icon: "🔶", beschreibung: "15s–1 Min zwischen Aktionen",  technikerInterval: { min: 30_000, max: 60_000  }, adminInterval: { min: 15_000, max: 30_000  } },
  burst:   { label: "Burst Mode", icon: "🔥", beschreibung: "5–30s zwischen Aktionen",      technikerInterval: { min: 10_000, max: 30_000  }, adminInterval: { min: 5_000,  max: 15_000  } },
  extreme: { label: "Extreme",    icon: "💀", beschreibung: "2–10s zwischen Aktionen",      technikerInterval: { min: 3_000,  max: 10_000  }, adminInterval: { min: 2_000,  max: 5_000   } },
};

export type ErrorKategorie = "race" | "validation" | "duplicate" | "stale" | "api" | "bug";

export interface TestEvent {
  ts:      number;
  actor:   string;
  action:  string;
  dauer:   number;
  success: boolean;
  error?:  string;
}

export interface MetricUpdate {
  elapsed:          number;
  opsPerSecond:     number;
  totalOps:         number;
  totalErrors:      number;
  errorRate:        number;
  avgResponseTime:  number;
  peakResponseTime: number;
  workerActivity:   Record<string, number>;
  memMB:            number;
  socketClients:    number;
}

export interface FinalResult {
  runId:            string;
  duration:         number;
  totalOps:         number;
  anfrageErstellt:  number;
  anfrageErledigt:  number;
  anfrageStorniert: number;
  buchungen:        number;
  chat:             number;
  lockKonflikte:    number;
  avgResponseTime:  number;
  peakResponseTime: number;
  p95:              number;
  fehler:           number;
  score:            number;
}

export interface ErrorDetail {
  ts:         number;
  actor:      string;
  action:     string;
  errorName:  string;
  message:    string;
  stack?:     string;
  kategorie:  ErrorKategorie;
  empfehlung: string;
}

export interface TestConfig {
  duration:     number;
  numTechniker: number;
  numAdmins:    number;
  loadMode:     LoadMode;
}

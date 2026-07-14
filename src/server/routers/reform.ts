import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";

// ── ReForm-Sync: Button + Status auf /admin/mobil ────────────────────────────
// Die App kann den Playwright-Export NICHT direkt starten (kein Chromium im
// App-Container). Brücke: die App schreibt eine TRIGGER-Datei in einen gemeinsamen
// Ordner ($REFORM_DIR, per Volume gemountet); ein Host-Wächter (reform-watch.sh)
// startet daraufhin reform-sync.sh, das bei jeder Etappe status.json (atomar)
// schreibt. Diese Datei lesen wir hier für den Fortschrittsbalken.
//
// Lesen: MOBIL_VIEW · Anstoßen: MOBIL_MANAGE.

const DIR     = process.env.REFORM_DIR || "/data/reform";
const STATUS  = path.join(DIR, "status.json");
const TRIGGER = path.join(DIR, "trigger");
const SESSION_REQ    = path.join(DIR, "session-req.json");
const SESSION_STATUS = path.join(DIR, "session-status.json");
const SESSION_CLOSE  = path.join(DIR, "session-close");
const QUEUE_DIR      = path.join(DIR, "queue");
const STALE_MS      = 5 * 60 * 1000; // laufender Sync gilt nach 5 Min als hängengeblieben
const SESSION_STALE_MS = 30 * 1000;  // Session ohne Heartbeat >30s → gilt als beendet/tot

const view   = permissionProcedure("MOBIL_VIEW");
const manage = permissionProcedure("MOBIL_MANAGE");

type SyncState = "leer" | "angefordert" | "export" | "import" | "fertig" | "fehler";
type Status = {
  state:     SyncState;
  phase:     string;
  quelle?:   "manuell" | "cron";
  startedAt?: number;
  endedAt?:   number | null;
  bericht?:   Record<string, unknown> | null;
  fehler?:    string | null;
};

const LAEUFT: SyncState[] = ["angefordert", "export", "import"];

function leseStatus(): Status {
  try {
    return JSON.parse(fs.readFileSync(STATUS, "utf8")) as Status;
  } catch {
    return { state: "leer", phase: "Noch kein Sync gelaufen." };
  }
}
function istAktiv(s: Status): boolean {
  return LAEUFT.includes(s.state) && !!s.startedAt && Date.now() - s.startedAt < STALE_MS;
}
function schreibeStatus(s: Status): void {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = `${STATUS}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s));
  fs.renameSync(tmp, STATUS);
}

// ── Buch-Session (Colli offen halten, wiederholt LogIDs draufbuchen) ──────────
type GebuchtItem = { logId: string; ok: boolean; fehler?: string; dry?: boolean; ts: number };
type SessionStatus = {
  state:     "leer" | "start" | "bereit" | "buchen" | "beendet" | "fehler";
  phase:     string;
  colli?:    string; dryRun?: boolean;
  startedAt?: number; lastActivity?: number; endedAt?: number | null; fehler?: string | null;
  gebucht?:  GebuchtItem[];
};
const SESSION_LAEUFT: SessionStatus["state"][] = ["start", "bereit", "buchen"];
function leseSession(): SessionStatus {
  try { return JSON.parse(fs.readFileSync(SESSION_STATUS, "utf8")) as SessionStatus; }
  catch { return { state: "leer", phase: "Keine Session." }; }
}
// „offen" = läuft UND kürzlich Heartbeat geschrieben (Container lebt noch).
function sessionOffen(s: SessionStatus): boolean {
  return SESSION_LAEUFT.includes(s.state) && !!s.lastActivity && Date.now() - s.lastActivity < SESSION_STALE_MS;
}

export const reformRouter = createTRPCRouter({
  // Aktuellen Sync-Status lesen (für Polling / Fortschrittsbalken).
  syncStatus: view.query(() => {
    const s = leseStatus();
    const aktiv = istAktiv(s);
    return {
      ...s,
      aktiv,
      // hängengeblieben: Zustand "läuft", aber älter als STALE_MS → als Fehler behandelbar.
      haengt: LAEUFT.includes(s.state) && !aktiv,
    };
  }),

  // Sync anstoßen: Trigger-Datei schreiben (der Host-Wächter übernimmt).
  syncStarten: manage.mutation(() => {
    const s = leseStatus();
    if (istAktiv(s)) return { gestartet: false as const, grund: "Ein Sync läuft bereits." };
    try {
      schreibeStatus({
        state: "angefordert", phase: "Angefordert — startet gleich…",
        quelle: "manuell", startedAt: Date.now(), endedAt: null, bericht: null, fehler: null,
      });
      fs.writeFileSync(TRIGGER, String(Date.now()));
    } catch {
      return { gestartet: false as const, grund: "Trigger nicht schreibbar — läuft der Host-Wächter / ist das Volume gemountet?" };
    }
    return { gestartet: true as const };
  }),

  // ── Session-Status (Polling / Live-Liste) ───────────────────────────────────
  sessionStatus: view.query(() => {
    const s = leseSession();
    const offen = sessionOffen(s);
    return { ...s, offen, bereit: offen && (s.state === "bereit" || s.state === "buchen") };
  }),

  // Colli-Session starten (öffnet den Colli, danach LogIDs scannen).
  sessionStarten: manage
    .input(z.object({ colli: z.string().trim().min(1).max(50), dryRun: z.boolean().default(true) }))
    .mutation(({ input }) => {
      if (sessionOffen(leseSession())) return { gestartet: false as const, grund: "Es läuft bereits eine Session." };
      try {
        const startedAt = Date.now();
        const status: SessionStatus = {
          state: "start", phase: "Öffne Colli…", colli: input.colli, dryRun: input.dryRun,
          startedAt, lastActivity: startedAt, endedAt: null, fehler: null, gebucht: [],
        };
        fs.mkdirSync(DIR, { recursive: true });
        try { fs.rmSync(SESSION_CLOSE, { force: true }); } catch { /* egal */ }
        fs.writeFileSync(`${SESSION_STATUS}.tmp`, JSON.stringify(status));
        fs.renameSync(`${SESSION_STATUS}.tmp`, SESSION_STATUS);
        fs.writeFileSync(SESSION_REQ, JSON.stringify({ colli: input.colli, dryRun: input.dryRun, ts: startedAt }));
      } catch {
        return { gestartet: false as const, grund: "Nicht schreibbar — Volume/Wächter prüfen." };
      }
      return { gestartet: true as const };
    }),

  // LogID in die Warteschlange der offenen Session legen (wird sofort gebucht).
  sessionLogId: manage
    .input(z.object({ logId: z.string().trim().min(1).max(50) }))
    .mutation(({ input }) => {
      const s = leseSession();
      if (!sessionOffen(s) || !(s.state === "bereit" || s.state === "buchen")) {
        return { ok: false as const, grund: "Keine offene Colli-Session." };
      }
      try {
        fs.mkdirSync(QUEUE_DIR, { recursive: true });
        const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const tmp = path.join(QUEUE_DIR, `${name}.tmp`);
        fs.writeFileSync(tmp, JSON.stringify({ logId: input.logId, ts: Date.now() }));
        fs.renameSync(tmp, path.join(QUEUE_DIR, `${name}.json`));
      } catch {
        return { ok: false as const, grund: "LogID nicht schreibbar." };
      }
      return { ok: true as const };
    }),

  // Session beenden (Signal-Datei → der Container schließt den Browser).
  sessionBeenden: manage.mutation(() => {
    try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(SESSION_CLOSE, String(Date.now())); }
    catch { return { ok: false as const }; }
    return { ok: true as const };
  }),
});

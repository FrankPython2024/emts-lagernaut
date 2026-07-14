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
const STALE_MS = 5 * 60 * 1000; // laufender Sync gilt nach 5 Min als hängengeblieben

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
});

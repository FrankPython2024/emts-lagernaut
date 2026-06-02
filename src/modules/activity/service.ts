import { emitToAdmins } from "@/modules/realtime/socket";
import { EVENTS } from "@/modules/realtime/events";

/**
 * Zentrale Activity-Log-Einreihung.
 *
 * Hinweis: Dieser Stack hat KEINE persistente Activity-Log-Tabelle — das
 * Dashboard-„Letzte Aktivitäten"-Widget leitet seinen Feed aus Buchungen +
 * Anfragen ab. Für Aktionen ohne eigene Buchungs-/Anfrage-Zeile (z.B. externe
 * Bestellungen) protokollieren wir daher:
 *   1. live via Socket (ACTIVITY_NEU → Admins), und
 *   2. dauerhaft im Server-Log.
 *
 * TODO: Persistente `Aktivitaet`-Tabelle einführen, dann hier zusätzlich
 *       schreiben — die Aufrufstellen bleiben unverändert.
 */
export function protokolliereAktivitaet(opts: { text: string; akteur: string }): void {
  const datum = new Date();
  emitToAdmins(EVENTS.ACTIVITY_NEU, { text: opts.text, akteur: opts.akteur, datum });
  process.stdout.write(`[Activity] ${datum.toISOString()} · ${opts.akteur}: ${opts.text}\n`);
}

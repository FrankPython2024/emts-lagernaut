// ── Halbautomatischer Druck (01.10.2026) ──────────────────────────────────────
//
// Wunsch Frank: „Anfrage für Fuß XXX → Bestand prüfen → wenn nicht: Platte leer und
// Datei vorhanden → Druck automatisch starten." Entscheidungen Frank (01.10.2026):
//   • ganz automatisch (kein Bestätigungs-Tipp) — die menschliche Sicherung bleibt
//     der Knopf „Platte ist leer"; ohne ihn startet nichts,
//   • Start JEDERZEIT — die Sperre Mo–Fr 6–16 Uhr und an freien Tagen wurde am
//     09.10.2026 auf Wunsch Frank aufgehoben (Füße-Nachfrage im Oktober mehr als
//     doppelt so hoch wie im September; ein 7400-Druck dauert 2 h 40 min). Die
//     menschliche Sicherung bleibt allein „Platte ist leer",
//   • passt die Spule nicht zum Material der Vorlage: warten mit Hinweis.
// Gemessen am selben Tag: von 23 Füße-Anfragen „nicht verfügbar" in 90 Tagen hatten
// 12 inzwischen eine Vorlage mit Druckdatei (vor allem ProBook x360 435 G8).
//
// Reine Logik — Test: `npm run test:druck`. Datenbank: src/modules/druck/autoDruck.ts.

import { materialPasst } from "./warteschlange";

/** So lange deckt ein gestarteter, noch nicht eingebuchter Druck neue Anfragen mit ab. */
export const AUTO_DECKT_MS = 24 * 3600_000;

/**
 * Warum darf ein automatischer Auftrag JETZT nicht starten? null = er darf.
 * Keine Zeitsperre mehr (09.10.2026) — `jetzt` bleibt im Aufruf, damit eine
 * künftige Regel ohne Umbau der Aufrufer wieder hineinpasst.
 */
export function autoStartGrund(l: {
  jetzt: Date; vorlageMaterial: string | null | undefined; spule: string | null | undefined;
}): string | null {
  if (materialPasst(l.vorlageMaterial, l.spule) === false) {
    return `Spule passt nicht: ${String(l.vorlageMaterial).trim()} nötig, eingelegt ist ${String(l.spule).trim()}`;
  }
  return null;
}

/**
 * Nachdruck nach dem Einbuchen (Frank, 01.10.2026): Reicht der Bestand jetzt für
 * alle offenen Anfragen dieser Vorlage? Liefert die Teiltypen, bei denen noch etwas
 * fehlt (offene Stück > Bestand). Leer = nichts nachzudrucken.
 * Anlass: Mehr Anfragen als eine Platte Füße bringt (6 Anfragen, 5 je Platte) —
 * die übrigen Anfragen lösten keinen zweiten Druck mehr aus.
 */
export function nachdruckFehlt(je: readonly { teiltyp: string; offenStueck: number; bestand: number }[]): string[] {
  return je.filter((z) => z.offenStueck > z.bestand).map((z) => z.teiltyp);
}

/**
 * Braucht es für diese Vorlage einen neuen automatischen Auftrag? Nein, wenn schon
 * einer wartet oder unterwegs ist, oder ein Druck läuft/fertig ist und noch nicht
 * eingebucht wurde — eine Platte bringt mehrere Stück, zwei Anfragen = ein Druck.
 */
export function brauchtNeuenAuftrag(
  auftraege: readonly { status: string; erledigtAm: Date | null; gestartetAm: Date | null }[],
  jetzt: Date,
): boolean {
  return !auftraege.some((a) =>
    a.status === "WARTET" || a.status === "ABGEHOLT"
    || (a.status === "GESTARTET" && !a.erledigtAm && !!a.gestartetAm && jetzt.getTime() - a.gestartetAm.getTime() < AUTO_DECKT_MS));
}

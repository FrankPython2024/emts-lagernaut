// ── Halbautomatischer Druck (01.10.2026) ──────────────────────────────────────
//
// Wunsch Frank: „Anfrage für Fuß XXX → Bestand prüfen → wenn nicht: Platte leer und
// Datei vorhanden → Druck automatisch starten." Entscheidungen Frank (01.10.2026):
//   • ganz automatisch (kein Bestätigungs-Tipp) — die menschliche Sicherung bleibt
//     der Knopf „Platte ist leer"; ohne ihn startet nichts,
//   • Start nur Mo–Fr 6–16 Uhr (deutsche Zeit), nicht an Feiertagen/Betriebsruhe,
//   • passt die Spule nicht zum Material der Vorlage: warten mit Hinweis.
// Gemessen am selben Tag: von 23 Füße-Anfragen „nicht verfügbar" in 90 Tagen hatten
// 12 inzwischen eine Vorlage mit Druckdatei (vor allem ProBook x360 435 G8).
//
// Reine Logik — Test: `npm run test:druck`. Datenbank: src/modules/druck/autoDruck.ts.

import { berlinStunde, berlinTag, berlinWochentag } from "@/lib/zeit/berlin";
import { feiertag } from "@/lib/urlaub/tage";
import { materialPasst } from "./warteschlange";

export const AUTO_VON_STUNDE = 6;
export const AUTO_BIS_STUNDE = 16;   // Start bis 15:59
/** So lange deckt ein gestarteter, noch nicht eingebuchter Druck neue Anfragen mit ab. */
export const AUTO_DECKT_MS = 24 * 3600_000;

/** Warum darf ein automatischer Auftrag JETZT nicht starten? null = er darf. */
export function autoStartGrund(l: {
  jetzt: Date; vorlageMaterial: string | null | undefined; spule: string | null | undefined;
}): string | null {
  const tag = berlinTag(l.jetzt);
  const wt = berlinWochentag(l.jetzt);
  const h = berlinStunde(l.jetzt);
  const frei = feiertag(tag);
  if (frei) return `automatischer Druck startet nicht an freien Tagen (${frei})`;
  if (wt === 0 || wt === 6 || h < AUTO_VON_STUNDE || h >= AUTO_BIS_STUNDE) {
    return `automatischer Druck nur Mo–Fr ${AUTO_VON_STUNDE}–${AUTO_BIS_STUNDE} Uhr`;
  }
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

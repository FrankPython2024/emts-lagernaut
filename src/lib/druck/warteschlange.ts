// ── Druckaufträge über den Server: wann darf gestartet werden? ──────────────
//
// Die Druckbrücke am Laptop meldet alle 5 s den Druckerstand und bekommt dabei
// höchstens EINEN wartenden Auftrag mit. Vorher muss alles hier stimmen.
// ⚠️ Wer an einem anderen PC auf „Drucken" tippt, sieht die Druckplatte nicht.
// Deshalb „nur per Knopf" (Frank, 24.09.2026): Frei ist die Platte erst, wenn
// jemand am Drucker „Platte ist leer" drückt; jeder Druck belegt sie wieder —
// auch einer, der am Drucker selbst oder aus Bambu Studio gestartet wurde.
//
// Reine Logik, Test: `npm run test:druck`.

/** Ohne Meldung seit so vielen ms gilt die Brücke als aus. */
export const BRUECKE_STILL_MS = 30_000;
/** So lange darf ein abgeholter Auftrag ohne Ergebnis bleiben, dann gilt er als gescheitert. */
export const ABGEHOLT_MAX_MS = 5 * 60_000;

/** In diesen Zuständen nimmt der Drucker einen neuen Druck an (wie STARTBEREIT in der Brücke). */
export const STARTBEREIT = ["IDLE", "FINISH", "FAILED"];
/** In diesen Zuständen wird gerade gedruckt → Platte ist belegt. */
export const DRUCKT = ["PREPARE", "SLICING", "RUNNING", "PAUSE"];

export type Startlage = {
  gemeldetAm: Date | null;
  verbindung: string | null;
  zustand:    string | null;
  platteFrei: boolean;
  jetzt:      Date;
};

export type Startentscheid = { ok: true } | { ok: false; grund: string };

export function darfStarten(l: Startlage): Startentscheid {
  if (!l.gemeldetAm || l.jetzt.getTime() - l.gemeldetAm.getTime() > BRUECKE_STILL_MS) {
    return { ok: false, grund: "Druckbrücke am Laptop ist aus" };
  }
  if (l.verbindung !== "verbunden") return { ok: false, grund: "Brücke hat keine Verbindung zum Drucker" };
  if (!l.zustand || !STARTBEREIT.includes(l.zustand)) {
    return { ok: false, grund: DRUCKT.includes(l.zustand ?? "") ? "Drucker druckt gerade" : "Drucker ist nicht bereit" };
  }
  if (!l.platteFrei) return { ok: false, grund: "Platte noch belegt — am Drucker „Platte ist leer“ drücken" };
  return { ok: true };
}

/** Nach einem Bericht: Wird gedruckt, ist die Platte belegt. Frei macht sie nur der Knopf. */
export function platteNachBericht(platteFrei: boolean, zustand: string | null): boolean {
  return zustand && DRUCKT.includes(zustand) ? false : platteFrei;
}

/** Hängt ein abgeholter Auftrag? (Brücke abgestürzt, Laptop zugeklappt …) */
export function haengt(abgeholtAm: Date | null, jetzt: Date): boolean {
  return !!abgeholtAm && jetzt.getTime() - abgeholtAm.getTime() > ABGEHOLT_MAX_MS;
}

/**
 * Ist der gemeldete fertige Druck der zuletzt aus Lagernaut gestartete?
 * Die Brücke schickt den Titel als subtask_name; der Drucker meldet ihn zurück.
 */
export function istDerAuftrag(titel: string, dateiname: string | null, gemeldet: string | null): boolean {
  if (!gemeldet) return false;
  const ohneEndung = (dateiname ?? "").replace(/\.gcode\.3mf$/i, "");
  return gemeldet === titel || (!!ohneEndung && gemeldet === ohneEndung);
}

/** Material der Vorlage gegen die eingelegte Spule — nur ein Hinweis, kein Verbot. */
export function materialPasst(vorlage: string | null | undefined, spule: string | null | undefined): boolean | null {
  const v = (vorlage ?? "").trim().toUpperCase();
  const s = (spule ?? "").trim().toUpperCase();
  if (!v || !s) return null;
  const art = (x: string) => (/(PETG|PLA|TPU|ASA|ABS|PA|PC)/.exec(x)?.[1] ?? x);
  return art(v) === art(s);
}

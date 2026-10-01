// ── „Im 3D-Druck" an der Anfrage (Admin-Anfragenliste, 01.10.2026) ────────────
//
// Wunsch Frank: in der Anfragen-Liste für die jeweilige LogID anzeigen, dass sich
// die Füße dafür im Druck befinden. NUR im Admin — der Techniker braucht davon
// nichts zu wissen (Frank, 01.10.2026).
//
// Eine Anfrage gilt als „im Druck", wenn für ihr Modell + Teiltyp ein Druckauftrag
// wartet, übertragen wird, druckt oder gedruckt und noch nicht eingebucht ist —
// egal ob er von genau dieser Anfrage ausgelöst wurde (zwei Anfragen = ein Druck).
//
// Reine Logik — Test: `npm run test:druck`.

import { fertigUm } from "./druckerPhase";
import { DRUCKT } from "./warteschlange";

export type DruckHinweis = {
  auftragId: number;
  /** Kurz und in leichter Sprache, z. B. „wird gedruckt · 47 % · fertig ca. 13:59". */
  text: string;
  /** fertig gedruckt, wartet aufs Einbuchen → eigene Farbe in der Liste */
  fertig: boolean;
};

export function druckHinweis(l: {
  auftragId: number;
  status: string;
  /** Meldet der Drucker gerade genau diesen Auftrag? */
  istAktuell: boolean;
  zustand: string | null;
  fortschritt: number | null;
  restMinuten: number | null;
  /** Warum ein wartender Auftrag nicht startet (Zeitfenster, Spule, Platte). */
  wartegrund: string | null;
  jetzt?: Date;
}): DruckHinweis {
  const h = (text: string, fertig = false): DruckHinweis => ({ auftragId: l.auftragId, text, fertig });
  if (l.status === "WARTET") return h(l.wartegrund ? `Druck wartet — ${l.wartegrund}` : "Druck startet gleich");
  if (l.status === "ABGEHOLT") return h("wird an den Drucker übertragen");
  if (l.istAktuell && l.zustand && DRUCKT.includes(l.zustand)) {
    const teile = ["wird gedruckt"];
    if (l.fortschritt != null) teile.push(`${l.fortschritt} %`);
    const ende = fertigUm(l.restMinuten, l.jetzt);
    if (ende) teile.push(`fertig ca. ${ende}`);
    return h(teile.join(" · "));
  }
  if (l.istAktuell && l.zustand === "FAILED") return h("Druck abgebrochen — bitte am Drucker nachsehen");
  return h("fertig gedruckt — noch einbuchen", true);
}

// Gemeinsame Form für alle Suchquellen. Wer eine weitere anbindet, muss nur
// diese beiden Typen bedienen — der Rest des Programms bleibt unberührt.

export type Fundstelle = {
  titel:   string;
  ausriss: string;
  link:    string;
};

export type SucheErgebnis =
  | { ok: true;  fundstellen: Fundstelle[]; verbraucht: number }
  | { ok: false; grund: string };

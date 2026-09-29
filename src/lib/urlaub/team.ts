// ── Urlaubsplanung: wer darf? ────────────────────────────────────────────────
//
// Nur diese drei Konten (Frank, 29.09.2026): FRANK (Admin, Id 1), Christian Roth
// (CR, Id 12), Ronny Schorg (RS, Id 15). Bewusst KEIN Recht im Rollensystem:
// Admins bekommen jedes Recht per Wildcard — ein Recht „Urlaub sehen" hätte
// damit auch jeden anderen Admin (z. B. Arlett, AD) eingeschlossen.
// Wer dazukommt, kommt nur über eine Änderung hier dazu — nicht per Klick.
// Das Konto „FS" (Franks Techniker-Konto, Id 2) gehört ausdrücklich NICHT dazu.

export const URLAUB_TEAM_IDS: readonly number[] = [1, 12, 15];

export function istImUrlaubTeam(userId: number | string | null | undefined): boolean {
  const id = typeof userId === "string" ? Number(userId) : userId;
  return typeof id === "number" && URLAUB_TEAM_IDS.includes(id);
}

/**
 * Darf `ich` den Eintrag / Anspruch von `besitzer` anlegen, ändern, löschen oder
 * als geplant/genehmigt markieren? Nur den eigenen (Frank, 29.09.2026: „nur
 * derjenige aktive Nutzer … bei sich eintragen"; genehmigen und Anspruch
 * ebenfalls nur selbst). Die Einträge der anderen sind nur lesbar.
 */
export function darfBearbeiten(ich: number | string | null | undefined, besitzer: number): boolean {
  const id = typeof ich === "string" ? Number(ich) : ich;
  return istImUrlaubTeam(id) && id === besitzer;
}

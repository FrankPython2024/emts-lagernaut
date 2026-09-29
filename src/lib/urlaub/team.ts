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

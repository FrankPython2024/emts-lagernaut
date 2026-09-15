import { queues } from "@/modules/jobs/worker";

function enqueue(name: string, data: Record<string, unknown>): void {
  queues.meilisearch.add(name, data).catch((e: unknown) =>
    console.warn(`[MeiliSync] ${name} queue-Fehler:`, e),
  );
}

// Fire-and-forget: kein await, kein throw.
// Mutation-Integrität ist primär — Suche ist sekundär.
export const meilisearchSync = {
  artikel:       (id: number) => enqueue("sync-artikel",   { artikelId: id }),
  deleteArtikel: (id: number) => enqueue("delete-artikel", { artikelId: id }),
  modell:        (id: number) => enqueue("sync-modell",    { modellId:  id }),
  deleteModell:  (id: number) => enqueue("delete-modell",  { modellId:  id }),
  anfrage:       (id: number) => enqueue("sync-anfrage",   { anfrageId: id }),
  /**
   * Nach `anfrage.deleteMany` aufrufen. ⚠️ Ohne das blieben gelöschte Anfragen in
   * der globalen Suche stehen: Am 15.09.2026 lagen dort 4.071 Anfragen, die es in
   * der DB nicht mehr gab (3.952 davon aus Stresstests) — sie tauchten als
   * „Phantom-Anfragen" auf. Der Job prüft die DB und entfernt nur, was dort fehlt.
   */
  anfragenGeloescht: (ids: number[]) => { for (const id of ids) enqueue("sync-anfrage", { anfrageId: id }); },
  buchung:       (id: number) => enqueue("sync-buchung",   { buchungId: id }),
  deleteBuchung: (id: number) => enqueue("delete-buchung", { buchungId: id }),
};

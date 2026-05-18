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
  buchung:       (id: number) => enqueue("sync-buchung",   { buchungId: id }),
  deleteBuchung: (id: number) => enqueue("delete-buchung", { buchungId: id }),
};

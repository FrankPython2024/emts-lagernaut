import { queues } from "@/modules/jobs/worker";
import type { SuchIndex } from "./meilisearchDokumente";

function enqueue(name: string, data: Record<string, unknown>): void {
  queues.meilisearch.add(name, data).catch((e: unknown) =>
    console.warn(`[MeiliSync] ${name} queue-Fehler:`, e),
  );
}

// Fire-and-forget: kein await, kein throw.
// Mutation-Integrität ist primär — Suche ist sekundär.
//
// ⚠️ Wer Zeilen per `deleteMany` / `createMany` schreibt, muss hier Bescheid
// geben — der Index erfährt sonst nie davon. Am 15.09.2026 gemessen: 38.345 von
// 38.829 Artikel-Dokumenten und 1.425 von 2.625 Modell-Dokumenten zeigten auf
// Zeilen, die es nicht mehr gab (Voll-Reset am 22.05.2026), und 24.935 Artikel
// fehlten ganz (Artikel-Generator per `createMany`). Die Suche fand damit fast
// nur Tote. `npm run reindex -- --aufraeumen` prüft und bereinigt.
export const meilisearchSync = {
  artikel:       (id: number) => enqueue("sync-artikel",   { artikelId: id }),
  deleteArtikel: (id: number) => enqueue("delete-artikel", { artikelId: id }),
  /**
   * Mehrere Artikel in EINEM Job abgleichen — nach `artikel.createMany` oder
   * `deleteMany`. Der Job prüft die DB: vorhandene werden geschrieben, fehlende
   * aus dem Index genommen.
   */
  artikelMehrere: (ids: number[]) => { if (ids.length > 0) enqueue("sync-artikel-mehrere", { artikelIds: ids }); },
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
  /**
   * Nach `buchung.deleteMany` aufrufen (Anfrage zurücksetzen, Stresstest
   * aufräumen). Am 15.09.2026 standen 31 so gelöschte Buchungen noch im Index.
   */
  buchungenGeloescht: (ids: number[]) => { if (ids.length > 0) enqueue("sync-buchungen-mehrere", { buchungIds: ids }); },
  /** Derselbe Job für neu angelegte Buchungen (vorhandene werden geschrieben). */
  buchungenMehrere: (ids: number[]) => { if (ids.length > 0) enqueue("sync-buchungen-mehrere", { buchungIds: ids }); },
  /**
   * Index komplett leeren — NUR nach einem Voll-Reset, bei dem die Tabelle
   * selbst leer ist. Läuft in der Queue hinter allen vorher eingereihten Jobs.
   */
  indexLeeren: (indizes: SuchIndex[]) => { for (const index of indizes) enqueue("leere-index", { index }); },
};

/**
 * Sammelt, was eine Transaktion berührt, und meldet es ERST NACH dem Commit.
 *
 * ⚠️ Aus der Transaktion heraus einreihen geht schief: Der Worker liest die DB
 * selbst und kann schneller sein als der Commit — dann schreibt er den ALTEN
 * Stand in den Index. `senden()` also hinter das `await prisma.$transaction(...)`.
 *
 *   const sync = suchSyncNachCommit();
 *   const r = await prisma.$transaction(async (tx) => { …; sync.artikel(ids); … });
 *   sync.senden();
 */
export function suchSyncNachCommit() {
  const artikel   = new Set<number>();
  const buchungen = new Set<number>();
  const modelle   = new Set<number>();
  return {
    artikel:   (ids: number[]) => { for (const id of ids) artikel.add(id); },
    buchungen: (ids: number[]) => { for (const id of ids) buchungen.add(id); },
    modell:    (id: number)    => { modelle.add(id); },
    senden: () => {
      meilisearchSync.artikelMehrere([...artikel]);
      meilisearchSync.buchungenMehrere([...buchungen]);
      for (const id of modelle) meilisearchSync.modell(id);
    },
  };
}

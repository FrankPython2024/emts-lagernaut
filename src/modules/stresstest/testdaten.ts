/**
 * Stresstest — wer testet und wie die Spuren wieder verschwinden.
 *
 * ⚠️ Am 14.09.2026 real passiert: Der Test lief unter den Kürzeln ECHTER
 * Techniker (FS, VS, AB …) und hat beim vorzeitigen Beenden 9 halb gefüllte
 * Warenkörbe hinterlassen. Warenkörbe gehören zu (Techniker, LogID) — wer später
 * genau diese LogID scannte, schickte die Test-Teile unbemerkt mit ab, samt
 * „STRESSTEST_…" im Kommentar. Das Aufräumen kannte nur Anfragen und Buchungen.
 * Außerdem blieben zurück: „Teil bereit zur Abholung"-Nachrichten an echte
 * Techniker, ein um 4 zu hoher Bestand (Buchungen gelöscht, Bestand nicht neu
 * gerechnet) und zwei aktive ADMIN-Konten mit dem Passwort „stress123".
 *
 * Daraus die Regeln in dieser Datei:
 *  1. Eigene Kürzel, die nie einem Menschen gehören. Ein Test-Korb kann damit
 *     nie im Korb eines Technikers landen.
 *  2. KEINE Konten anlegen. Kein Service im Testweg liest die User-Tabelle, und
 *     ein Konto mit bekanntem Passwort auf einer öffentlichen Seite ist eine Tür.
 *  3. Aufräumen erfasst ALLES, was der Testweg schreibt — und fasst nichts an,
 *     was nicht eindeutig zum Test gehört.
 */

import { prisma } from "@/core/db/prisma";
import { syncBestandAusHistorie } from "@/modules/buchungen/service";
import { meilisearchSync } from "@/core/infra/meilisearchSync";

export const TEST_MARKER = "STRESSTEST";

/** Kürzel der simulierten Techniker. Präfix „ST" + Ziffern gibt es bei AfB nicht. */
export const TEST_TECHNIKER = ["ST01", "ST02", "ST03", "ST04", "ST05", "ST06", "ST07", "ST08", "ST09", "ST10"] as const;
/** Kürzel der simulierten Admins. */
export const TEST_ADMINS = ["STA1", "STA2", "STA3"] as const;
export const TEST_KUERZEL: string[] = [...TEST_TECHNIKER, ...TEST_ADMINS];

export function markerFuer(runId?: string): string {
  return runId ? `${TEST_MARKER}_${runId}` : TEST_MARKER;
}

/**
 * Stellt sicher, dass keines der Test-Kürzel einem echten Konto gehört.
 * Lieber gar nicht testen als unter fremdem Namen.
 */
export async function pruefeTestKuerzelFrei(): Promise<void> {
  const belegt = await prisma.user.findMany({
    where: { kuerzel: { in: TEST_KUERZEL } },
    select: { kuerzel: true },
  });
  if (belegt.length > 0) {
    throw new Error(
      `Stresstest abgebrochen: Kürzel ${belegt.map((b) => b.kuerzel).join(", ")} gehören echten Konten.`,
    );
  }
}

export type TestdatenStand = {
  anfragen: number;
  buchungen: number;
  nachrichten: number;
  warenkoerbe: number;
  gesamt: number;
};

/** Anfragen, die zum Test gehören: Marker im Kommentar ODER von einem Test-Kürzel. */
function anfrageWhere(marker: string, allesVonTestKuerzeln: boolean) {
  return allesVonTestKuerzeln
    ? { OR: [{ kommentar: { contains: marker } }, { techniker: { in: TEST_KUERZEL } }] }
    : { kommentar: { contains: marker } };
}

/**
 * Nachrichten, die ausschließlich Test-Kürzel betreffen: Chat an Test-Anfragen,
 * System-Nachrichten an Test-Techniker, Chat von Test-Kürzeln.
 * ⚠️ Nie „alle System-Nachrichten ohne LogID" — das alte CLI-Aufräumen tat genau
 * das und hätte die Postfächer aller echten Techniker geleert.
 */
async function testNachrichtIds(anfrageIds: number[]): Promise<number[]> {
  const [chat, anTest, vonTest] = await Promise.all([
    anfrageIds.length > 0
      ? prisma.nachricht.findMany({ where: { logId: { in: anfrageIds.map((id) => `chat:${id}`) } }, select: { id: true } })
      : Promise.resolve([]),
    // An Test-Kürzel UND an niemanden sonst.
    prisma.nachricht.findMany({
      where: {
        empfaenger: { some: { empfKuerzel: { in: TEST_KUERZEL } }, none: { empfKuerzel: { notIn: TEST_KUERZEL } } },
      },
      select: { id: true },
    }),
    prisma.nachricht.findMany({ where: { vonKuerzel: { in: TEST_KUERZEL } }, select: { id: true } }),
  ]);
  return [...new Set([...chat, ...anTest, ...vonTest].map((n) => n.id))];
}

export async function zaehleTestdaten(): Promise<TestdatenStand> {
  const where = anfrageWhere(TEST_MARKER, true);
  const [anfrageIds, buchungen, warenkoerbe] = await Promise.all([
    prisma.anfrage.findMany({ where, select: { id: true } }),
    prisma.buchung.count({ where: { notiz: { contains: TEST_MARKER } } }),
    prisma.warenkorb.count({
      where: { OR: [{ techniker: { in: TEST_KUERZEL } }, { items: { some: { zusatzinfo: { contains: TEST_MARKER } } } }] },
    }),
  ]);
  const nachrichten = (await testNachrichtIds(anfrageIds.map((a) => a.id))).length;
  const anfragen = anfrageIds.length;
  return { anfragen, buchungen, nachrichten, warenkoerbe, gesamt: anfragen + buchungen + nachrichten + warenkoerbe };
}

export type BereinigungsErgebnis = {
  anfragen: number;
  buchungen: number;
  nachrichten: number;
  warenkoerbe: number;
  /** Artikel, deren Bestand nach dem Löschen der Buchungen neu berechnet wurde. */
  bestandNeuBerechnet: number;
};

/**
 * Räumt die Spuren eines Laufs (runId) oder aller Läufe (ohne runId) weg.
 *
 * ⚠️ Mit runId wird nur über den Marker gesucht — sonst nähme das Aufräumen
 * eines Laufs die Daten eines parallel laufenden anderen mit.
 */
export async function bereinigeTestdaten(runId?: string): Promise<BereinigungsErgebnis> {
  const marker = markerFuer(runId);
  const alles = !runId;

  // 1) Anfragen + deren Chats + Nachrichten an Test-Kürzel
  const anfragen = await prisma.anfrage.findMany({ where: anfrageWhere(marker, alles), select: { id: true } });
  const anfrageIds = anfragen.map((a) => a.id);
  const nachrichtIds = alles
    ? await testNachrichtIds(anfrageIds)
    : anfrageIds.length > 0
      ? (await prisma.nachricht.findMany({ where: { logId: { in: anfrageIds.map((id) => `chat:${id}`) } }, select: { id: true } })).map((n) => n.id)
      : [];
  if (nachrichtIds.length > 0) {
    // Empfänger und Antworten hängen per Cascade dran.
    await prisma.nachricht.deleteMany({ where: { id: { in: nachrichtIds } } });
  }
  if (anfrageIds.length > 0) {
    await prisma.anfrage.deleteMany({ where: { id: { in: anfrageIds } } });
    // Sonst bleiben sie in der globalen Suche stehen (4.071 Stück am 15.09.2026).
    meilisearchSync.anfragenGeloescht(anfrageIds);
  }

  // 2) Warenkörbe — genau das, was am 14.09.2026 liegen blieb.
  //    Körbe der Test-Kürzel ganz; in fremden Körben nur die markierten Teile,
  //    danach leer gewordene Körbe.
  const testKoerbe = await prisma.warenkorb.findMany({
    where: alles ? { techniker: { in: TEST_KUERZEL } } : { techniker: { in: TEST_KUERZEL }, items: { some: { zusatzinfo: { contains: marker } } } },
    select: { id: true },
  });
  const testKorbIds = testKoerbe.map((k) => k.id);
  const markierteTeile = await prisma.warenkorbItem.findMany({
    where: { zusatzinfo: { contains: marker } },
    select: { id: true, korbId: true },
  });
  const beruehrteKoerbe = [...new Set([...testKorbIds, ...markierteTeile.map((t) => t.korbId)])];
  await prisma.warenkorbItem.deleteMany({
    where: { OR: [{ korbId: { in: testKorbIds } }, { id: { in: markierteTeile.map((t) => t.id) } }] },
  });
  const leer = await prisma.warenkorb.findMany({
    where: { id: { in: beruehrteKoerbe }, items: { none: {} } },
    select: { id: true },
  });
  if (leer.length > 0) await prisma.warenkorb.deleteMany({ where: { id: { in: leer.map((k) => k.id) } } });

  // 3) Buchungen — und den Bestand der betroffenen Artikel neu rechnen.
  //    Das fehlte: gelöschte EINGANG-Buchungen ließen den Bestand zu hoch stehen.
  const buchungen = await prisma.buchung.findMany({
    where: { notiz: { contains: marker } },
    select: { id: true, artikelId: true },
  });
  if (buchungen.length > 0) {
    await prisma.buchung.deleteMany({ where: { id: { in: buchungen.map((b) => b.id) } } });
    meilisearchSync.buchungenGeloescht(buchungen.map((b) => b.id));
  }
  const artikelIds = [...new Set(buchungen.map((b) => b.artikelId))];
  for (const id of artikelIds) await syncBestandAusHistorie(id);

  const ergebnis: BereinigungsErgebnis = {
    anfragen: anfrageIds.length,
    buchungen: buchungen.length,
    nachrichten: nachrichtIds.length,
    warenkoerbe: leer.length,
    bestandNeuBerechnet: artikelIds.length,
  };
  console.log(`[Stresstest] Bereinigt (${marker}):`, JSON.stringify(ergebnis));
  return ergebnis;
}

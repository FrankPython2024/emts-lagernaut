/**
 * Nachtrag: Buchung.anfrageId aus der Notiz füllen.
 *
 * Alle vier Wege, die eine Ausgabe-Buchung zu einer Anfrage erzeugen, schreiben
 * seit jeher `Anfrage #<Nr>` in `Buchung.notiz`. Damit lässt sich die Verbindung
 * zum Zielgerät für die gesamte Historie nachträglich herstellen, statt erst ab
 * heute zu zählen.
 *
 * ⚠️ Bewusst konservativ:
 *   - Es wird NUR die Spalte `anfrageId` gesetzt. Kein Bestand, keine Notiz,
 *     kein Status wird angefasst.
 *   - Buchungen, deren Anfrage nicht mehr existiert, werden übersprungen
 *     (sonst Fremdschlüsselverletzung). Sie erscheinen im Bericht.
 *   - Buchungen, bei denen `anfrageId` schon steht, werden nicht überschrieben.
 *   - EINGANG wird nicht angefasst: dort ist die Notiz nie eine Anfrage.
 *
 * Aufruf (Trockenlauf, ändert nichts):
 *   docker compose exec -T app npx tsx prisma/scripts/backfill-buchung-anfrage.ts
 *
 * Aufruf (schreibt wirklich):
 *   docker compose exec -T app npx tsx prisma/scripts/backfill-buchung-anfrage.ts --schreiben
 *
 * Das Skript ist wiederholbar: Ein zweiter Lauf findet nichts mehr zu tun.
 */

import { PrismaClient, BuchungsTyp } from "@prisma/client";

const prisma = new PrismaClient();

/** Wie viele Buchungen pro Runde aus der DB geholt werden. */
const SEITE = 2000;
/** Wie viele Update-Befehle in einer Transaktion zusammengefasst werden. */
const BLOCK = 100;

/** Zieht die Anfrage-Nummer aus einer Notiz wie „Anfrage #123 | Gruppe: G7". */
function anfrageNrAus(notiz: string | null): number | null {
  if (!notiz) return null;
  const treffer = /Anfrage #(\d+)/.exec(notiz);
  if (!treffer) return null;
  const nr = Number(treffer[1]);
  return Number.isSafeInteger(nr) && nr > 0 ? nr : null;
}

async function main() {
  const schreiben = process.argv.includes("--schreiben");

  console.log(schreiben
    ? "== NACHTRAG (schreibt) =="
    : "== TROCKENLAUF — es wird nichts geändert. Mit --schreiben wirklich ausführen. ==");

  // ── 1. Kandidaten sammeln ──────────────────────────────────────────────────
  // Nur Ausgaben ohne gesetzte Verknüpfung. `notiz: contains` grenzt schon in
  // der DB ein, damit nicht die komplette Buchungstabelle durch den Prozess läuft.
  const zuordnung = new Map<number, number[]>();   // anfrageId → Buchungs-Ids
  let gesehen = 0;
  let ohneNummer = 0;
  let cursor: number | undefined;

  for (;;) {
    const seite = await prisma.buchung.findMany({
      where: {
        anfrageId: null,
        typ:       { in: [BuchungsTyp.AUSGANG, BuchungsTyp.DIREKT] },
        notiz:     { contains: "Anfrage #" },
      },
      select:  { id: true, notiz: true },
      orderBy: { id: "asc" },
      take:    SEITE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (seite.length === 0) break;

    for (const b of seite) {
      gesehen++;
      const nr = anfrageNrAus(b.notiz);
      if (nr === null) { ohneNummer++; continue; }
      const liste = zuordnung.get(nr);
      if (liste) liste.push(b.id); else zuordnung.set(nr, [b.id]);
    }

    cursor = seite[seite.length - 1]!.id;
    if (seite.length < SEITE) break;
  }

  console.log(`Buchungen ohne Verknüpfung mit „Anfrage #" in der Notiz: ${gesehen}`);
  if (ohneNummer > 0) console.log(`  davon ohne lesbare Nummer:            ${ohneNummer}`);
  console.log(`Verschiedene Anfragen angesprochen:                     ${zuordnung.size}`);

  if (zuordnung.size === 0) {
    console.log("Nichts zu tun.");
    return;
  }

  // ── 2. Prüfen, welche dieser Anfragen es überhaupt noch gibt ───────────────
  // Ohne diese Prüfung würde der Fremdschlüssel bei gelöschten Anfragen brechen
  // und der ganze Block scheitern.
  const nummern = [...zuordnung.keys()];
  const vorhanden = new Set<number>();
  for (let i = 0; i < nummern.length; i += 1000) {
    const teil = await prisma.anfrage.findMany({
      where:  { id: { in: nummern.slice(i, i + 1000) } },
      select: { id: true },
    });
    for (const a of teil) vorhanden.add(a.id);
  }

  const verwaist = nummern.filter((n) => !vorhanden.has(n));
  let buchungenVerwaist = 0;
  for (const n of verwaist) buchungenVerwaist += zuordnung.get(n)!.length;

  const machbar = nummern.filter((n) => vorhanden.has(n));
  let buchungenMachbar = 0;
  for (const n of machbar) buchungenMachbar += zuordnung.get(n)!.length;

  console.log(`Anfrage existiert noch:                                ${machbar.length} (${buchungenMachbar} Buchungen)`);
  if (verwaist.length > 0) {
    console.log(`Anfrage gelöscht, wird übersprungen:                   ${verwaist.length} (${buchungenVerwaist} Buchungen)`);
    console.log(`  betroffene Anfrage-Nummern (erste 20): ${verwaist.slice(0, 20).join(", ")}`);
  }

  if (!schreiben) {
    console.log("\nTrockenlauf beendet. Es wurde nichts geschrieben.");
    return;
  }

  // ── 3. Schreiben ───────────────────────────────────────────────────────────
  let geschrieben = 0;
  for (let i = 0; i < machbar.length; i += BLOCK) {
    const block = machbar.slice(i, i + BLOCK);
    const ergebnisse = await prisma.$transaction(
      block.map((nr) =>
        prisma.buchung.updateMany({
          where: { id: { in: zuordnung.get(nr)! }, anfrageId: null },
          data:  { anfrageId: nr },
        }),
      ),
    );
    for (const r of ergebnisse) geschrieben += r.count;
    console.log(`  ${Math.min(i + BLOCK, machbar.length)} von ${machbar.length} Anfragen verarbeitet…`);
  }

  console.log(`\nFertig. ${geschrieben} Buchungen mit ihrer Anfrage verknüpft.`);
}

main()
  .catch((e) => { console.error("FEHLGESCHLAGEN:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

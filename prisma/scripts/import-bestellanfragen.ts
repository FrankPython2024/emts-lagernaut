import { PrismaClient, BestellanfrageStatus } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";

// ── Einmaliger Import der Excel-Historie „Bestellanfrage Eigenbedarf 2026" ────
//
// Quelle: prisma/scripts/bestellanfragen-2026.json (aus der Excel extrahiert).
//
// IDEMPOTENT: Läuft das Skript zweimal, entstehen keine Dubletten. Erkannt wird
// eine bereits importierte Zeile an Beschreibung + Anzahl + Datum — die Excel
// hat keine eigene Id, deshalb dieser fachliche Schlüssel.
//
// Aufruf im Container:
//   docker compose exec -T app npx tsx prisma/scripts/import-bestellanfragen.ts
//   docker compose exec -T app npx tsx prisma/scripts/import-bestellanfragen.ts --trocken

type Zeile = {
  anzahl:         number;
  hersteller:     string | null;
  beschreibung:   string;
  link:           string | null;
  verwendungsort: string | null;
  status:         "OFFEN" | "BESTELLT" | "GELIEFERT";
  datum:          string | null;
};

const prisma   = new PrismaClient();
const trocken  = process.argv.includes("--trocken");

async function main() {
  const pfad   = join(__dirname, "bestellanfragen-2026.json");
  const zeilen = JSON.parse(readFileSync(pfad, "utf8")) as Zeile[];
  console.log(`${zeilen.length} Zeilen in der Quelldatei${trocken ? "  (TROCKENLAUF — es wird nichts geschrieben)" : ""}`);

  let neu = 0, uebersprungen = 0;

  for (const z of zeilen) {
    const datum = z.datum ? new Date(z.datum + "T08:00:00Z") : null;

    const schonDa = await prisma.bestellanfrage.findFirst({
      where: {
        beschreibung: z.beschreibung,
        anzahl:       z.anzahl,
        ...(datum ? { angefordertAm: datum } : {}),
      },
      select: { id: true },
    });
    if (schonDa) { uebersprungen++; continue; }

    if (!trocken) {
      await prisma.bestellanfrage.create({
        data: {
          anzahl:         z.anzahl,
          hersteller:     z.hersteller,
          beschreibung:   z.beschreibung,
          link:           z.link,
          verwendungsort: z.verwendungsort,
          status:         z.status as BestellanfrageStatus,
          // Die Excel kennt nur EIN Datum je Zeile. Es steht für den Montag, an
          // dem die Position rausging; bei noch offenen Zeilen ist es das
          // geplante Datum. Deshalb wird es beim Anfordern gesetzt und nur bei
          // bereits verschickten Positionen zusätzlich als Versanddatum geführt.
          angefordertAm:  datum ?? new Date(),
          versendetAm:    z.status === "OFFEN" ? null : datum,
          geliefertAm:    z.status === "GELIEFERT" ? datum : null,
          angefordertVon: "Import",
          notiz:          "Übernommen aus der Excel-Liste 2026",
        },
      });
    }
    neu++;
  }

  console.log(`\nNeu angelegt:   ${neu}`);
  console.log(`Übersprungen:   ${uebersprungen} (bereits vorhanden)`);

  if (!trocken) {
    const proStatus = await prisma.bestellanfrage.groupBy({
      by: ["status"], _count: { _all: true },
    });
    console.log("\nBestand jetzt:");
    for (const s of proStatus) console.log(`  ${s.status.padEnd(10)} ${s._count._all}`);
  }
}

main()
  .catch((e) => { console.error("FEHLER:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());

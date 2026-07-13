/**
 * Einmalige Migration: Verbrauchsmaterial-Fotos von der alten 1:1-Tabelle
 * `VerbrauchsArtikelBild` in die neue Galerie-Tabelle `VerbrauchsArtikelFoto`
 * übernehmen (als Titelbild, position 0).
 *
 * Ausführung (im App-Container, nach `prisma db push`):
 *   docker compose exec -T app npx tsx prisma/scripts/migrate-vm-fotos.ts
 *
 * Idempotent: übernimmt nur Artikel, die in der Galerie noch KEIN Foto haben.
 * Die alte Tabelle bleibt unangetastet (erst später per db push entfernen).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const alte = await prisma.verbrauchsArtikelBild.findMany({
    select: { artikelId: true, mimeType: true, daten: true },
  });
  console.log(`Alte 1:1-Fotos gefunden: ${alte.length}`);

  let uebernommen = 0;
  let uebersprungen = 0;

  for (const b of alte) {
    // Idempotenz: nur wenn der Artikel in der Galerie noch kein Foto hat.
    const schon = await prisma.verbrauchsArtikelFoto.count({ where: { artikelId: b.artikelId } });
    if (schon > 0) { uebersprungen++; continue; }

    await prisma.verbrauchsArtikelFoto.create({
      data: { artikelId: b.artikelId, position: 0, mimeType: b.mimeType, daten: b.daten },
    });
    uebernommen++;
  }

  console.log(`Übernommen: ${uebernommen} | Übersprungen (schon vorhanden): ${uebersprungen}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

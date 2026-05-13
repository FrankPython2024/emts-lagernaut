import { PrismaClient } from "@prisma/client";
import konfig from "./data/regalkonfig.json";

const prisma = new PrismaClient();

async function main() {
  let created = 0;
  let updated = 0;

  for (const r of konfig.regale) {
    for (const ebene of r.ebenen) {
      for (const fach of r.faecher) {
        const code = `ETL-${r.regal}-${ebene}-${fach}`;

        const existed = await prisma.lagerplatz.findUnique({ where: { code } });

        await prisma.lagerplatz.upsert({
          where: { code },
          update: {
            reihe:      r.reihe,
            hersteller: r.hersteller,
          },
          create: {
            code,
            regal:      r.regal,
            reihe:      r.reihe,
            ebene,
            fach,
            hersteller: r.hersteller,
          },
        });

        if (existed) updated++;
        else created++;
      }
    }
  }

  const total = await prisma.lagerplatz.count();
  console.log(`✓ Seed fertig: ${created} neu, ${updated} aktualisiert`);
  console.log(`  Gesamt in DB: ${total} (Soll: 125)`);

  if (total !== 125) {
    console.warn(`⚠️  Anzahl weicht ab! Konfig prüfen.`);
  }

  const verteilung = await prisma.lagerplatz.groupBy({
    by:     ["hersteller"],
    _count: { _all: true },
  });
  console.log("  Verteilung:", verteilung);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

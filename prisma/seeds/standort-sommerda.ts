import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedStandortSommerda() {
  console.log('Seeding Standort ETL-Sömmerda...');

  await prisma.standort.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id:       1,
      name:     'AfB Sömmerda',
      kurzname: 'ETL',
      adresse:  'Sömmerda',
      aktiv:    true,
    },
  });
  console.log('  ✓ Standort 1 (ETL) vorhanden');

  const lpResult = await prisma.$executeRawUnsafe(
    `UPDATE lagerplatz SET standortId = 1 WHERE standortId IS NULL OR standortId = 0`
  );
  console.log(`  ✓ Lagerplatz: ${lpResult} Zeilen auf standortId=1 gesetzt`);

  const artResult = await prisma.$executeRawUnsafe(
    `UPDATE Artikel SET standortId = 1 WHERE standortId IS NULL OR standortId = 0`
  );
  console.log(`  ✓ Artikel: ${artResult} Zeilen auf standortId=1 gesetzt`);

  const userResult = await prisma.$executeRawUnsafe(
    `UPDATE User SET standortId = 1 WHERE rolle = 'TECHNIKER' AND standortId IS NULL`
  );
  console.log(`  ✓ User (TECHNIKER): ${userResult} Zeilen auf standortId=1 gesetzt`);
  console.log('  (Admins/Betrachter: standortId bleibt NULL = Zugriff auf alle Standorte)');

  console.log('Seed abgeschlossen.');
}

seedStandortSommerda()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

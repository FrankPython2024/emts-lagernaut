import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  // Fix 1: bezeichnung auf 500 Zeichen in DB kürzen
  const zuLang = await prisma.geraeteLookup.findMany({
    where: { bezeichnung: { not: '' } }
  })
  
  // Fix 2: GeraeteModell modell auf 255 Zeichen kürzen
  await prisma.$executeRaw`ALTER TABLE GeraeteLookup MODIFY bezeichnung TEXT`
  await prisma.$executeRaw`ALTER TABLE GeraeteModell MODIFY modell TEXT`
  
  console.log('✅ Spalten auf TEXT erweitert!')
}

main().catch(console.error).finally(() => prisma.$disconnect())

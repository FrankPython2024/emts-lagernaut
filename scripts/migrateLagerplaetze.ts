import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function erkenneBereiche(code: string): string {
  const prefix = code.split('-')[0]?.toUpperCase() ?? ''
  const map: Record<string, string> = {
    HP: 'HP',
    L:  'Lenovo',
    D:  'Dell',
    A:  'Acer',
  }
  return map[prefix] ?? 'Sonstiges'
}

async function main() {
  console.log('🗄️  Lagerplatz-Migration gestartet...\n')

  // Alle einzigartigen Lagerplatz-Strings aus Artikel sammeln
  const artikelMitLagerplatz = await prisma.artikel.findMany({
    where:  { lagerplatz: { not: null } },
    select: { id: true, lagerplatz: true },
  })

  const einzigartigeCodes = [
    ...new Set(
      artikelMitLagerplatz
        .map((a) => a.lagerplatz!)
        .filter((l) => l.trim() !== ''),
    ),
  ].sort()

  console.log(`📦 ${einzigartigeCodes.length} einzigartige Lagerplätze gefunden`)
  console.log(`📋 ${artikelMitLagerplatz.length} Artikel mit Lagerplatz\n`)

  let erstellt  = 0
  let vorhanden = 0
  let verknuepft = 0
  let fehler    = 0

  for (const code of einzigartigeCodes) {
    try {
      const bereich = erkenneBereiche(code)

      // Lagerplatz anlegen oder finden
      const lp = await prisma.lagerplatz.upsert({
        where:  { code },
        create: { code, bereich, aktiv: true },
        update: {},
      })

      if (lp.createdAt.getTime() === lp.updatedAt.getTime()) {
        erstellt++
        console.log(`  ✅ Erstellt: ${code} (Bereich: ${bereich})`)
      } else {
        vorhanden++
      }

      // Alle Artikel mit diesem Code verknüpfen
      const updated = await prisma.artikel.updateMany({
        where: { lagerplatz: code, lagerplatzId: null },
        data:  { lagerplatzId: lp.id },
      })

      verknuepft += updated.count
    } catch (e) {
      fehler++
      console.error(`  ❌ Fehler bei '${code}':`, e)
    }
  }

  console.log(`
✅ Migration abgeschlossen!
   Lagerplätze erstellt:  ${erstellt}
   Bereits vorhanden:     ${vorhanden}
   Artikel verknüpft:     ${verknuepft}
   Fehler:                ${fehler}
  `)

  // Verifikation
  const ohneVerknuepfung = await prisma.artikel.count({
    where: { lagerplatz: { not: null }, lagerplatzId: null },
  })

  if (ohneVerknuepfung > 0) {
    console.warn(`⚠️  ${ohneVerknuepfung} Artikel haben noch keinen lagerplatzId!`)
  } else {
    console.log('✅ Alle Artikel korrekt verknüpft.')
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

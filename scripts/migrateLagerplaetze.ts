import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function erkenneBereiche(code: string): string {
  const prefix = code.split('-')[0]?.toUpperCase() ?? ''
  const map: Record<string, string> = { HP: 'HP', L: 'Lenovo', D: 'Dell', A: 'Acer' }
  return map[prefix] ?? 'Sonstiges'
}

async function main() {
  console.log('🗄️  Lagerplatz-Übersicht\n')

  const gruppen = await prisma.artikel.groupBy({
    by:      ['lagerplatz'],
    where:   { lagerplatz: { not: null } },
    _count:  { lagerplatz: true },
    orderBy: { lagerplatz: 'asc' },
  })

  const total = await prisma.artikel.count()
  const mitLp = await prisma.artikel.count({ where: { lagerplatz: { not: null } } })
  const ohneLp = total - mitLp

  console.log(`📦 Artikel gesamt:         ${total}`)
  console.log(`✅ Mit Lagerplatz:         ${mitLp}`)
  console.log(`⚠️  Ohne Lagerplatz:        ${ohneLp}`)
  console.log(`🗄️  Einzigartige Lagerplätze: ${gruppen.length}\n`)

  console.log('LAGERPLATZ             BEREICH     ARTIKEL')
  console.log('─'.repeat(50))

  for (const g of gruppen) {
    const lp      = g.lagerplatz ?? '–'
    const bereich = erkenneBereiche(lp).padEnd(10)
    const anzahl  = String(g._count.lagerplatz).padStart(6)
    console.log(`${lp.padEnd(22)} ${bereich} ${anzahl}`)
  }

  console.log('\n✅ Fertig. Keine Datenbankänderungen durchgeführt.')
  console.log('   Lagerplätze werden als String-Feld in Artikel verwaltet.')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

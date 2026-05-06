import { PrismaClient } from '@prisma/client'
import { parse } from 'csv-parse/sync'
import fs from 'fs'

const prisma = new PrismaClient()

async function main() {
  const csvPath = process.argv[2] || '/tmp/lagerbestand.csv'

  if (!fs.existsSync(csvPath)) {
    console.error(`❌ Datei nicht gefunden: ${csvPath}`)
    process.exit(1)
  }

  const content = fs.readFileSync(csvPath, 'utf-8')

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[]

  console.log(`📦 ${records.length} Artikel gefunden`)

  let imported = 0
  let skipped  = 0
  let errors   = 0

  for (const row of records) {
    try {
      const bezeichnung = String(row['Bezeichnung'] || '').trim()
      const lagerplatz  = String(row['Lagerplatz']  || '').trim() || null
      const kategorie   = String(row['Kategorie']   || 'Sonstiges').trim()

      if (!bezeichnung) {
        skipped++
        continue
      }

      // Bestand wird IMMER auf 0 gesetzt — wird aus Buchungshistorie berechnet
      // QR Code und Reichweite werden ignoriert
      await prisma.artikel.upsert({
        where:  { bezeichnung_kategorie: { bezeichnung, kategorie } },
        update: { lagerplatz },
        create: { bezeichnung, lagerplatz, kategorie, bestand: 0 },
      })

      imported++

      if (imported % 200 === 0) {
        console.log(`  ✅ ${imported} importiert...`)
      }
    } catch (e) {
      errors++
      console.error(`❌ Fehler bei Zeile:`, row['Bezeichnung'], e)
    }
  }

  console.log(`
✅ Import abgeschlossen!
   Importiert:    ${imported}
   Übersprungen:  ${skipped}
   Fehler:        ${errors}
  `)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

import { PrismaClient, BuchungsTyp } from '@prisma/client'
import { parse } from 'csv-parse/sync'
import fs from 'fs'

const prisma = new PrismaClient()

async function main() {
  const csvPath = process.argv[2] || '/tmp/buchungen.csv'

  if (!fs.existsSync(csvPath)) {
    console.error(`❌ Datei nicht gefunden: ${csvPath}`)
    process.exit(1)
  }

  const content = fs.readFileSync(csvPath, 'utf-8')

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  })

  console.log(`📋 ${records.length} Buchungen gefunden — Import startet...`)

  // Erst alle vorhandenen Buchungen löschen
  await prisma.buchung.deleteMany({})
  console.log(`🗑️ Alte Buchungen gelöscht`)

  let imported = 0
  let skipped = 0
  let errors = 0

  for (const row of records) {
    try {
      const datumRaw    = String(row['Datum']       || '').trim()
      const mitarbeiter = String(row['Mitarbeiter'] || '').trim()
      const bezeichnung = String(row['Bezeichnung'] || '').trim()
      const typRaw      = String(row['Typ']         || '').trim().toLowerCase()
      const menge       = parseInt(row['Menge']     || '0')

      if (!datumRaw || !bezeichnung || !menge) {
        skipped++
        continue
      }

      // Typ mappen
      let typ: BuchungsTyp
      if (typRaw === 'eingang') typ = BuchungsTyp.EINGANG
      else if (typRaw === 'ausgang') typ = BuchungsTyp.AUSGANG
      else if (typRaw === 'direkt') typ = BuchungsTyp.DIREKT
      else {
        console.warn(`⚠️ Unbekannter Typ: ${typRaw}`)
        skipped++
        continue
      }

      // Datum parsen: DD.MM.YYYY → Date
      const [day, month, year] = datumRaw.split('.')
      const datum = new Date(`${year}-${month}-${day}T00:00:00.000Z`)

      if (isNaN(datum.getTime())) {
        console.warn(`⚠️ Ungültiges Datum: ${datumRaw}`)
        skipped++
        continue
      }

      // Artikel per BEZEICHNUNG suchen (nicht ID!)
      const artikel = await prisma.artikel.findFirst({
        where: { bezeichnung }
      })

      if (!artikel) {
        console.warn(`⚠️ Artikel "${bezeichnung}" nicht gefunden`)
        skipped++
        continue
      }

      await prisma.buchung.create({
        data: {
          datum,
          mitarbeiter,
          artikelId: artikel.id,
          bezeichnung,
          typ,
          menge,
          notiz: 'Importiert aus Google Sheets'
        }
      })

      imported++

      if (imported % 20 === 0) {
        console.log(`⏳ ${imported} importiert...`)
      }

    } catch (e) {
      errors++
      console.error(`❌ Fehler:`, row, e)
    }
  }

  // Bestände neu berechnen
  console.log(`\n🔄 Bestände werden neu berechnet...`)

  const alleArtikel = await prisma.artikel.findMany({
    select: { id: true },
    where: { buchungen: { some: {} } }
  })

  for (const art of alleArtikel) {
    const buchungen = await prisma.buchung.findMany({
      where: { artikelId: art.id }
    })

    const bestand = buchungen.reduce((sum, b) => {
      if (b.typ === BuchungsTyp.EINGANG) return sum + b.menge
      if (b.typ === BuchungsTyp.AUSGANG) return sum - b.menge
      return sum // DIREKT wird ignoriert!
    }, 0)

    await prisma.artikel.update({
      where: { id: art.id },
      data: { bestand: Math.max(0, bestand) }
    })
  }

  console.log(`
╔════════════════════════════════╗
║    Import abgeschlossen! ✅    ║
╠════════════════════════════════╣
║ Buchungen importiert: ${String(imported).padStart(6)}   ║
║ Übersprungen:         ${String(skipped).padStart(6)}   ║
║ Fehler:               ${String(errors).padStart(6)}   ║
╠════════════════════════════════╣
║ Bestände neu berechnet ✅      ║
╚════════════════════════════════╝
  `)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

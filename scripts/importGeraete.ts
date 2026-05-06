import { PrismaClient } from '@prisma/client'
import { parse } from 'csv-parse/sync'
import fs from 'fs'

const prisma = new PrismaClient()

function bereinige(bezeichnung: string): string {
  // Interne Codes entfernen: "ThinkPad T14 Gen 2i 20W1S06V00" → "ThinkPad T14 Gen 2i"
  let result = bezeichnung.trim()
  let prev = ''
  while (prev !== result) {
    prev = result
    result = result.replace(/\s+[A-Z0-9]{4,}[-A-Z0-9]*$/, '').trim()
  }
  return result
}

async function main() {
  const csvPath = process.argv[2] || '/tmp/geraete.csv'

  if (!fs.existsSync(csvPath)) {
    console.error(`❌ Datei nicht gefunden: ${csvPath}`)
    process.exit(1)
  }

  console.log(`📂 Lese CSV: ${csvPath}`)
  const content = fs.readFileSync(csvPath, 'utf-8')

  const records = parse(content, {
    columns:        true,
    skip_empty_lines: true,
    trim:           true,
    delimiter:      ';',
    quote:          '"',
    relax_quotes:   true,
  }) as Record<string, string>[]

  // Nur Notebooks filtern
  const notebooks = records.filter((r) =>
    String(r['Geräteart'] || '').trim() === 'Notebook'
  )

  console.log(`📦 ${records.length} Geräte gesamt`)
  console.log(`💻 ${notebooks.length} Notebooks gefunden — Import startet...\n`)

  let imported = 0
  let updated  = 0
  let skipped  = 0
  let errors   = 0

  for (const row of notebooks) {
    try {
      const logId          = String(row['LogId']       || '').trim()
      const hersteller     = String(row['Hersteller']  || '').trim()
      const bezeichnungRaw = String(row['Bezeichnung'] || '').trim()

      if (!logId || !bezeichnungRaw) { skipped++; continue }

      // LogId bereinigen: "212.826.176" → "212826176"
      const logIdClean = logId.replace(/\./g, '')

      // Bezeichnung bereinigen + Hersteller voranstellen
      const bezeichnungBereinigt = bereinige(bezeichnungRaw)
      const bereinigt = hersteller
        ? `${hersteller} ${bezeichnungBereinigt}`
        : bezeichnungBereinigt

      const existing = await prisma.geraeteLookup.findUnique({ where: { logId } })

      if (existing) {
        await prisma.geraeteLookup.update({
          where: { logId },
          data:  { logIdClean, bezeichnung: bezeichnungRaw, bereinigt },
        })
        updated++
      } else {
        await prisma.geraeteLookup.create({
          data: { logId, logIdClean, bezeichnung: bezeichnungRaw, bereinigt },
        })
        imported++
      }

      const total = imported + updated
      if (total % 2000 === 0) console.log(`⏳ ${total} verarbeitet...`)

    } catch (e) {
      errors++
      if (errors <= 5) console.error(`❌ Fehler:`, row['LogId'], e)
    }
  }

  console.log(`
╔══════════════════════════════════╗
║   Geräte Import abgeschlossen!  ║
╠══════════════════════════════════╣
║ Neu importiert:  ${String(imported).padStart(8)}    ║
║ Aktualisiert:    ${String(updated).padStart(8)}    ║
║ Übersprungen:    ${String(skipped).padStart(8)}    ║
║ Fehler:          ${String(errors).padStart(8)}    ║
╚══════════════════════════════════╝
  `)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

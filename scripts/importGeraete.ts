import { PrismaClient } from '@prisma/client'
import { parse } from 'csv-parse/sync'
import fs from 'fs'
import { normalisiereHersteller } from '@/lib/geraete/herstellerFilter'
import { bereinigeBezeichnung }   from '@/lib/geraete/bezeichnungBereinigen'

const prisma = new PrismaClient()


async function main() {
  const csvPath = process.argv[2] || '/tmp/geraete.csv'

  if (!fs.existsSync(csvPath)) {
    console.error(`❌ Datei nicht gefunden: ${csvPath}`)
    process.exit(1)
  }

  console.log(`📂 Lese CSV: ${csvPath}`)
  const content = fs.readFileSync(csvPath, 'utf-8')

  const records = parse(content, {
    columns:          true,
    skip_empty_lines: true,
    trim:             true,
    delimiter:        ';',
    quote:            '"',
    relax_quotes:     true,
  }) as Record<string, string>[]

  console.log(`📦 ${records.length} Datensätze gesamt`)

  let imported   = 0
  let updated    = 0
  let errors     = 0
  const skipReasons = new Map<string, number>()
  const importedByHersteller = new Map<string, number>()

  for (const row of records) {
    try {
      // 1. Nur Notebooks
      const geraeteart = String(row['Geräteart'] || '').trim()
      if (geraeteart !== 'Notebook') {
        const reason = `Kein Notebook (${geraeteart || 'leer'})`
        skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + 1)
        continue
      }

      const logId          = String(row['LogId']       || '').trim()
      const herstellerRaw  = String(row['Hersteller']  || '').trim()
      const bezeichnungRaw = String(row['Bezeichnung'] || '').trim()

      if (!logId || !bezeichnungRaw) {
        skipReasons.set('Fehlende LogId/Bezeichnung', (skipReasons.get('Fehlende LogId/Bezeichnung') ?? 0) + 1)
        continue
      }

      // 2. Hersteller-Filter (nur HP, Lenovo, Dell, Fujitsu)
      const normHersteller = normalisiereHersteller(herstellerRaw)
      if (!normHersteller) {
        const reason = `Hersteller: "${herstellerRaw}"`
        skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + 1)
        continue
      }

      // 3. Bereinigung mit neuer Logik (behebt u.a. "Dell Precision 7530" → "Precision")
      const logIdClean      = logId.replace(/\./g, '')
      const bezeichnungSafe = bezeichnungRaw.substring(0, 500)
      const cleanModel      = bereinigeBezeichnung(normHersteller, bezeichnungSafe)
      const bereinigt       = `${normHersteller} ${cleanModel}`

      // 4. Upsert
      const existing = await prisma.geraeteLookup.findUnique({ where: { logId } })
      if (existing) {
        await prisma.geraeteLookup.update({
          where: { logId },
          data:  { logIdClean, bezeichnung: bezeichnungSafe, bereinigt },
        })
        updated++
      } else {
        await prisma.geraeteLookup.create({
          data: { logId, logIdClean, bezeichnung: bezeichnungSafe, bereinigt },
        })
        imported++
      }

      importedByHersteller.set(normHersteller, (importedByHersteller.get(normHersteller) ?? 0) + 1)

      const total = imported + updated
      if (total % 2000 === 0) console.log(`⏳ ${total} verarbeitet...`)

    } catch (e) {
      errors++
      if (errors <= 5) console.error(`❌ Fehler:`, row['LogId'], e)
    }
  }

  // Statistik
  console.log(`
╔══════════════════════════════════════╗
║    Geräte Import abgeschlossen!      ║
╠══════════════════════════════════════╣
║ Neu importiert:  ${String(imported).padStart(8)}        ║
║ Aktualisiert:    ${String(updated).padStart(8)}        ║
║ Fehler:          ${String(errors).padStart(8)}        ║
╚══════════════════════════════════════╝
`)
  if (importedByHersteller.size > 0) {
    console.log('Importierte Hersteller:')
    for (const [h, c] of [...importedByHersteller].sort((a, b) => b[1] - a[1]))
      console.log(`  ${h.padEnd(10)} ${c.toLocaleString('de-DE').padStart(8)}`)
    console.log('')
  }
  if (skipReasons.size > 0) {
    console.log('Übersprungen (Top 10):')
    const sorted = [...skipReasons].sort((a, b) => b[1] - a[1]).slice(0, 10)
    for (const [reason, count] of sorted)
      console.log(`  ${count.toLocaleString('de-DE').padStart(8)}× ${reason}`)
  }

}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

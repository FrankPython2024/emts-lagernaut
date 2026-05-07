import { PrismaClient } from '@prisma/client'
import { parse } from 'csv-parse/sync'
import fs from 'fs'

const prisma = new PrismaClient()

const STANDARD_TEILE = [
  'Displaymodul', 'Tastatur', 'Touchpad', 'Füße vorne', 'Füße hinten',
  'D Cover', 'USB Board', 'Power Button', 'Lautsprecher', 'Lüfter',
  'Thermalmodul', 'BIOS Batterie', 'Akku',
]

// Deduplizierungs-Schlüssel: erster Word (Hersteller) + erste 2 Modell-Wörter
// "Lenovo ThinkPad T14 Gen 2i" → "lenovo thinkpad t14"
function dedupKey(bereinigt: string): string {
  return bereinigt.split(' ').slice(0, 3).join(' ').toLowerCase()
}

function bereinige(bezeichnung: string, hersteller: string = ''): string {
  let result = bezeichnung.trim()

  // 1. Alles ab " - " abschneiden (lange Beschreibungen)
  //    "Latitude 7490 (F) - 14"..." → "Latitude 7490 (F)"
  const dashIndex = result.indexOf(' - ')
  if (dashIndex > 10) {
    result = result.substring(0, dashIndex).trim()
  }

  // 2. Hersteller-Namen am Anfang entfernen wenn doppelt
  //    "Dell Latitude 7490" → "Latitude 7490"
  if (hersteller) {
    const herstellerPattern = new RegExp(`^${hersteller}\\s+`, 'i')
    result = result.replace(herstellerPattern, '').trim()
  }

  // 3. Business-Präfixe entfernen
  result = result.replace(/^Business-NB\s+/i,          '').trim()
  result = result.replace(/^Business-Convertible\s+/i, '').trim()
  result = result.replace(/^Business-Laptop\s+/i,      '').trim()
  result = result.replace(/^NB\s+/i,                   '').trim()

  // 4. Interne Codes am Ende entfernen (Lenovo)
  //    "ThinkPad T14 Gen 2i 20W1S06V00" → "ThinkPad T14 Gen 2i"
  //    Pattern: Leerzeichen + 6+ Zeichen nur Großbuchstaben/Ziffern
  let prev = ''
  while (prev !== result) {
    prev = result
    result = result.replace(/\s+[A-Z0-9]{6,}[-A-Z0-9]*$/, '').trim()
  }

  // 5. Klammern am Ende entfernen: "Latitude 7490 (F)" → "Latitude 7490"
  result = result.replace(/\s*\([^)]*\)\s*$/, '').trim()

  // 6. Wenn Ergebnis nur Zahlen → original behalten (z.B. "5490")
  if (/^\d+$/.test(result)) {
    return bezeichnung.trim()
  }

  return result
}

function getAnzeigename(hersteller: string, bereinigt: string): string {
  if (bereinigt.toLowerCase().startsWith(hersteller.toLowerCase())) {
    return bereinigt
  }
  return hersteller ? `${hersteller} ${bereinigt}` : bereinigt
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

      // Bezeichnung auf 500 Zeichen kürzen (DB-Limit)
      const bezeichnungSafe = bezeichnungRaw.substring(0, 500)

      // Bezeichnung bereinigen + Anzeigename zusammensetzen
      const bezeichnungBereinigt = bereinige(bezeichnungSafe, hersteller)
      const bereinigt = getAnzeigename(hersteller, bezeichnungBereinigt)

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

  // ─── Phase 2: Auto-Kompatibilität ─────────────────────────────────────────
  // DEAKTIVIERT: Kompatibilitäten werden manuell im Admin angelegt (/admin/modelle).
  // Der Import legt nur GeraeteLookup + GeraeteModell an — KEINE Kompatibilitäten.
  //
  // Grund: Automatisch angelegte Kompatibilitäten waren unzuverlässig und führten
  // zu falschen Verknüpfungen. Manuelle Pflege über die Admin-Oberfläche
  // mit Suchfeld pro Teiltyp ist deutlich präziser.
  //
  // console.log('🤖 Phase 2: Auto-Kompatibilität anlegen...\n')
  // ... [Block auskommentiert] ...

  console.log(`
  ─────────────────────────────────────────
  Phase 2 (Auto-Kompatibilität) übersprungen.
  Kompatibilitäten manuell in /admin/modelle anlegen.
  ─────────────────────────────────────────
  `)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

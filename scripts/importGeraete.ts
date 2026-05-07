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

  // ─── Phase 2: Auto-Kompatibilität anlegen ─────────────────────────────────
  console.log('🤖 Phase 2: Auto-Kompatibilität anlegen...\n')

  // Eindeutige bereinigte Gerätenamen sammeln
  const alleNamen = notebooks
    .map((r: Record<string, string>) => {
      const h = String(r['Hersteller'] || '').trim()
      const b = bereinige(String(r['Bezeichnung'] || '').trim())
      return h ? `${h} ${b}` : b
    })
    .filter(Boolean)

  // Deduplizieren: max 1 Name pro Hersteller+Modell-Basis
  const dedupMap = new Map<string, string>()
  for (const name of alleNamen) {
    const key = dedupKey(name)
    if (!dedupMap.has(key)) dedupMap.set(key, name)
  }

  const uniqueModelle = [...dedupMap.values()]
  console.log(`📊 ${alleNamen.length} Gerätenamen → ${uniqueModelle.length} nach Dedup (3-Wort-Schlüssel)`)

  let modelle_neu      = 0
  let modelle_vorhanden = 0
  let modelle_fehler   = 0
  let artikel_neu      = 0

  const BATCH = 100

  for (let i = 0; i < uniqueModelle.length; i += BATCH) {
    const batch = uniqueModelle.slice(i, i + BATCH)

    for (const name of batch) {
      const parts      = name.split(' ')
      const hersteller = parts[0] ?? ''
      const modell     = parts.slice(1).join(' ')

      if (!hersteller || !modell) continue

      try {
        const geraetVoll = `${hersteller} ${modell}`

        // Gerätemodell anlegen (upsert — kein Fehler bei Duplikaten)
        const gm = await prisma.geraeteModell.upsert({
          where:  { hersteller_modell: { hersteller, modell } },
          create: { hersteller, modell },
          update: {},
        })

        const war_vorhanden = gm.createdAt.getTime() !== gm.updatedAt.getTime()
        if (war_vorhanden) { modelle_vorhanden++; continue }
        modelle_neu++

        // 13 Standard-Artikel + Kompatibilitäts-Einträge anlegen
        for (const teil of STANDARD_TEILE) {
          const bezeichnung = `${modell} ${teil}`

          // Artikel nur anlegen wenn noch nicht vorhanden
          const vorher = await prisma.artikel.findUnique({
            where:  { bezeichnung_kategorie: { bezeichnung, kategorie: teil } },
            select: { id: true },
          })

          const artikel = vorher ?? await prisma.artikel.create({
            data: { bezeichnung, kategorie: teil, lagerplatz: null, bestand: 0 },
          })

          if (!vorher) artikel_neu++

          await prisma.kompatibilitaet.upsert({
            where:  { geraet_teiltyp: { geraet: geraetVoll, teiltyp: teil } },
            create: { geraet: geraetVoll, teiltyp: teil, artikelId: artikel.id },
            update: {},
          })
        }
      } catch (e) {
        modelle_fehler++
        if (modelle_fehler <= 3) console.error(`❌ Modell-Fehler: ${name}`, e)
      }
    }

    if (i % (BATCH * 5) === 0 && i > 0) {
      console.log(`⏳ Modelle: ${i}/${uniqueModelle.length} (${modelle_neu} neu)`)
    }
  }

  console.log(`
╔══════════════════════════════════════╗
║   Kompatibilität Auto-Import fertig  ║
╠══════════════════════════════════════╣
║ Neue Gerätemodelle:    ${String(modelle_neu).padStart(6)}      ║
║ Bereits vorhanden:     ${String(modelle_vorhanden).padStart(6)}      ║
║ Fehler:                ${String(modelle_fehler).padStart(6)}      ║
║ Neue Artikel angelegt: ${String(artikel_neu).padStart(6)}      ║
╚══════════════════════════════════════╝
  `)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

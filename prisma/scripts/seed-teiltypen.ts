/**
 * Seed: 17 Standard-Teiltypen.
 *
 * Ausführung:
 *   npx tsx prisma/scripts/seed-teiltypen.ts
 *
 * Idempotent: upsert auf Name. Bestehende Einträge bleiben unverändert
 * (update: {}) — Sortierung/Icon können danach im Admin-UI angepasst werden.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const STANDARDS = [
  { name: "Mainboard",        icon: "Cpu",               sortierung: 10  },
  { name: "Display",          icon: "Monitor",           sortierung: 20  },
  { name: "Displaymodul",     icon: "MonitorSmartphone", sortierung: 30  },
  { name: "Touchpad",         icon: "Mouse",             sortierung: 40  },
  { name: "Touchpad Buttons", icon: "Square",            sortierung: 50  },
  { name: "Tastatur",         icon: "Keyboard",          sortierung: 60  },
  { name: "Lautsprecher",     icon: "Volume2",           sortierung: 70  },
  { name: "Füße vorne",       icon: "CircleDot",         sortierung: 80  },
  { name: "Füße hinten",      icon: "CircleDot",         sortierung: 90  },
  { name: "Power Button",     icon: "Power",             sortierung: 100 },
  { name: "USB Board",        icon: "Usb",               sortierung: 110 },
  { name: "LAN Board",        icon: "Network",           sortierung: 120 },
  { name: "WLAN Karte",       icon: "Wifi",              sortierung: 130 },
  { name: "UMTS Karte",       icon: "Wifi",              sortierung: 140 },
  { name: "Akku",             icon: "Battery",           sortierung: 150 },
  { name: "D Cover",          icon: "Box",               sortierung: 160 },
  { name: "DC IN",            icon: "Plug",              sortierung: 170 },
  { name: "BIOS Batterie",    icon: "BatteryLow",        sortierung: 175 },
  { name: "B Cover",          icon: "Monitor",           sortierung: 180 },
  { name: "C Cover",          icon: "Keyboard",          sortierung: 185 },
  { name: "CPU Lüfter",       icon: "Fan",               sortierung: 190 },
  // Sammel-Kategorie mit Freitext — ans Ende (sortierung 999)
  { name: "Verschiedenes",    icon: "Package",           sortierung: 999 },
];

async function main() {
  let created = 0;
  let skipped = 0;
  for (const t of STANDARDS) {
    const result = await prisma.teiltyp.upsert({
      where:  { name: t.name },
      update: {}, // bestehende NICHT überschreiben
      create: { ...t, istStandard: true, aktiv: true },
    });
    if (result.erstelltAm.getTime() > Date.now() - 5_000) created++;
    else skipped++;
  }
  console.log(`[seed-teiltypen] ${created} angelegt, ${skipped} bereits vorhanden.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

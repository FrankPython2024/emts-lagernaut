/**
 * Seed: 22 Permissions + 3 System-Rollen (ADMIN, TECHNIKER, BETRACHTER).
 *
 * Ausführung:
 *   npx tsx prisma/scripts/seed-rbac.ts
 *
 * Idempotent. Bestehende Rollen/Permissions werden nicht überschrieben
 * (nur Bezeichnung/Kategorie der Permissions wird aktualisiert).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PERMISSIONS = [
  // Dashboard & Statistik
  { key: "DASHBOARD_VIEW",      kategorie: "Dashboard",   bezeichnung: "Admin-Dashboard sehen" },
  { key: "STATISTIK_VIEW",      kategorie: "Dashboard",   bezeichnung: "Statistiken einsehen" },
  { key: "AKTIVITAETSLOG_VIEW", kategorie: "Dashboard",   bezeichnung: "Aktivitäts-Log einsehen" },

  // Anfragen
  { key: "ANFRAGE_VIEW_ALL",    kategorie: "Anfragen",    bezeichnung: "Alle Anfragen sehen" },
  { key: "ANFRAGE_VIEW_EIGENE", kategorie: "Anfragen",    bezeichnung: "Eigene Anfragen sehen" },
  { key: "ANFRAGE_CREATE",      kategorie: "Anfragen",    bezeichnung: "Anfragen erstellen" },
  { key: "ANFRAGE_EDIT",        kategorie: "Anfragen",    bezeichnung: "Anfragen-Status ändern" },
  { key: "ANFRAGE_DELETE",      kategorie: "Anfragen",    bezeichnung: "Anfragen löschen" },
  { key: "ANFRAGE_AUSLAGERN",   kategorie: "Anfragen",    bezeichnung: "Auslager-Wizard nutzen" },

  // Artikel & Lager
  { key: "ARTIKEL_VIEW",        kategorie: "Lager",       bezeichnung: "Artikel-Liste sehen" },
  { key: "ARTIKEL_EDIT",        kategorie: "Lager",       bezeichnung: "Artikel bearbeiten" },
  { key: "ARTIKEL_EINLAGERN",   kategorie: "Lager",       bezeichnung: "Einlager-Assistent nutzen" },
  { key: "LAGERPLATZ_VIEW",     kategorie: "Lager",       bezeichnung: "Lagerplätze sehen" },
  { key: "LAGERPLATZ_EDIT",     kategorie: "Lager",       bezeichnung: "Lagerstruktur bearbeiten" },
  { key: "BUCHUNG_VIEW",        kategorie: "Lager",       bezeichnung: "Buchungs-Log sehen" },

  // Stammdaten
  { key: "MODELL_VIEW",         kategorie: "Stammdaten",  bezeichnung: "Gerätemodelle sehen" },
  { key: "MODELL_EDIT",         kategorie: "Stammdaten",  bezeichnung: "Gerätemodelle bearbeiten" },
  { key: "TEILTYP_EDIT",        kategorie: "Stammdaten",  bezeichnung: "Teiltypen verwalten" },
  { key: "STANDORT_EDIT",       kategorie: "Stammdaten",  bezeichnung: "Standorte verwalten" },

  // User & Rollen
  { key: "USER_VIEW",           kategorie: "Verwaltung",  bezeichnung: "User-Liste sehen" },
  { key: "USER_EDIT",           kategorie: "Verwaltung",  bezeichnung: "User anlegen/bearbeiten" },
  { key: "USER_PASSWORT_RESET", kategorie: "Verwaltung",  bezeichnung: "Passwörter zurücksetzen" },
  { key: "ROLLE_EDIT",          kategorie: "Verwaltung",  bezeichnung: "Rollen + Rechte verwalten" },

  // System
  { key: "STRESSTEST_RUN",      kategorie: "System",      bezeichnung: "Stresstest ausführen" },
  { key: "SYSTEM_ADMIN",        kategorie: "System",      bezeichnung: "Voll-Administrator (alle Rechte)" },
];

const ROLLEN = [
  {
    name:         "ADMIN",
    bezeichnung:  "Administrator",
    beschreibung: "Voller Zugriff auf alle Systemfunktionen",
    permissions:  ["SYSTEM_ADMIN"],
  },
  {
    name:         "TECHNIKER",
    bezeichnung:  "Techniker",
    beschreibung: "Anfragen erstellen und eigene verwalten",
    permissions:  ["ANFRAGE_VIEW_EIGENE", "ANFRAGE_CREATE"],
  },
  {
    name:         "BETRACHTER",
    bezeichnung:  "Betrachter",
    beschreibung: "Read-only Zugriff auf Statistiken und Bestände",
    permissions:  [
      "DASHBOARD_VIEW", "STATISTIK_VIEW",
      "ANFRAGE_VIEW_ALL",
      "ARTIKEL_VIEW", "LAGERPLATZ_VIEW", "BUCHUNG_VIEW",
      "MODELL_VIEW",
    ],
  },
];

async function main() {
  // 1) Permissions — Bezeichnung/Kategorie dürfen aktualisiert werden, key bleibt fest
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where:  { key: p.key },
      update: { bezeichnung: p.bezeichnung, kategorie: p.kategorie },
      create: p,
    });
  }
  console.log(`✓ ${PERMISSIONS.length} Permissions vorhanden`);

  // 2) Rollen + RollePermission — bestehende Rollen NICHT überschreiben (Frank
  //    könnte istSystem-Rollen bereits angepasst haben), nur Verknüpfungen
  //    idempotent ergänzen.
  for (const r of ROLLEN) {
    const rolle = await prisma.rolle.upsert({
      where:  { name: r.name },
      update: {},
      create: {
        name:         r.name,
        bezeichnung:  r.bezeichnung,
        beschreibung: r.beschreibung,
        istSystem:    true,
        aktiv:        true,
      },
    });

    for (const permKey of r.permissions) {
      const perm = await prisma.permission.findUnique({ where: { key: permKey } });
      if (!perm) continue;
      await prisma.rollePermission.upsert({
        where:  { rolleId_permissionId: { rolleId: rolle.id, permissionId: perm.id } },
        update: {},
        create: { rolleId: rolle.id, permissionId: perm.id },
      });
    }
    console.log(`✓ Rolle ${r.name}: ${r.permissions.length} Permissions verknüpft`);
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

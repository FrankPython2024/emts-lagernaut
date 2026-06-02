-- Migration: Rolle ADMIN_READONLY (Audit-Sicht, voller Lesezugriff, keine Schreibrechte)
--
-- Legt an:
--   1. erweitert das UserRolle-ENUM auf der Spalte User.rolle um 'ADMIN_READONLY'
--   2. die RBAC-Rolle 'ADMIN_READONLY'
--   3. die Permission-Zuordnungen (nur *_VIEW + Suche + Activity-Log;
--      KEINE Schreibrechte, KEIN USER_*/ROLLE_EDIT)
--
-- Voraussetzung: die 22 Permissions existieren bereits (seed-rbac.ts gelaufen).
-- Idempotent — mehrfaches Ausführen ist gefahrlos.
--
-- AUSFÜHRUNG (Produktiv-Server):
--   npx prisma db execute --schema prisma/schema.prisma --file prisma/scripts/migration-rolle-admin-readonly.sql
--
-- Alternativ (gleicher Effekt):
--   npx prisma db push            # erweitert das ENUM aus dem Schema
--   npx tsx prisma/scripts/seed-rbac.ts   # legt Rolle + Mappings idempotent an

-- 1) ENUM erweitern
ALTER TABLE `User`
  MODIFY COLUMN `rolle` ENUM('ADMIN','TECHNIKER','BETRACHTER','ADMIN_READONLY')
  NOT NULL DEFAULT 'TECHNIKER';

-- 2) Rolle anlegen (falls noch nicht vorhanden)
INSERT INTO `Rolle` (`name`, `bezeichnung`, `beschreibung`, `istSystem`, `aktiv`, `erstelltAm`)
SELECT 'ADMIN_READONLY',
       'Admin (nur Lesen)',
       'Voller Lesezugriff auf den Admin-Bereich (Audit), keine Schreibrechte. Ohne Benutzer-/Rollen-Verwaltung.',
       1, 1, NOW(3)
WHERE NOT EXISTS (SELECT 1 FROM `Rolle` WHERE `name` = 'ADMIN_READONLY');

-- 3) Permission-Zuordnungen (nur Lese-Rechte)
INSERT INTO `RollePermission` (`rolleId`, `permissionId`)
SELECT r.`id`, p.`id`
FROM `Rolle` r
JOIN `Permission` p
  ON p.`key` IN (
    'DASHBOARD_VIEW', 'STATISTIK_VIEW', 'AKTIVITAETSLOG_VIEW', 'SUCHE_GLOBAL',
    'ANFRAGE_VIEW_ALL',
    'ARTIKEL_VIEW', 'LAGERPLATZ_VIEW', 'BUCHUNG_VIEW',
    'MODELL_VIEW'
  )
WHERE r.`name` = 'ADMIN_READONLY'
  AND NOT EXISTS (
    SELECT 1 FROM `RollePermission` rp
    WHERE rp.`rolleId` = r.`id` AND rp.`permissionId` = p.`id`
  );

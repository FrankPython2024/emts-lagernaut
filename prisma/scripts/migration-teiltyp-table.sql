-- Migration: Teiltyp-Tabelle für DB-getriebene Teiltypen-Liste
--
-- Ersetzt die hartkodierte Liste in src/lib/constants/teiltypen.ts durch
-- editierbare DB-Einträge. Bestehende Anfrage.teil-Werte bleiben unverändert
-- (Text-Spalte, keine FK).
--
-- AUSFÜHRUNG: zwei Schritte — Tabelle anlegen, dann Seed-Skript fahren.
--
--   1) docker compose exec -T db mysql -ulagernaut -p"$PASS" lagernaut < migration-teiltyp-table.sql
--   2) docker compose exec -T app npx ts-node prisma/scripts/seed-teiltypen.ts
--      (oder via `npx prisma db seed` falls eingerichtet)
--
-- Alternative: `npx prisma migrate dev --name add_teiltyp_table` erzeugt
-- die Tabelle automatisch aus dem schema.prisma-Eintrag. Diese SQL-Variante
-- ist als manuelles Fallback / Production-Hotpath gedacht.

CREATE TABLE IF NOT EXISTS `Teiltyp` (
  `id`          INT          NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(191) NOT NULL,
  `icon`        VARCHAR(191) NULL,
  `istStandard` BOOLEAN      NOT NULL DEFAULT FALSE,
  `sortierung`  INT          NOT NULL DEFAULT 0,
  `aktiv`       BOOLEAN      NOT NULL DEFAULT TRUE,
  `erstelltAm`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `Teiltyp_name_key` (`name`),
  INDEX `Teiltyp_aktiv_sortierung_idx` (`aktiv`, `sortierung`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

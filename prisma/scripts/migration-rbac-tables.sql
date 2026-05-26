-- Migration: RBAC-Fundament (Rolle, Permission, RollePermission)
--
-- Phase 1+2 — nur Datenstruktur + Admin-Verwaltung. KEINE Verknüpfung mit
-- bestehender User-Tabelle, KEINE Änderung an `adminProcedure` / Berechtigungs-
-- Checks. Phase 3+4 folgen separat und schalten dann die produktive Nutzung.
--
-- AUSFÜHRUNG:
--
--   docker compose exec -T db mysqldump -ulagernaut -p"$PASS" lagernaut > backup_pre_rbac.sql
--   docker compose exec -T db mysql    -ulagernaut -p"$PASS" lagernaut < migration-rbac-tables.sql
--   docker compose exec -T app npx tsx prisma/scripts/seed-rbac.ts
--
-- Alternative: `npx prisma migrate dev --name add_rbac_tables`
--
-- Verifikation:
--
--   docker compose exec -T db mysql -ulagernaut -p"$PASS" lagernaut -e "SHOW TABLES LIKE 'R%';"

CREATE TABLE IF NOT EXISTS `Rolle` (
  `id`           INT          NOT NULL AUTO_INCREMENT,
  `name`         VARCHAR(50)  NOT NULL,
  `bezeichnung`  VARCHAR(100) NOT NULL,
  `beschreibung` VARCHAR(255) NULL,
  `istSystem`    TINYINT(1)   NOT NULL DEFAULT 0,
  `aktiv`        TINYINT(1)   NOT NULL DEFAULT 1,
  `erstelltAm`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `Rolle_name_key` (`name`),
  INDEX `Rolle_aktiv_idx` (`aktiv`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `Permission` (
  `id`           INT          NOT NULL AUTO_INCREMENT,
  `key`          VARCHAR(50)  NOT NULL,
  `bezeichnung`  VARCHAR(100) NOT NULL,
  `kategorie`    VARCHAR(50)  NOT NULL,
  `beschreibung` VARCHAR(255) NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `Permission_key_key` (`key`),
  INDEX `Permission_kategorie_idx` (`kategorie`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `RollePermission` (
  `id`           INT NOT NULL AUTO_INCREMENT,
  `rolleId`      INT NOT NULL,
  `permissionId` INT NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `RollePermission_rolleId_permissionId_key` (`rolleId`, `permissionId`),
  INDEX `RollePermission_rolleId_idx`      (`rolleId`),
  INDEX `RollePermission_permissionId_idx` (`permissionId`),

  CONSTRAINT `RollePermission_rolleId_fkey`
    FOREIGN KEY (`rolleId`)      REFERENCES `Rolle`      (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `RollePermission_permissionId_fkey`
    FOREIGN KEY (`permissionId`) REFERENCES `Permission` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

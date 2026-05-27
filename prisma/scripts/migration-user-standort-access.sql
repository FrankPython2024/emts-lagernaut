-- Migration: Mehrfach-Standort-Zuweisung pro User
-- Manuell ausführen:
--   docker compose exec -T db mysqldump -ulagernaut -p"$PASS" lagernaut > backup_pre_useraccess.sql
--   docker compose exec -T db mysql    -ulagernaut -p"$PASS" lagernaut < prisma/scripts/migration-user-standort-access.sql

-- 1) Wildcard-Flag auf User
ALTER TABLE `User`
  ADD COLUMN `alleStandorte` TINYINT(1) NOT NULL DEFAULT 0;

-- Bestehende ADMIN-User automatisch auf alleStandorte=true setzen
UPDATE `User` SET `alleStandorte` = 1 WHERE `rolle` = 'ADMIN';

-- 2) M:N-Tabelle: zusätzliche Standorte pro User (Hauptstandort bleibt in User.standortId)
CREATE TABLE IF NOT EXISTS `UserStandortAccess` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `userId`     INT NOT NULL,
  `standortId` INT NOT NULL,
  `erstelltAm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UserStandortAccess_userId_standortId_key` (`userId`, `standortId`),
  INDEX `UserStandortAccess_userId_idx` (`userId`),
  INDEX `UserStandortAccess_standortId_idx` (`standortId`),
  CONSTRAINT `UserStandortAccess_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE,
  CONSTRAINT `UserStandortAccess_standortId_fkey`
    FOREIGN KEY (`standortId`) REFERENCES `Standort` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

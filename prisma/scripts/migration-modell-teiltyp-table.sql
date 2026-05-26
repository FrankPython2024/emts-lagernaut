-- Migration: ModellTeiltyp-Join-Tabelle für modell-spezifische zusätzliche Teiltypen
--
-- Standards (Teiltyp.istStandard=true) gelten weiterhin für ALLE Modelle.
-- Diese Tabelle erlaubt zusätzlich pro Modell weitere Custom-Teiltypen
-- zu aktivieren.
--
-- Beim Löschen eines Modells oder Teiltyps werden die Verknüpfungen
-- automatisch gelöscht (ON DELETE CASCADE).
--
-- AUSFÜHRUNG:
--
--   docker compose exec -T db mysqldump -ulagernaut -p"$PASS" lagernaut > backup_pre_modell_teiltyp.sql
--   docker compose exec -T db mysql    -ulagernaut -p"$PASS" lagernaut < migration-modell-teiltyp-table.sql
--
-- Alternative: `npx prisma migrate dev --name add_modell_teiltyp_table`
--
-- Verifikation:
--
--   docker compose exec -T db mysql -ulagernaut -p"$PASS" lagernaut -e "SHOW TABLES LIKE 'ModellTeiltyp';"

CREATE TABLE IF NOT EXISTS `ModellTeiltyp` (
  `id`         INT         NOT NULL AUTO_INCREMENT,
  `modellId`   INT         NOT NULL,
  `teiltypId`  INT         NOT NULL,
  `erstelltAm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `ModellTeiltyp_modellId_teiltypId_key` (`modellId`, `teiltypId`),
  INDEX `ModellTeiltyp_modellId_idx`  (`modellId`),
  INDEX `ModellTeiltyp_teiltypId_idx` (`teiltypId`),

  CONSTRAINT `ModellTeiltyp_modellId_fkey`
    FOREIGN KEY (`modellId`) REFERENCES `GeraeteModell` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ModellTeiltyp_teiltypId_fkey`
    FOREIGN KEY (`teiltypId`) REFERENCES `Teiltyp` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

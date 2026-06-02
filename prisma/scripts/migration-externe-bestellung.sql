-- Migration: ExterneBestellung-Tabelle für das Bestell-Empfehlungs-System
--
-- Manuelle Erfassung dessen, was extern (z.B. bei Refurbished-Händlern) für
-- NICHT_VERFUEGBAR-Anfragen nachbestellt wurde. Gruppierungs-Schlüssel ist
-- (modellName, teiltyp) — Anfrage trägt kein modellId-FK, sondern das Modell
-- nur als String (geraeteName); genau dieser String wird hier gespeichert,
-- damit Anfragen-Aggregat und Bestell-Summe exakt matchen.
--
-- erstelltVon → User.kuerzel (kuerzel ist UNIQUE).
--
-- AUSFÜHRUNG:
--
--   docker compose exec -T db mysqldump -ulagernaut -p"$PASS" lagernaut > backup_pre_externe_bestellung.sql
--   docker compose exec -T db mysql    -ulagernaut -p"$PASS" lagernaut < migration-externe-bestellung.sql
--
-- Alternative (gleicher Effekt, da kein migrations-Verzeichnis genutzt wird):
--   npx prisma db push
--
-- Verifikation:
--   docker compose exec -T db mysql -ulagernaut -p"$PASS" lagernaut -e "SHOW TABLES LIKE 'ExterneBestellung';"

CREATE TABLE IF NOT EXISTS `ExterneBestellung` (
  `id`          INT          NOT NULL AUTO_INCREMENT,
  `modellName`  VARCHAR(500) NOT NULL,
  `hersteller`  VARCHAR(191) NULL,
  `teiltyp`     VARCHAR(191) NOT NULL,
  `anzahl`      INT          NOT NULL,
  `bestelltAm`  DATETIME(3)  NOT NULL,
  `notiz`       TEXT         NULL,
  `erstelltVon` VARCHAR(191) NOT NULL,
  `erstelltAm`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `ExterneBestellung_modellName_teiltyp_idx` (`modellName`, `teiltyp`),
  INDEX `ExterneBestellung_erstelltVon_idx` (`erstelltVon`),

  CONSTRAINT `ExterneBestellung_erstelltVon_fkey`
    FOREIGN KEY (`erstelltVon`) REFERENCES `User` (`kuerzel`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ════════════════════════════════════════════════════════════════════════════
-- Migration: Mehrere Modelle pro Fach — PHASE 1 (additiv, rückrollbar)
-- ════════════════════════════════════════════════════════════════════════════
-- Geschäftsregel: 1 Fach = mehrere Modelle DESSELBEN Herstellers, max 4 Modelle.
-- 1 Modell = 1 Box → Kapazität = COUNT(belegungen) < 4.
--
-- PHASE 1 legt die Belegungs-Tabelle an und übernimmt bestehende 1:1-Belegungen.
-- Die alte Spalte Lagerplatz.modellId BLEIBT vorerst erhalten (Rollback möglich).
-- Erst nach grüner Verifikation + Test läuft Phase 2 (Spalten-Drop).
--
-- VOR dem Einspielen: Backup!
--   docker compose exec -T db mysqldump -ulagernaut -p"$PASS" lagernaut > backup_pre_belegung.sql
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Belegungs-Tabelle (additiv)
CREATE TABLE IF NOT EXISTS `LagerplatzBelegung` (
  `id`           INT NOT NULL AUTO_INCREMENT,
  `lagerplatzId` INT NOT NULL,
  `modellId`     INT NOT NULL,
  `erstelltAm`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `LagerplatzBelegung_modellId_key` (`modellId`),
  INDEX `LagerplatzBelegung_lagerplatzId_idx` (`lagerplatzId`),
  CONSTRAINT `LagerplatzBelegung_lagerplatzId_fkey`
    FOREIGN KEY (`lagerplatzId`) REFERENCES `lagerplatz`(`id`) ON DELETE CASCADE,
  CONSTRAINT `LagerplatzBelegung_modellId_fkey`
    FOREIGN KEY (`modellId`) REFERENCES `GeraeteModell`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2) Backfill: bestehende 1:1-Belegungen 1:1 übernehmen (kein Datenverlust)
--    INSERT IGNORE schützt vor Doppel-Einspielung (modellId @unique).
INSERT IGNORE INTO `LagerplatzBelegung` (`lagerplatzId`, `modellId`)
SELECT `id`, `modellId` FROM `lagerplatz` WHERE `modellId` IS NOT NULL;

-- ── Verifikation (manuell ausführen) ────────────────────────────────────────
-- Muss die GLEICHE Zahl liefern wie die bestehenden belegten Fächer:
--   SELECT COUNT(*) AS belegungen FROM LagerplatzBelegung;
--   SELECT COUNT(*) AS alt_belegt FROM lagerplatz WHERE modellId IS NOT NULL;
-- Beide Zahlen müssen identisch sein, bevor Phase 2 läuft.

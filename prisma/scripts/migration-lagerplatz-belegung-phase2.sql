-- ════════════════════════════════════════════════════════════════════════════
-- Migration: Mehrere Modelle pro Fach — PHASE 2 (Spalten-Drop)
-- ════════════════════════════════════════════════════════════════════════════
-- ERST AUSFÜHREN nach:
--   1. Phase 1 eingespielt + grüne Verifikation (Belegungs-Count == alt_belegt)
--   2. Code deployed + Test bestanden (Einlagern/Grid/Auslagern ok)
--
-- Entfernt die alte 1:1-Spalte Lagerplatz.modellId samt FK + Unique-Index.
-- Danach ist die Belegungs-Tabelle die einzige Wahrheit.
--
-- ⚠️ FK- und Index-Namen VORHER prüfen — können je nach Erstellung abweichen:
--     SHOW CREATE TABLE lagerplatz;
--   Die exakten Namen unten ggf. anpassen.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Foreign Key lösen (Name aus SHOW CREATE TABLE verifizieren)
ALTER TABLE `lagerplatz` DROP FOREIGN KEY `lagerplatz_modellId_fkey`;

-- 2) Unique-Index lösen (Prisma-Konvention: <table>_<col>_key)
ALTER TABLE `lagerplatz` DROP INDEX `lagerplatz_modellId_key`;

-- 3) Spalte entfernen
ALTER TABLE `lagerplatz` DROP COLUMN `modellId`;

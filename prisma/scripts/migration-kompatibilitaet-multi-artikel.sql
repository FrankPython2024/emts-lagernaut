-- Multi-Artikel-Verknüpfung: mehrere Artikel pro (geraet, teiltyp) erlauben.
--
-- VOR dem Ausführen den exakten alten Index-Namen prüfen:
--   SHOW CREATE TABLE `Kompatibilitaet`;
-- Prisma-Default für @@unique([geraet, teiltyp]) ist
-- `Kompatibilitaet_geraet_teiltyp_key` — ggf. anpassen.
--
-- Rückwärtskompatibel: bestehende Zeilen bleiben gültig (jede (geraet, teiltyp)
-- hatte bisher genau einen Artikel → ist auch unter dem neuen 3-Spalten-Key
-- eindeutig). Empfohlen: vorher `mysqldump` als Backup.

-- 1. Alten unique-Index (geraet, teiltyp) droppen
ALTER TABLE `Kompatibilitaet`
  DROP INDEX `Kompatibilitaet_geraet_teiltyp_key`;

-- 2. Neuen unique-Index (geraet, teiltyp, artikelId) anlegen
--    → verhindert nur noch EXAKTE Duplikate, erlaubt mehrere Artikel pro Teil
ALTER TABLE `Kompatibilitaet`
  ADD UNIQUE KEY `Kompatibilitaet_geraet_teiltyp_artikelId_key`
  (`geraet`, `teiltyp`, `artikelId`);

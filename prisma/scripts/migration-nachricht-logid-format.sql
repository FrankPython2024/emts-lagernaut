-- Migration: Nachricht.logId von Clean- auf Punkt-Format vereinheitlichen
--
-- Hintergrund: Anfrage.logId ist konsistent mit Punkten ("212.757.577"),
-- Nachricht.logId enthielt teilweise das Clean-Format ("212757577"). Das
-- führte dazu dass Cross-Tabellen-Joins über logId nicht matchten.
--
-- Diese Migration vereinheitlicht alle 9-stelligen, rein-numerischen Einträge
-- in Nachricht.logId auf das Punkt-Format.
--
-- Chat-Konvention "chat:{anfrageId}" und andere Sonderformate bleiben
-- unangetastet, da die WHERE-Klausel nur rein-numerische 9-stellige
-- Einträge ohne Punkt trifft.
--
-- AUSFÜHRUNG: manuell durch den Admin, idealerweise mit DB-Backup davor.
--
--   docker compose exec -T db mysqldump -ulagernaut -p"$PASS" lagernaut Nachricht > backup_nachricht.sql
--   docker compose exec -T db mysql    -ulagernaut -p"$PASS" lagernaut < migration-nachricht-logid-format.sql
--
-- Verifikation nach Ausführung:
--
--   SELECT logId FROM Nachricht
--     WHERE logId IS NOT NULL
--       AND logId NOT LIKE '%.%'
--       AND logId REGEXP '^[0-9]{9}$';
--
-- → sollte leer sein.

UPDATE Nachricht
   SET logId = CONCAT(
         SUBSTRING(logId, 1, 3), '.',
         SUBSTRING(logId, 4, 3), '.',
         SUBSTRING(logId, 7, 3)
       )
 WHERE logId IS NOT NULL
   AND logId NOT LIKE '%.%'
   AND CHAR_LENGTH(logId) = 9
   AND logId REGEXP '^[0-9]+$';

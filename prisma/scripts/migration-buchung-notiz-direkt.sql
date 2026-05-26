-- Migration: Buchung.notiz — irreführenden DIREKT-Zusatz entfernen
--
-- DIREKT-Buchungen wurden bisher mit dem Zusatz "(Techniker hat selbst
-- ausgebaut)" geschrieben. Sachlich falsch — DIREKT ist Pass-Through
-- (Eingang+Ausgang netto 0), nicht "selbst ausgebaut".
--
-- Quellcode wurde in src/server/routers/auslagern.ts gefixt. Diese
-- Migration räumt die bestehenden Datensätze nach.
--
-- AUSFÜHRUNG: manuell durch den Admin, idealerweise mit DB-Backup davor.
--
--   docker compose exec -T db mysqldump -ulagernaut -p"$PASS" lagernaut Buchung > backup_buchung_notiz.sql
--   docker compose exec -T db mysql    -ulagernaut -p"$PASS" lagernaut < migration-buchung-notiz-direkt.sql
--
-- Verifikation:
--
--   SELECT COUNT(*) FROM Buchung WHERE notiz LIKE '%selbst ausgebaut%';
--
-- → sollte 0 sein.

UPDATE Buchung
   SET notiz = REPLACE(notiz, ' (Techniker hat selbst ausgebaut)', '')
 WHERE notiz LIKE '%(Techniker hat selbst ausgebaut)%';

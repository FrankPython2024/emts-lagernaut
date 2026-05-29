-- Neuer AnfrageStatus-Wert NICHT_VERFUEGBAR ("Ersatzteil nicht beschaffbar").
--
-- Prisma speichert Enums als MySQL-ENUM-Spalte. Der neue Wert wird am ENDE
-- angehängt — die bestehende Reihenfolge bleibt erhalten, damit gespeicherte
-- Werte unverändert gültig sind. Vorher Backup (mysqldump) empfohlen.
--
-- Reihenfolge entspricht der aktuellen schema.prisma-Definition:
--   NEU, BEDARF, IN_BEARBEITUNG, ABGESCHLOSSEN, STORNIERT (+ NICHT_VERFUEGBAR)

ALTER TABLE `Anfrage`
  MODIFY COLUMN `status`
  ENUM('NEU','BEDARF','IN_BEARBEITUNG','ABGESCHLOSSEN','STORNIERT','NICHT_VERFUEGBAR')
  NOT NULL DEFAULT 'NEU';

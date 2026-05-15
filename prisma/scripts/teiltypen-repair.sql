-- ============================================================
-- Lagernaut v2 — Teiltypen-Reparatur
-- Fügt fehlende Standard-Artikel + Kompatibilitaet-Eintraege
-- für Modelle nach, die mit der alten 13er-Liste angelegt wurden.
--
-- Ausführen NACH Backup:
--   docker compose exec -T db mysqldump -ulagernaut -plagernaut lagernaut \
--     > backup-vor-teiltypen-repair-$(date +%Y%m%d-%H%M).sql
--
-- Dann ausführen:
--   docker compose exec -T db mysql -ulagernaut -plagernaut \
--     --default-character-set=utf8mb4 lagernaut \
--     < prisma/scripts/teiltypen-repair.sql
-- ============================================================

START TRANSACTION;

-- ── AUDIT VOR REPARATUR ───────────────────────────────────────────────────────
SELECT '=== AUDIT VOR REPARATUR ===' AS info;

-- Modelle mit weniger als 17 Standard-Teilen
SELECT m.id, m.hersteller, m.modell, COUNT(DISTINCT k.teiltyp) AS anzahl_teile
  FROM GeraeteModell m
  LEFT JOIN Kompatibilitaet k ON k.geraet = m.modell
    AND k.teiltyp IN (
      'Mainboard','Display','Displaymodul','Touchpad','Touchpad Buttons',
      'Tastatur','Lautsprecher','Füße hinten','Füße vorne','Power Button',
      'USB Board','LAN Board','WLAN Karte','UMTS Karte','Akku','D Cover','DC IN'
    )
  WHERE m.aktiv = TRUE
  GROUP BY m.id, m.hersteller, m.modell
  HAVING anzahl_teile < 17
  ORDER BY anzahl_teile ASC, m.modell ASC
  LIMIT 30;

-- Gesamtzahl Modelle mit < 17 Teilen
SELECT COUNT(*) AS modelle_unter_17
  FROM (
    SELECT m.id
      FROM GeraeteModell m
      LEFT JOIN Kompatibilitaet k ON k.geraet = m.modell
        AND k.teiltyp IN (
          'Mainboard','Display','Displaymodul','Touchpad','Touchpad Buttons',
          'Tastatur','Lautsprecher','Füße hinten','Füße vorne','Power Button',
          'USB Board','LAN Board','WLAN Karte','UMTS Karte','Akku','D Cover','DC IN'
        )
      WHERE m.aktiv = TRUE
      GROUP BY m.id
      HAVING COUNT(DISTINCT k.teiltyp) < 17
  ) t;

-- ── REPARATUR ─────────────────────────────────────────────────────────────────
-- Für jeden fehlenden Teiltyp pro aktivem Modell:
-- 1. Artikel anlegen (falls nicht vorhanden)
-- 2. Kompatibilitaet-Eintrag anlegen (falls nicht vorhanden)
--
-- Hinweis: Da MySQL kein einfaches FOR EACH über dynamische Daten hat,
-- machen wir das pro Teiltyp in separaten Statements.
-- UNIQUE-Constraint auf Kompatibilitaet (geraet, teiltyp) verhindert Duplikate.

-- Hilfsprozedur (temporär)
DROP PROCEDURE IF EXISTS repair_teiltyp;

DELIMITER $$
CREATE PROCEDURE repair_teiltyp(IN teiltyp_name VARCHAR(100))
BEGIN
  -- Für jedes aktive Modell das diesen Teiltyp noch nicht hat:
  -- Artikel anlegen (idempotent via INSERT IGNORE)
  INSERT IGNORE INTO Artikel (bezeichnung, kategorie, bestand, lagerplatz, createdAt, updatedAt)
    SELECT
      CONCAT(m.modell, ' ', teiltyp_name) AS bezeichnung,
      teiltyp_name                         AS kategorie,
      0                                    AS bestand,
      NULL                                 AS lagerplatz,
      NOW()                                AS createdAt,
      NOW()                                AS updatedAt
    FROM GeraeteModell m
    WHERE m.aktiv = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM Kompatibilitaet k
          WHERE k.geraet = m.modell AND k.teiltyp = teiltyp_name
      );

  -- Kompatibilitaet-Eintrag anlegen (idempotent via INSERT IGNORE)
  INSERT IGNORE INTO Kompatibilitaet (geraet, teiltyp, artikelId)
    SELECT
      m.modell   AS geraet,
      teiltyp_name AS teiltyp,
      a.id         AS artikelId
    FROM GeraeteModell m
    JOIN Artikel a ON a.bezeichnung = CONCAT(m.modell, ' ', teiltyp_name)
                   AND a.kategorie = teiltyp_name
    WHERE m.aktiv = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM Kompatibilitaet k
          WHERE k.geraet = m.modell AND k.teiltyp = teiltyp_name
      );
END$$
DELIMITER ;

-- Alle 17 Teiltypen reparieren
CALL repair_teiltyp('Mainboard');
CALL repair_teiltyp('Display');
CALL repair_teiltyp('Displaymodul');
CALL repair_teiltyp('Touchpad');
CALL repair_teiltyp('Touchpad Buttons');
CALL repair_teiltyp('Tastatur');
CALL repair_teiltyp('Lautsprecher');
CALL repair_teiltyp('Füße hinten');
CALL repair_teiltyp('Füße vorne');
CALL repair_teiltyp('Power Button');
CALL repair_teiltyp('USB Board');
CALL repair_teiltyp('LAN Board');
CALL repair_teiltyp('WLAN Karte');
CALL repair_teiltyp('UMTS Karte');
CALL repair_teiltyp('Akku');
CALL repair_teiltyp('D Cover');
CALL repair_teiltyp('DC IN');

-- Aufräumen
DROP PROCEDURE IF EXISTS repair_teiltyp;

-- ── AUDIT NACH REPARATUR ──────────────────────────────────────────────────────
SELECT '=== AUDIT NACH REPARATUR ===' AS info;

SELECT COUNT(*) AS modelle_unter_17_nach_repair
  FROM (
    SELECT m.id
      FROM GeraeteModell m
      LEFT JOIN Kompatibilitaet k ON k.geraet = m.modell
        AND k.teiltyp IN (
          'Mainboard','Display','Displaymodul','Touchpad','Touchpad Buttons',
          'Tastatur','Lautsprecher','Füße hinten','Füße vorne','Power Button',
          'USB Board','LAN Board','WLAN Karte','UMTS Karte','Akku','D Cover','DC IN'
        )
      WHERE m.aktiv = TRUE
      GROUP BY m.id
      HAVING COUNT(DISTINCT k.teiltyp) < 17
  ) t;

-- Gesamt Neue Artikel angelegt (Bestand 0, alle neuen Standard-Teile)
SELECT COUNT(*) AS neue_artikel
  FROM Artikel
  WHERE bestand = 0
    AND kategorie IN (
      'Mainboard','Display','Touchpad Buttons','LAN Board',
      'WLAN Karte','UMTS Karte','DC IN'
    )
    AND createdAt >= DATE_SUB(NOW(), INTERVAL 1 MINUTE);

COMMIT;

SELECT '=== REPARATUR ABGESCHLOSSEN ===' AS info;
SELECT 'Alle Modelle sollten jetzt 17 Standard-Teiltypen haben.' AS hinweis;

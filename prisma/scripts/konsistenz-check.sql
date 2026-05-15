-- ============================================================
-- Lagernaut v2 — Daten-Konsistenz-Checks
-- Ausführen via:
--   docker compose exec -T db mysql -ulagernaut -plagernaut \
--     --default-character-set=utf8mb4 lagernaut \
--     < prisma/scripts/konsistenz-check.sql
-- Ideal: alle Counts = 0
-- ============================================================

SELECT '=== LAGERNAUT KONSISTENZ-CHECK ===' AS '---';
SELECT NOW() AS Zeitpunkt;

-- ── (1) Aktive Modelle mit unerlaubtem Hersteller ─────────────────────────────
SELECT '(1) Aktive Modelle mit unerlaubtem Hersteller (Soll: 0)' AS Check_01;
SELECT COUNT(*) AS Anzahl
  FROM GeraeteModell
  WHERE aktiv = TRUE
    AND hersteller NOT IN ('HP', 'Lenovo', 'Dell', 'Fujitsu');

-- Welche?
SELECT id, hersteller, modell
  FROM GeraeteModell
  WHERE aktiv = TRUE
    AND hersteller NOT IN ('HP', 'Lenovo', 'Dell', 'Fujitsu')
  LIMIT 20;

-- ── (2) Aktive Modelle mit Hersteller-Prefix in Bezeichnung ──────────────────
-- z.B. "HP EliteBook 840 G5" statt "EliteBook 840 G5"
SELECT '(2) Aktive Modelle mit Hersteller-Prefix in Bezeichnung (Soll: 0)' AS Check_02;
SELECT COUNT(*) AS Anzahl
  FROM GeraeteModell
  WHERE aktiv = TRUE
    AND (
      modell LIKE 'HP %'
      OR modell LIKE 'Lenovo %'
      OR modell LIKE 'Dell %'
      OR modell LIKE 'Fujitsu %'
    );

SELECT id, hersteller, modell
  FROM GeraeteModell
  WHERE aktiv = TRUE
    AND (modell LIKE 'HP %' OR modell LIKE 'Lenovo %'
         OR modell LIKE 'Dell %' OR modell LIKE 'Fujitsu %')
  LIMIT 20;

-- ── (3) Orphan-Artikel (Artikel ohne passende Kompatibilitaet) ────────────────
SELECT '(3) Artikel ohne Kompatibilitaets-Eintrag (Soll: nahe 0)' AS Check_03;
SELECT COUNT(*) AS Anzahl
  FROM Artikel a
  WHERE NOT EXISTS (
    SELECT 1 FROM Kompatibilitaet k WHERE k.artikelId = a.id
  )
  AND a.bestand > 0;

-- ── (4) Buchungen mit negativem Bestand-Effekt (Inkonsistenz) ────────────────
SELECT '(4) Artikel mit negativem Bestand (Soll: 0)' AS Check_04;
SELECT COUNT(*) AS Anzahl
  FROM Artikel
  WHERE bestand < 0;

SELECT id, bezeichnung, bestand
  FROM Artikel
  WHERE bestand < 0
  LIMIT 10;

-- ── (5) Kompatibilitaets-Eintraege ohne existenten Artikel ───────────────────
SELECT '(5) Kompatibilitaet-Eintraege mit ungueltigem artikelId (Soll: 0)' AS Check_05;
SELECT COUNT(*) AS Anzahl
  FROM Kompatibilitaet k
  WHERE NOT EXISTS (
    SELECT 1 FROM Artikel a WHERE a.id = k.artikelId
  );

SELECT k.id, k.geraet, k.teiltyp, k.artikelId
  FROM Kompatibilitaet k
  WHERE NOT EXISTS (SELECT 1 FROM Artikel a WHERE a.id = k.artikelId)
  LIMIT 10;

-- ── (6) Lagerplaetze mit deaktiviertem Modell (Phantom-Belegung) ─────────────
SELECT '(6) Lagerplaetze mit inaktivem Modell (Soll: 0)' AS Check_06;
SELECT COUNT(*) AS Anzahl
  FROM lagerplatz l
  JOIN GeraeteModell m ON l.modellId = m.id
  WHERE m.aktiv = FALSE;

SELECT l.code, l.modellId, m.modell, m.hersteller, m.deaktiviertGrund
  FROM lagerplatz l
  JOIN GeraeteModell m ON l.modellId = m.id
  WHERE m.aktiv = FALSE
  LIMIT 10;

-- ── (7) Bestand-Konsistenz via Buchungs-History ──────────────────────────────
-- Vergleicht gespeicherten Bestand mit Summe aus Buchungs-History
SELECT '(7) Artikel mit abweichendem Bestand (Soll: 0)' AS Check_07;
SELECT COUNT(*) AS Anzahl
  FROM Artikel a
  WHERE a.bestand != COALESCE((
    SELECT SUM(CASE b.typ
      WHEN 'EINGANG' THEN  b.menge
      WHEN 'AUSGANG' THEN -b.menge
      ELSE 0
    END)
    FROM Buchung b
    WHERE b.artikelId = a.id
      AND b.typ IN ('EINGANG', 'AUSGANG')
  ), 0);

-- Top 10 Abweichungen
SELECT a.id, a.bezeichnung, a.bestand AS gespeichert,
       COALESCE(SUM(CASE b.typ
         WHEN 'EINGANG' THEN  b.menge
         WHEN 'AUSGANG' THEN -b.menge
         ELSE 0
       END), 0) AS aus_history,
       (a.bestand - COALESCE(SUM(CASE b.typ
         WHEN 'EINGANG' THEN  b.menge
         WHEN 'AUSGANG' THEN -b.menge
         ELSE 0
       END), 0)) AS differenz
  FROM Artikel a
  LEFT JOIN Buchung b ON b.artikelId = a.id AND b.typ IN ('EINGANG', 'AUSGANG')
  GROUP BY a.id, a.bezeichnung, a.bestand
  HAVING differenz != 0
  ORDER BY ABS(differenz) DESC
  LIMIT 10;

-- ── (8) Bestand-Summe pro Hersteller (Sanity-Check) ──────────────────────────
SELECT '(8) Bestand-Summe pro Hersteller (Uebersicht)' AS Check_08;
SELECT
    SUBSTRING_INDEX(a.bezeichnung, ' ', 1) AS Hersteller_guess,
    COUNT(*)                               AS Artikel_Anzahl,
    SUM(a.bestand)                         AS Gesamt_Bestand,
    SUM(CASE WHEN a.bestand = 0 THEN 1 ELSE 0 END) AS Artikel_Leer
  FROM Artikel a
  GROUP BY SUBSTRING_INDEX(a.bezeichnung, ' ', 1)
  ORDER BY Gesamt_Bestand DESC
  LIMIT 10;

-- ── (9) Case-Duplikate in aktiven Modellen ───────────────────────────────────
SELECT '(9) Case-Duplikate in aktiven Modellen (Soll: 0)' AS Check_09;
SELECT COUNT(*) AS Anzahl
  FROM (
    SELECT LOWER(modell) AS m_lower, LOWER(hersteller) AS h_lower, COUNT(*) AS cnt
      FROM GeraeteModell
      WHERE aktiv = TRUE
      GROUP BY LOWER(modell), LOWER(hersteller)
      HAVING cnt > 1
  ) t;

SELECT LOWER(modell) AS modell_lower, LOWER(hersteller) AS hersteller_lower, COUNT(*) AS Duplikate
  FROM GeraeteModell
  WHERE aktiv = TRUE
  GROUP BY LOWER(modell), LOWER(hersteller)
  HAVING COUNT(*) > 1
  ORDER BY Duplikate DESC
  LIMIT 10;

-- ── (10) Buchungen mit ungueltigem typ ───────────────────────────────────────
SELECT '(10) Buchungen mit ungueltigem Typ (Soll: 0)' AS Check_10;
SELECT COUNT(*) AS Anzahl
  FROM Buchung
  WHERE typ NOT IN ('EINGANG', 'AUSGANG', 'DIREKT');

-- ── ABSCHLUSS ─────────────────────────────────────────────────────────────────
SELECT '=== CHECK ABGESCHLOSSEN ===' AS '---';
SELECT 'Alle Counts sollten 0 sein. Abweichungen beduerften manueller Prüfung.' AS Hinweis;

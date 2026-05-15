-- ============================================================
-- PHASE 3b: Soft-Delete Drift-Modelle
-- Ausführen NACH Schema-Migration (deaktiviertGrund/Am-Spalten)
-- Befehl:
--   docker compose exec -T db mysql -ulagernaut -plagernaut \
--     --default-character-set=utf8mb4 lagernaut \
--     < prisma/scripts/soft-delete-drift.sql
-- ============================================================

SELECT '=== AUDIT VOR DEAKTIVIERUNG ===' AS info;
SELECT hersteller, COUNT(*) AS anzahl
  FROM GeraeteModell
  WHERE aktiv = TRUE
  GROUP BY hersteller
  ORDER BY anzahl DESC;

-- ── (1) Schema-Spalten anlegen (idempotent via IF NOT EXISTS) ──────────────
-- Nur nötig wenn Schema-Migration noch nicht lief:
-- ALTER TABLE GeraeteModell
--   ADD COLUMN IF NOT EXISTS deaktiviertGrund VARCHAR(191) NULL,
--   ADD COLUMN IF NOT EXISTS deaktiviertAm    DATETIME(3) NULL,
--   ADD INDEX IF NOT EXISTS idx_modell_aktiv (aktiv);

-- ── (2) Nicht-Whitelist-Hersteller deaktivieren ────────────────────────────
UPDATE GeraeteModell
SET   aktiv            = FALSE,
      deaktiviertGrund = 'Drift-Hersteller: nicht im AfB-Portfolio',
      deaktiviertAm    = NOW(3)
WHERE hersteller NOT IN ('HP', 'Lenovo', 'Dell', 'Fujitsu')
  AND aktiv = TRUE;

-- ── (3) Tippfehler-Marken deaktivieren ────────────────────────────────────
UPDATE GeraeteModell
SET   aktiv            = FALSE,
      deaktiviertGrund = 'Tippfehler-Variante (Fujjtsu/HPö/HP250) — durch korrekten Hersteller ersetzt',
      deaktiviertAm    = NOW(3)
WHERE hersteller IN ('Fujjtsu', 'HPö', 'HP250')
  AND aktiv = TRUE;

-- ── (4) Apple-Modelle die fälschlich unter Dell stehen ────────────────────
UPDATE GeraeteModell
SET   aktiv            = FALSE,
      deaktiviertGrund = 'Falsch klassifiziert: Apple-Modell als Dell eingetragen',
      deaktiviertAm    = NOW(3)
WHERE hersteller = 'Dell'
  AND modell REGEXP '^(Pro [0-9]+|Pro Max [0-9]+)$'
  AND aktiv = TRUE;

-- ── (5) Optionaler DB-Constraint (erst nach Bereinigung!) ─────────────────
-- Sicherstellen dass keine Case-Duplikate mehr existieren:
-- SELECT LOWER(modell), LOWER(hersteller), COUNT(*)
--   FROM GeraeteModell WHERE aktiv = TRUE
--   GROUP BY LOWER(modell), LOWER(hersteller)
--   HAVING COUNT(*) > 1;
--
-- Erst wenn obige Query 0 Zeilen liefert:
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_modell_case_unique
--   ON GeraeteModell ((LOWER(modell)), (LOWER(hersteller)));

-- ── AUDIT NACHHER ──────────────────────────────────────────────────────────
SELECT '=== AUDIT NACH DEAKTIVIERUNG ===' AS info;
SELECT hersteller, COUNT(*) AS aktiv_anzahl
  FROM GeraeteModell
  WHERE aktiv = TRUE
  GROUP BY hersteller
  ORDER BY aktiv_anzahl DESC;

SELECT '=== DEAKTIVIERT GESAMT ===' AS info;
SELECT COUNT(*) AS deaktiviert_total FROM GeraeteModell WHERE aktiv = FALSE;

SELECT '=== DEAKTIVIERT NACH GRUND ===' AS info;
SELECT deaktiviertGrund, COUNT(*) AS anzahl
  FROM GeraeteModell
  WHERE aktiv = FALSE
  GROUP BY deaktiviertGrund;

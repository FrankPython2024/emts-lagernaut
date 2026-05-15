-- ============================================================
-- Lagernaut v2 — Phantom-Lagerplatz-Reparatur
-- Gibt Lagerplätze frei, die noch mit deaktivierten Modellen
-- verknüpft sind (vor diesem Fix entstanden).
--
-- Ausführen NACH Backup:
--   docker compose exec -T db mysqldump -ulagernaut -plagernaut lagernaut \
--     > backup-vor-phantom-repair-$(date +%Y%m%d-%H%M).sql
--
-- Dann ausführen:
--   docker compose exec -T db mysql -ulagernaut -plagernaut \
--     --default-character-set=utf8mb4 lagernaut \
--     < prisma/scripts/phantom-lagerplatz-repair.sql
-- ============================================================

-- ── AUDIT VOR REPARATUR ───────────────────────────────────────────────────────
SELECT '=== PHANTOM-LAGERPLÄTZE VOR REPARATUR ===' AS info;

SELECT l.code AS lagerplatz_code, l.id AS lagerplatz_id,
       m.id AS modell_id, m.modell, m.hersteller,
       m.aktiv, m.deaktiviertGrund, m.deaktiviertAm
  FROM lagerplatz l
  INNER JOIN GeraeteModell m ON l.modellId = m.id
  WHERE m.aktiv = FALSE
  ORDER BY l.code;

SELECT COUNT(*) AS phantom_plaetze
  FROM lagerplatz l
  INNER JOIN GeraeteModell m ON l.modellId = m.id
  WHERE m.aktiv = FALSE;

-- ── REPARATUR ─────────────────────────────────────────────────────────────────
START TRANSACTION;

UPDATE lagerplatz l
  INNER JOIN GeraeteModell m ON l.modellId = m.id
  SET l.modellId = NULL
  WHERE m.aktiv = FALSE;

SELECT CONCAT('Phantom-Plätze freigegeben: ', ROW_COUNT()) AS ergebnis;

COMMIT;

-- ── AUDIT NACH REPARATUR ──────────────────────────────────────────────────────
SELECT '=== NACH REPARATUR ===' AS info;

SELECT COUNT(*) AS verbleibende_phantome
  FROM lagerplatz l
  INNER JOIN GeraeteModell m ON l.modellId = m.id
  WHERE m.aktiv = FALSE;

SELECT 'Soll: 0 — alle Phantom-Belegungen freigegeben.' AS erwartung;

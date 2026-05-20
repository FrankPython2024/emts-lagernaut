-- ── Repair: Artikel.standortId an Lagerplatz.standortId anpassen ─────────────
-- Geschäftsregel: Artikel.standortId muss mit Lagerplatz.standortId
--                 übereinstimmen wenn ein Lagerplatz gesetzt ist.
--
-- Ursache: Einlager-Bug — standortId wurde aus Frontend-Filter statt aus
--          dem gewählten Lagerplatz abgeleitet (gefixxt in Commit 05788ac+).
--
-- Ausführen auf dem Server:
--   docker compose exec db mysql -u<user> -p<pass> lagernaut < repair-artikel-standortId.sql
--
-- Nach dem SQL zwingend: npm run reindex  (Meilisearch-Index aktualisieren)

-- 1. Diagnose — wie viele Artikel sind betroffen?
SELECT COUNT(*) AS betroffen
FROM Artikel a
JOIN lagerplatz lp ON a.lagerplatz = lp.code
WHERE a.standortId != lp.standortId;

-- 2. Reparieren — standortId aus Lagerplatz übernehmen
UPDATE Artikel a
JOIN lagerplatz lp ON a.lagerplatz = lp.code
SET a.standortId = lp.standortId
WHERE a.standortId != lp.standortId;

-- 3. Verifizieren — sollte 0 zurückgeben
SELECT COUNT(*) AS verbleibend
FROM Artikel a
JOIN lagerplatz lp ON a.lagerplatz = lp.code
WHERE a.standortId != lp.standortId;

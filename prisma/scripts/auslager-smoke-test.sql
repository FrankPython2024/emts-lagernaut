-- ============================================================
-- Auslager-Wizard Smoke-Test — Phase A
-- Manuell auszuführen nach Deployment
-- ============================================================

-- SETUP: Test-Anfragen prüfen (echte Daten nutzen)
-- Finde 3 Anfragen mit aktiven Artikeln:
SELECT
  a.id, a.status, a.techniker, a.logId, a.gruppenNr,
  a.teil, a.menge,
  ar.bezeichnung AS artikel, ar.bestand, ar.lagerplatz
FROM Anfrage a
JOIN Artikel ar ON ar.id = a.artikelId
WHERE a.status IN ('NEU', 'BEDARF', 'IN_BEARBEITUNG')
  AND a.artikelId IS NOT NULL
LIMIT 10;

-- ── Test 1: listAnfragen gibt korrekte Daten zurück ───────────────────────────
-- Erwartung: Anfragen mit bestand >= menge erscheinen als verfuegbar: true
-- → Per tRPC-Client aufrufen: api.auslagern.listAnfragen.query()

-- ── Test 2: Teile auslagern ───────────────────────────────────────────────────
-- Wähle 2 NEU-Anfragen aus einer Gruppe (gleiche gruppenNr)
SELECT id, status, gruppenNr, menge, artikelId
FROM Anfrage
WHERE status = 'NEU' AND gruppenNr IS NOT NULL
LIMIT 5;

-- Vor Auslagerung: Bestand notieren
SELECT id, bezeichnung, bestand FROM Artikel WHERE id IN (/* artikelIds aus oben */);

-- → Per tRPC aufrufen: api.auslagern.teile.mutate({ anfrageIds: [id1, id2] })

-- Erwartete DB-Änderungen nach Mutation:
-- 1. Anfragen → status = 'ABGESCHLOSSEN'
SELECT id, status, bearbeitetVon, bearbeitetSeit
FROM Anfrage
WHERE id IN (/* gewählte IDs */);

-- 2. AUSGANG-Buchungen angelegt
SELECT b.id, b.typ, b.menge, b.mitarbeiter, b.notiz, b.datum
FROM Buchung b
JOIN Artikel a ON a.id = b.artikelId
WHERE b.typ = 'AUSGANG'
ORDER BY b.datum DESC
LIMIT 5;

-- 3. Bestand reduziert
SELECT id, bezeichnung, bestand FROM Artikel WHERE id IN (/* artikelIds */);

-- ── Test 3: BEDARF-Anfrage bleibt nach Auslagerung der NEU-Anfragen ──────────
-- Eine BEDARF-Anfrage aus der gleichen Gruppe sollte NICHT in listAnfragen erscheinen
-- wenn ihr bestand = 0 ist
SELECT id, status, artikelId
FROM Anfrage
WHERE gruppenNr = (/* gruppenNr aus Test 2 */) AND status = 'BEDARF';

SELECT bestand FROM Artikel WHERE id = (/* artikelId der BEDARF-Anfrage */);
-- Wenn bestand = 0: erscheint die Gruppe nicht mehr in listAnfragen (anzahlVerfuegbar = 0)
-- Wenn bestand > 0: erscheint die Gruppe mit der BEDARF-Anfrage als verfuegbar

-- ── Test 4: Race-Condition-Schutz ────────────────────────────────────────────
-- Setze Bestand eines Artikels auf 0, dann versuche auszulagern:
-- UPDATE Artikel SET bestand = 0 WHERE id = (/* artikelId */);
-- → api.auslagern.teile.mutate({ anfrageIds: [id mit dem Artikel] })
-- → Erwartung: CONFLICT-Error "Nicht genug Bestand für ..."
-- RESET: UPDATE Artikel SET bestand = (ursprünglicher Wert) WHERE id = ...;

-- ── Test 5: Doppelte Auslagerung blockiert ────────────────────────────────────
-- Anfrage, die bereits ABGESCHLOSSEN ist, nochmal versuchen auszulagern:
-- → Erwartung: BAD_REQUEST "Anfrage #X ist bereits ABGESCHLOSSEN"

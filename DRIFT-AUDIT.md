# Schema-Drift Audit — EMTS Lagernaut

_Stand: 2026-05-19 · Methode: Schema-Analyse + gemeldete DB-Maxlängen_

> **Status: Schema entspricht jetzt der DB-Realität — keine offenen Drifts mehr.**

---

## Diagnoseanleitung

Um den tatsächlichen DB-Stand zu prüfen, auf dem Server ausführen:

```sql
-- Alle varchar/text Spalten
SELECT TABLE_NAME, COLUMN_NAME, CHARACTER_MAXIMUM_LENGTH, DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'lagernaut'
  AND DATA_TYPE IN ('varchar', 'text', 'mediumtext', 'longtext')
ORDER BY CHARACTER_MAXIMUM_LENGTH DESC;

-- Max-Längen pro kritischer Spalte
SELECT
  MAX(LENGTH(bezeichnung)) AS max_artikel_bezeichnung   FROM artikel;
SELECT
  MAX(LENGTH(bezeichnung)) AS max_buchung_bezeichnung   FROM buchungen;
SELECT
  MAX(LENGTH(bezeichnung)) AS max_lookup_bezeichnung,
  MAX(LENGTH(bereinigt))   AS max_lookup_bereinigt      FROM geraete_lookup;
SELECT
  MAX(LENGTH(kommentar))   AS max_anfrage_kommentar     FROM anfragen;
SELECT
  MAX(LENGTH(betreff))     AS max_nachricht_betreff     FROM nachrichten;
```

---

## Alle Drifts — BEHOBEN ✅

| Modell.Feld | DB (war) | Schema (war) | Fix | Max-Länge |
|---|---|---|---|---|
| `Artikel.bezeichnung` | VARCHAR(255) | `String` (→191) | `@db.VarChar(255)` | 193 Zeichen |
| `GeraeteLookup.bezeichnung` | TEXT | `String` (→191) | `@db.Text` | 514+ Zeichen |
| `GeraeteLookup.bereinigt` | TEXT | `String` (→191) | `@db.Text` | 502+ Zeichen |
| `Nachricht.betreff` | VARCHAR(255) | `String` (→191) | `@db.VarChar(255)` | Freitext-Betreff |
| `GeraeteModell.modell` | VARCHAR(500) | `String` (→191) | `@db.VarChar(500)` | Lange Modellnamen |
| `Anfrage.beschreibung` | TEXT | `String?` (→191) | `@db.Text` | Freitext-Beschreibung |
| `Nachricht.inhalt` | TEXT | `String` (→191) | `@db.Text` | Chat-Inhalte |
| `NachrichtAntwort.inhalt` | TEXT | `String` (→191) | `@db.Text` | Antwort-Inhalte |
| `WarenkorbItem.beschreibung` | TEXT | `String?` (→191) | `@db.Text` | Sonderanfrage-Beschreibung |

---

## Offene Punkte (kein Drift, aber Wartung)

### `Buchung.bezeichnung` — prüfen empfohlen

`Buchung.bezeichnung` wird beim Buchen aus `Artikel.bezeichnung` kopiert.
Da Artikel bis zu 193 Zeichen Bezeichnung haben, könnten Buchungs-Bezeichnungen
dieselben langen Werte enthalten (MySQL truncated in non-strict mode).

**Prüfen:** `SELECT MAX(LENGTH(bezeichnung)) FROM buchungen`
→ Wenn > 191: `@db.VarChar(255)` ergänzen (kein db push nötig wenn DB schon 255 hat)

### 47 Drift-Artikel bereinigen (Langzeit-Task)

`Artikel.bezeichnung` ist Teil eines `@@unique`-Indexes und Fremdschlüssel in
`Buchung.bezeichnung` + `Kompatibilitaet.geraet`. Bereinigung braucht CASCADE-Update
→ Wartungsfenster planen.

---

## Alle @db-Annotationen im Schema ✅

```
Artikel.bezeichnung           @db.VarChar(255)
GeraeteLookup.bezeichnung     @db.Text
GeraeteLookup.bereinigt       @db.Text
GeraeteModell.deaktiviertGrund @db.VarChar(191)
GeraeteModell.modell          @db.VarChar(500)
Anfrage.beschreibung          @db.Text
WarenkorbItem.beschreibung    @db.Text
Nachricht.betreff             @db.VarChar(255)
Nachricht.inhalt              @db.Text
NachrichtAntwort.inhalt       @db.Text
Standort.name                 @db.VarChar(100)
Standort.kurzname             @db.VarChar(10)
Standort.adresse              @db.VarChar(500)
```

---

## Neue Spalten — Phase 1 Multi-Standort (kein Drift, expected)

Diese Spalten wurden im Zuge der Multi-Standort-Vorbereitung ergänzt.
Sie sind im Schema korrekt annotiert und entsprechen der DB-Realität nach `db push + seed:standort`.

| Tabelle | Spalte | Typ | Default | Bedeutung |
|---|---|---|---|---|
| `Standort` | neue Tabelle | — | — | Standort-Master (ETL, BLN, ...) |
| `Lagerplatz` | `standortId` | `INT NOT NULL` | `1` | FK → Standort |
| `User` | `standortId` | `INT NULL` | `NULL` | FK → Standort (null = Admin) |
| `Artikel` | `standortId` | `INT NOT NULL` | `1` | FK → Standort |
| `Artikel` | `@@unique` | triple key | — | `(bezeichnung, kategorie, standortId)` |

**Seed:** `npm run seed:standort` nach `db push` ausführen — setzt alle bestehenden
Zeilen auf `standortId = 1` (Sömmerda). Idempotent, darf mehrfach laufen.

# Schema-Drift Audit — EMTS Lagernaut

_Stand: 2026-05-19 · Methode: Schema-Analyse + gemeldete DB-Maxlängen_

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

## Bekannte Drifts — bereits gefixt ✅

| Modell.Feld | DB (war) | Schema (war) | Fix | Max-Länge |
|---|---|---|---|---|
| `Artikel.bezeichnung` | VARCHAR(255) | `String` (→191) | `@db.VarChar(255)` | 193 Zeichen |
| `GeraeteLookup.bezeichnung` | TEXT | `String` (→191) | `@db.Text` | 514+ Zeichen |
| `GeraeteLookup.bereinigt` | TEXT | `String` (→191) | `@db.Text` | 502+ Zeichen |

---

## Kritisch zu prüfen 🔴

### C1) `Buchung.bezeichnung` — potentiell kritisch

**Datei:** `prisma/schema.prisma:53`  
**Aktuell:** `String` (→ VARCHAR(191))

`Buchung.bezeichnung` wird beim Buchen aus `Artikel.bezeichnung` kopiert:
```typescript
// buchungen/service.ts: bucheLager()
bezeichnung: artikel.bezeichnung
```

Da Artikel bis zu 193 Zeichen Bezeichnung haben (47 Drift-Artikel), könnte
`Buchung.bezeichnung` dieselben langen Werte enthalten. MySQL silently truncates
in non-strict mode — existierende Buchungs-Bezeichnungen könnten abgeschnitten sein.

**Empfohlene Annotation:** `@db.VarChar(255)`  
**Risiko:** Datenverlust bei Buchungen für Drift-Artikel, Fehler bei künftigen Inserts.  
**Aktion:** Max-Länge prüfen (SQL oben), dann Schema angleichen.

---

### C2) `Anfrage.kommentar` — Freitext-Feld

**Datei:** `prisma/schema.prisma:82`  
**Aktuell:** `String?` (→ VARCHAR(191))

Techniker-Kommentare bei Anfragen. Kein technisches Limit im Frontend-Formular
sichtbar. Wenn Techniker einen langen Kommentar eingibt und MySQL im Strict-Mode
läuft, wirft das einen Fehler; ohne Strict-Mode wird truncated.

**Empfohlene Annotation:** `@db.Text` oder mindestens `@db.VarChar(500)`  
**Risiko:** Medium — Daten können beim Eingaben abgeschnitten werden.

---

## Untersuchen empfohlen 🟡

| Modell.Feld | Typ | Hinweis | Empfehlung |
|---|---|---|---|
| `Anfrage.geraet` | `String` | Geräte-Bezeichnung (z.B. aus LogID) — kann lang sein | `@db.VarChar(255)` prüfen |
| `Anfrage.geraeteName` | `String?` | Aus Lookup übernommen — Text aus GeraeteLookup | `@db.VarChar(255)` prüfen |
| `Nachricht.betreff` | `String` | Betreff-Zeile — selten > 191, aber kein Limit | `@db.VarChar(255)` empfohlen |
| `LagerplatzConfig.beschreibung` | `String?` | Beschreibungsfeld — Freitext | Max-Länge prüfen |
| `WarenkorbItem.zusatzinfo` | `String?` | Freitext-Zusatzinformation | Max-Länge prüfen |
| `GeraeteModell.modell` | `String` | Modell-Name — normalerweise kurz | `@db.VarChar(255)` prüfen |

---

## Sicher (kein Drift erwartet) ✅

| Modell.Feld | Typ | Begründung |
|---|---|---|
| `User.name/kuerzel/email/password` | `String` | Immer < 100 Zeichen |
| `Artikel.kategorie/lagerplatz` | `String` | Kurzbezeichnungen |
| `Buchung.mitarbeiter` | `String` | Kürzel (2-5 Zeichen) |
| `Anfrage.techniker/logId/teil/grading/gruppenNr/bearbeitetVon` | `String` | Strukturierte Kurzwerte |
| `Kompatibilitaet.geraet/teiltyp` | `String` | Normalform-Namen, < 100 |
| `GeraeteModell.hersteller` | `String` | Hersteller-Name, < 50 |
| `GeraeteLookup.logId/logIdClean` | `String` | Seriennummern, < 20 |
| `Warenkorb.techniker/logId/geraeteName` | `String` | Kurzwerte |
| `WarenkorbItem.teiltyp/grading/sonderKategorie` | `String?` | Kurzwerte |
| `StressTestRun.modus` | `String` | Enum-like, < 50 |
| `Nachricht.vonKuerzel/logId` | `String` | Kürzel/Seriennummer |
| `NachrichtEmpf.empfKuerzel` | `String` | Kürzel |
| `NachrichtAntwort.vonKuerzel` | `String` | Kürzel |

---

## Felder mit korrekter @db-Annotation ✅

Diese Felder sind bereits korrekt annotiert:

```
Artikel.bezeichnung           @db.VarChar(255)    ← gefixt
GeraeteLookup.bezeichnung     @db.Text            ← gefixt
GeraeteLookup.bereinigt       @db.Text            ← gefixt
GeraeteModell.deaktiviertGrund @db.VarChar(191)   ← bereits vorhanden
Anfrage.beschreibung          @db.Text            ← bereits vorhanden
WarenkorbItem.beschreibung    @db.Text            ← bereits vorhanden
Nachricht.inhalt              @db.Text            ← bereits vorhanden
NachrichtAntwort.inhalt       @db.Text            ← bereits vorhanden
```

---

## Empfehlung: Next Steps

**Sofort (vor nächstem db push):**
1. `Buchung.bezeichnung` prüfen: `SELECT MAX(LENGTH(bezeichnung)) FROM buchungen`
   → Wenn > 191: `@db.VarChar(255)` hinzufügen

**Mittelfristig:**
2. `Anfrage.kommentar` auf `@db.Text` setzen (kein Risiko, nur Schutz)
3. Alle 🟡 Felder mit einer SQL-Abfrage nachprüfen

**Langfristig:**
4. 47 Drift-Artikel mit Marketing-Text-Bezeichnungen bereinigen
   (Artikel.bezeichnung ist Primärschlüssel-Teil — Änderung braucht Cascade-Update
   auf Buchung.bezeichnung + Kompatibilitaet.geraet, d.h. Wartungsfenster)

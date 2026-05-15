# Audit Phase 2 — Daten + Business-Regeln

**Datum:** 2026-05-15  
**Geprüft:** Lagernaut v2, Branch `main`  
**Methode:** Statische Code-Analyse, Grep, Service-Layer-Lektüre  
**Basis:** Phase 1 abgeschlossen (keine kritischen Sicherheits-Bugs)

---

## A) HEILIGE REGEL: DIREKT-Buchung = Pass-through

### Befund A-1: ✅ KEIN BUG — Korrekt in buchungen/service.ts

`src/modules/buchungen/service.ts`:

```typescript
// berechneBestand() — Zeile 35: DIREKT explizit aus WHERE ausgeschlossen
where: { artikelId, typ: { in: [BuchungsTyp.EINGANG, BuchungsTyp.AUSGANG] } }

// bucheLager() — Zeile 98: DIREKT überspringt Bestand-Update
if (data.typ !== BuchungsTyp.DIREKT) {
  // nur hier wird Bestand verändert
}
```

EINGANG → +menge ✅ · AUSGANG → -menge ✅ · DIREKT → 0 ✅

### Befund A-2: ✅ KEIN BUG — Einlagern verwendet nur EINGANG

`src/modules/einlagern/service.ts:289` — `BuchungsTyp.EINGANG`. Kein DIREKT, kein AUSGANG.

### Befund A-3: ✅ KEIN BUG — Anfrage-Abschluss verwendet AUSGANG

`src/server/routers/anfragen.ts:120` — Bei ABGESCHLOSSEN wird `BuchungsTyp.AUSGANG` via `bucheLager()` erstellt. Kein direktes Bestand-Update außerhalb bucheLager().

### Befund A-4: 🟢 KOSMETISCH — verschiebeArtikel erstellt EINGANG+AUSGANG statt DIREKT

`src/modules/lagerplaetze/service.ts:138–142`:

```typescript
await tx.buchung.createMany({
  data: [
    { typ: "EINGANG", menge: 1, ... },  // +1
    { typ: "AUSGANG", menge: 1, ... },  // -1 = Netto 0
  ],
});
```

**Bewusst so gebaut:** Ergebnis ist korrekt (Netto 0), schafft aber Audit-Trail mit 2 Zeilen statt 1. Kein Daten-Bug. `verschiebeAlle()` zeigt gleiches Muster (Zeile 179).  
**Empfehlung:** Kann auf `BuchungsTyp.DIREKT` umgestellt werden für saubereren Audit-Trail — nicht zwingend.

---

## B) Modell-Anlage konsistent

### Befund B-1: ✅ KEIN BUG — Einzige create-Stelle ist in getOrCreateModell

`grep -rn "geraeteModell\.create\|geraeteModell\.upsert"` → **1 Treffer:**

`src/lib/geraete/getOrCreateModell.ts:110` — innerhalb der Funktion selbst.

Alle Aufrufer:
- `src/modules/einlagern/service.ts:177` → ✅
- `src/modules/geraete/service.ts:44` → ✅
- `src/modules/jobs/worker.ts:118` → ✅

**Kein Pfad umgeht `getOrCreateModell`.**

---

## C) Hersteller-Filter konsistent

### Befund C-1: ✅ KEIN BUG — Whitelist zentralisiert, überall verwendet

`checkHersteller` / `normalisiereHersteller` wird aufgerufen in:
- `getOrCreateModell.ts:42` — beim Anlegen
- `einlagern/service.ts:171` — vor jedem Execute
- `jobs/worker.ts:115` — im Artikel-Generator
- `geraeteLookup.ts:74, 135, 161` — beim CSV-Import

Whitelist: `["HP", "Lenovo", "Dell", "Fujitsu"]` in `herstellerFilter.ts:7`  
Blocklist: 19 Einträge (Apple, ASUS, Acer, HPE …)  
Apple-Indikatoren: 6 RegEx-Muster (inkl. `^Pro [0-9]+$` für Dell-verkleidete Apple-Modelle)

---

## D) Bestand-Konsistenz

### Befund D-1: ✅ KEIN BUG — Kein direktes Bestand-Update außerhalb bucheLager()

`grep -rn "\.bestand" src/` zeigt ausschließlich:
- Lese-Operationen (`artikel.bestand`, `a.bestand > 0`)
- SELECT-Felder für Anzeige
- **Kein einziges** `update({ data: { bestand: X } })` außerhalb von `buchungen/service.ts`

Bestand wird ausschließlich über `bucheLager()` → Transaktion → `berechneBestand()` verändert.

### Befund D-2: ✅ KEIN BUG — syncBestandAusHistorie schützt Konsistenz

`buchungen/service.ts:162–178` — Recalc aus History bei jeder Storno- oder Korrektur-Operation. Verhindert Drift.

---

## E) 17 Standard-Teiltypen

### Befund E-1: 🔴 BUG — Inkonsistente Teiltypen-Definition (13 vs 17)

**Zwei verschiedene Listen existieren nebeneinander:**

| Datei | Konstante | Anzahl | Teile |
|-------|-----------|--------|-------|
| `src/modules/einlagern/constants.ts` | `STANDARD_TEILE` | **13** | Displaymodul, Tastatur, Touchpad, Füße vorne/hinten, D Cover, USB Board, Power Button, Lautsprecher, Lüfter, Thermalmodul, BIOS Batterie, Akku |
| `src/modules/geraete/service.ts` | `STANDARD_TEILE` (lokal) | **13** | Identisch zu oben |
| `src/lib/constants/teiltypen.ts` | `STANDARD_TEILTYPEN` | **17** | Obige 13 + Mainboard, Display (separat), Touchpad Buttons, LAN Board, WLAN/UMTS Karte, DC IN |
| `src/modules/kompatibilitaet/service.ts` | `STANDARD_TEILE_ENUM` | **13** | Identisch zu einlagern/constants |

**Auswirkung:**
- `legeModellAn()` (`geraete/service.ts:62`) → erstellt 13 Artikel
- `handleArtikelGeneratorJob` (`jobs/worker.ts:90`) → erstellt **17** Artikel mit `STANDARD_TEILTYPEN`
- Neue Modelle via Einlager-Assistent → 13 Artikel
- Modelle via Artikel-Generator-Job → 17 Artikel

Ergebnis: Je nach Anlage-Pfad haben Modelle unterschiedliche Artikel-Mengen. Techniker sehen für manche Modelle mehr Teile als für andere.

**Fix:** Entscheiden welche Liste kanonisch ist (CLAUDE.md nennt keinen genauen Wert). `STANDARD_TEILTYPEN` auf eine Quelle zentralisieren. Alle Aufrufer auf die eine Liste umstellen.

**Hinweis:** Frank hat `STANDARD_TEILTYPEN` (17) wohl für den Auto-Generator erweitert. Frage: Sollen diese 4 Extra-Teile auch im manuellen Anlegen-Flow erscheinen?

---

## F) Status-Workflow Anfragen

### Befund F-1: ✅ KEIN BUG — Transitionen korrekt validiert

`src/modules/anfragen/service.ts:220–226`:
```typescript
const GUELTIGE_TRANSITIONEN = {
  NEU:            [IN_BEARBEITUNG, BEDARF, ABGESCHLOSSEN, STORNIERT],
  BEDARF:         [IN_BEARBEITUNG, NEU,   ABGESCHLOSSEN, STORNIERT],
  IN_BEARBEITUNG: [ABGESCHLOSSEN,  BEDARF, NEU,          STORNIERT],
  ABGESCHLOSSEN:  [],  // terminal
  STORNIERT:      [],  // terminal
}
```

Storno nur von NEU/BEDARF (`storniereAnfrage()`, Zeile 98). ✅

### Befund F-2: ✅ KEIN BUG — gruppeInBearbeitungNehmen ist atomar

`anfragen.ts:119`:
```typescript
await tx.anfrage.updateMany({
  where: { id: { in: ids }, status: { in: [NEU, BEDARF] }, bearbeitetVon: null }
})
```
DB-Level-Atomarität. Kein Race-Condition-Problem. ✅

### Befund F-3: 🟢 KOSMETISCH — gruppeFreigeben/Zurückgeben sequenziell

`anfragen/service.ts` — `gruppeFreigeben()` und `gruppeZurueckgeben()` verwenden eine `for`-Schleife mit einzelnen `update()`-Calls statt `updateMany()`. Bei gleichzeitiger Freigabe durch zwei Admins theoretisch inkonsistenter Zwischenzustand möglich.

**Bewertung:** Sehr unwahrscheinlich (Admin-Tool, kleine Teams). Kein kritischer Bug.

---

## G) LogID-Lookup exakt

### Befund G-1: ✅ KEIN BUG — Numerische LogID ist exakter Match

`einlagern/service.ts:25–29`:
```typescript
if (/^\d{7,12}$/.test(clean)) {
  const lookup = await prisma.geraeteLookup.findFirst({
    where: { OR: [{ logId: trimmed }, { logIdClean: clean }] },
  });
  if (lookup) return { gefunden: true, typ: "logid", ... };
}
```

Nur bei reinem Zahlen-Input. Kein LIKE. ✅

`geraeteLookup.ts:30–36` — `byLogId` Procedure: gleiches exaktes Match-Muster. ✅

### Befund G-2: 🟢 KOSMETISCH — Text/Modell-Suche ist CONTAINS

Wenn LogID-Lookup nichts findet, fällt der Code auf `bereinigt: { contains: trimmed }` zurück (Zeile 34). Dies ist für die **Text-Suche** gedacht (Modellname eingeben) — nicht für LogID. Ist dokumentiertes Feature-Verhalten, kein Bug.

---

## H) Lagerplatz-Logik

### Befund H-1: ✅ KEIN BUG — @unique constraint auf modellId

`prisma/schema.prisma:139`:
```prisma
modellId   Int?  @unique
```
1 Modell = max. 1 Lagerplatz auf DB-Ebene erzwungen. ✅

### Befund H-2: ✅ KEIN BUG — onDelete: SetNull bei Modell-Löschung

```prisma
modell  GeraeteModell? @relation(..., onDelete: SetNull)
```
Wenn GeraeteModell physisch gelöscht wird → `lagerplatz.modellId` automatisch null. ✅

### Befund H-3: 🟡 WICHTIG — Soft-Delete belässt Lagerplatz-Belegung

Wenn `GeraeteModell.aktiv` auf `false` gesetzt wird (Soft-Delete), wird `lagerplatz.modellId` **nicht** automatisch geleert.

Betroffen: `modell.ts` → `reaktivieren`/Deaktivierung. Kein expliziter `loesen()`-Aufruf.

**Folge:** Ein deaktiviertes Modell belegt weiter seinen Lagerplatz. In der ETL-Grid-Übersicht erscheint der Platz als „belegt", obwohl das Modell inaktiv ist. Neue Einlagerungen finden den Platz nicht als „frei".

`lagerplatz.ts:382` — `zuweisenNachName` filtert `aktiv: true`, also werden inaktive Modelle nicht mehr neu zugewiesen. Aber der bestehende Lagerplatz bleibt gesperrt.

**Fix:** In `modell.ts` → `reaktivieren`/Deaktivierungs-Pfad: `loesen()` aufrufen wenn Modell auf `aktiv=false` gesetzt wird.

### Befund H-4: 🟡 WICHTIG — zuweisen/umziehen prüfen nicht aktiv-Status

`lagerplatz.ts:326` — `zuweisen()` und `lagerplatz.ts:424` — `umziehen()` prüfen nicht ob `modell.aktiv === true` vor der Zuweisung.

Ein inaktives Modell könnte einem Lagerplatz zugewiesen werden (falls Admin dies manuell triggert).

**Fix:** In beiden Mutations nach dem `findUnique` für das Modell:
```typescript
if (!modell.aktiv) throw new TRPCError({ code: "BAD_REQUEST", message: "Inaktives Modell kann keinen Lagerplatz erhalten" });
```

---

## I) Konsistenz-Check-SQL

Erstellt als: `prisma/scripts/konsistenz-check.sql`

---

## Gesamt-Übersicht

| # | Schwere | Befund | Datei:Zeile |
|---|---------|--------|-------------|
| E-1 | 🔴 BUG | Standard-Teile-Listen inkonsistent (13 vs 17) | `einlagern/constants.ts` vs `lib/constants/teiltypen.ts` |
| H-3 | 🟡 WICHTIG | Soft-Delete belässt Lagerplatz gesperrt | `server/routers/modell.ts` — kein `loesen()` beim Deaktivieren |
| H-4 | 🟡 WICHTIG | zuweisen/umziehen ohne aktiv-Check | `server/routers/lagerplatz.ts:326, 424` |
| F-3 | 🟢 KOSMETISCH | gruppeFreigeben sequenziell statt updateMany | `modules/anfragen/service.ts` |
| A-4 | 🟢 KOSMETISCH | verschiebeArtikel EINGANG+AUSGANG statt DIREKT | `modules/lagerplaetze/service.ts:138` |
| G-2 | 🟢 KOSMETISCH | Text-Suche als CONTAINS-Fallback (bewusst) | `modules/einlagern/service.ts:34` |

### Was sauber ist
- DIREKT-Buchung korrekt in **allen** Pfaden (A) ✅
- Modell-Anlage ausschließlich über `getOrCreateModell` (B) ✅
- Hersteller-Filter überall korrekt verdrahtet (C) ✅
- Kein direktes Bestand-Update außerhalb `bucheLager()` (D) ✅
- Status-Maschine korrekt, terminale Zustände geschützt (F) ✅
- LogID exakter Match (G) ✅
- DB-Constraint `@unique modellId` erzwingt 1-zu-1 (H) ✅

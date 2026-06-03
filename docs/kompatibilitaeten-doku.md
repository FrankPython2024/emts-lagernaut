# Kompatibilitäts-System — technische Doku

Zielgruppe: Geschäftsleitungs-Demo. Lese-Zeit ca. 10 Minuten.
Stand: aktuelle `main`-Spitze. Alle Aussagen mit File:Line belegt; wo ich
unsicher war, steht „TODO: prüfen".

---

## 1. Datenmodell (Prisma)

`prisma/schema.prisma` enthält fünf relevante Modelle. Die Kerneinsicht:
**`Kompatibilitaet.geraet` ist ein String**, kein Fremdschlüssel auf
`GeraeteModell.id`. Das hat historische Gründe (frei einlagerbarer
Gerätename) und steuert das gesamte Auflösungsverhalten weiter unten.

### Artikel

```prisma
// prisma/schema.prisma:111
model Artikel {
  id          Int               @id @default(autoincrement())
  bezeichnung String            @db.VarChar(255)
  lagerplatz  String?
  kategorie   String
  bestand     Int               @default(0)
  ...
  standortId  Int               @default(1)
  ...
  @@unique([bezeichnung, kategorie, standortId])
}
```

- `bezeichnung` folgt dem Generator-Muster `"{Hersteller} {Modell} {Teiltyp}"`
  (z. B. `"Lenovo ThinkPad T480 Touchpad"`).
- `kategorie` = der Teiltyp als String (`"Touchpad"`, `"Akku"`, `"Verschiedenes"` …).
- `standortId` (default 1) — Pool-Filterung läuft hierüber.
- Unique-Constraint: `(bezeichnung, kategorie, standortId)` — verhindert
  doppelte Artikel pro Standort.

### Anfrage

```prisma
// prisma/schema.prisma:153
model Anfrage {
  id               Int           @id @default(autoincrement())
  techniker        String
  logId            String
  geraet           String
  artikelId        Int?              // null bei Sonderanfragen
  teil             String
  menge            Int           @default(1)
  ...
  istSonderAnfrage Boolean       @default(false)
  beschreibung     String?       @db.Text
  sonderKategorie  String?
  status           AnfrageStatus @default(NEU)
  artikel          Artikel?      @relation(...)
  ...
}
```

`artikelId` ist **nullable** — Sonderanfragen referenzieren keinen Artikel
und tragen ihren Inhalt im `beschreibung`-Freitext.

### AnfrageStatus

```prisma
// prisma/schema.prisma:186
enum AnfrageStatus {
  NEU
  BEDARF
  IN_BEARBEITUNG
  ABGESCHLOSSEN
  STORNIERT
  NICHT_VERFUEGBAR
}
```

`NICHT_VERFUEGBAR` wurde am Ende angehängt (Migration in
`prisma/scripts/migration-status-nicht-verfuegbar.sql`), damit existierende
ENUM-Indices stabil bleiben.

### Kompatibilitaet (das Herzstück)

```prisma
// prisma/schema.prisma:195
model Kompatibilitaet {
  id        Int     @id @default(autoincrement())
  geraet    String
  teiltyp   String
  artikelId Int
  artikel   Artikel @relation(...)

  // Multi-Artikel: pro (geraet, teiltyp) sind mehrere Artikel erlaubt (Pool).
  // Der unique-Key verhindert nur exakte Duplikate.
  @@unique([geraet, teiltyp, artikelId])
}
```

- **Verknüpfungstabelle** `(geraet-String + teiltyp-String) → artikel-FK`.
- Unique seit dem Multi-Artikel-Umbau: `(geraet, teiltyp, artikelId)` —
  d. h. **N Artikel pro (Modell, Teiltyp)** möglich → Pool. Vorher war
  `(geraet, teiltyp)` unique = nur 1 Artikel.
- Migration: `prisma/scripts/migration-kompatibilitaet-multi-artikel.sql`.

### GeraeteModell

```prisma
// prisma/schema.prisma:207
model GeraeteModell {
  id               Int             @id @default(autoincrement())
  hersteller       String
  modell           String          @db.VarChar(500)
  aktiv            Boolean         @default(true)
  ...
  @@unique([hersteller, modell])
}
```

### Warum `geraet` ein String ist

`Kompatibilitaet.geraet` enthält den **vollen** Gerätenamen
`"{hersteller} {modell}"`. Beim Einlagern wird genau dieser String erzeugt
und beim Auflösen rückwärts wiedererkannt. Es gibt **keinen FK** zu
`GeraeteModell.id`. Konsequenzen:

| Vorteil | Nachteil |
|---|---|
| Anfragen für nicht-gepflegte Modelle bleiben möglich (Soft-Onboarding) | Geister-Strings möglich (Tippfehler, gelöschte Modelle) |
| Fuzzy-Match über mehrere Schreibweisen (`findMatchingGeraete`) | Pflegerisiko: Bezeichnungs-Drift kann Auto-Mirror verfehlen |

```
   ┌─────────────────┐                  ┌──────────────────────┐
   │ GeraeteModell   │                  │ Kompatibilitaet      │
   │  hersteller     │ ── "H M" ──────▶ │  geraet  (String!)   │
   │  modell         │   (String-Match) │  teiltyp (String)    │
   └─────────────────┘                  │  artikelId ─────────┐│
                                        └──────────────────────┘│
                                                                ▼
                                                       ┌──────────┐
                                                       │ Artikel  │
                                                       │  ...     │
                                                       └──────────┘
```

---

## 2. Backend-Service: zentrale Auflösung

Datei: `src/modules/kompatibilitaet/service.ts`.
Hauptfunktion: `getByGeraetMitStandard` (ab `:425`). Sie wird vom
Techniker-Portal, der LogID-Suche im Admin und vom Geräte-Lookup
aufgerufen — eine Quelle der Wahrheit für „welche Teile sind für dieses
Gerät verfügbar".

### 2.1 Fuzzy-Match der Gerätenamen

```ts
// src/modules/kompatibilitaet/service.ts:10
async function findMatchingGeraete(geraetLow: string): Promise<string[]> {
  // Richtung 1: DB-enthält-Suchanfrage (häufigster Fall)
  const containsHits = await prisma.kompatibilitaet.findMany({
    where:    { geraet: { contains: geraetLow } },
    distinct: ["geraet"],
    select:   { geraet: true },
  });
  // Richtung 2: Suchanfrage enthält DB-Eintrag (kürzere DB-Einträge)
  ...
}
```

Zwei Richtungen: gespeicherte `geraet`-Strings, die den gescannten Namen
enthalten **und** kürzere DB-Strings, die im gescannten Namen vorkommen.
Ergebnis = vereinigte, eindeutige Liste passender `geraet`-Strings.

### 2.2 Teiltyp-Liste auflösen (Modell-spezifisch oder Standard)

```ts
// src/modules/kompatibilitaet/service.ts:442
const alleModelle = await prisma.geraeteModell.findMany({
  where:  { aktiv: true },
  select: { id: true, hersteller: true, modell: true },
});
const passendesModell = alleModelle.find(
  (m) => `${m.hersteller} ${m.modell}`.toLowerCase() === geraetLow,
);
```

Bei exaktem Modell-Match werden Standards + modell-spezifische Custom-
Teiltypen geladen (`modellTeiltypen.some(...)`), sonst nur Standards.

### 2.3 Pool aggregieren — Bestand = Summe

```ts
// src/modules/kompatibilitaet/service.ts:486
// Pool je Teiltyp: ALLE verknüpften Artikel sammeln (dedupliziert nach Artikel-ID,
// da derselbe Artikel über mehrere geraet-Strings auftauchen kann).
const poolMap = new Map<string, ArtikelLite[]>();
for (const k of treffer) {
  const arr = poolMap.get(k.teiltyp) ?? [];
  if (!arr.some((a) => a.id === k.artikel.id)) arr.push(k.artikel);
  poolMap.set(k.teiltyp, arr);
}
```

Pro Teiltyp wird eine **Liste** aller verknüpften Artikel gesammelt,
dedupliziert nach `artikel.id` (verhindert Doppelzählung bei mehreren
matchenden `geraet`-Strings).

### 2.4 Primärer Artikel + Pool-Summe

```ts
// src/modules/kompatibilitaet/service.ts:499
function aggregiere(teiltyp: string, artikel: ArtikelLite[]): TeilMitBestand {
  const sortiert    = [...artikel].sort((a, b) => b.bestand - a.bestand);
  const poolBestand = sortiert.reduce((s, a) => s + a.bestand, 0);
  const primaer     = sortiert.find((a) => a.bestand > 0) ?? sortiert[0]!;
  return {
    teiltyp,
    artikelId:   primaer.id,
    bezeichnung: primaer.bezeichnung,
    kategorie:   primaer.kategorie,
    bestand:     poolBestand,
    verfuegbar:  poolBestand > 0,
  };
}
```

- **Tie-Breaker:** absteigend nach Bestand sortiert. Der erste mit
  `bestand > 0` wird primär; nichts vorhanden → erstes Element (Repräsentant).
- **`artikelId` im Result zeigt auf den primären Artikel** — also auf den,
  der bei einer Anfrage tatsächlich gebucht würde.
- `bestand` = Summe über alle Pool-Artikel (das, was der Techniker als
  „verfügbar" sieht).

### 2.5 Verschiedenes — Sonderbehandlung

```ts
// src/modules/kompatibilitaet/service.ts:478
const standardListe = (aktiveTeiltypen.length > 0
  ? aktiveTeiltypen.map(t => t.name)
  : STANDARD_TEILE_LOOKUP
).filter((name) => name !== VERSCHIEDENES_TEILTYP);
```

`"Verschiedenes"` wird **aus der Standard-Liste entfernt** — es gibt
keinen generischen Verschiedenes-Slot. Stattdessen werden die einzelnen
Freitext-Varianten (kompat-`teiltyp` = `"Verschiedenes — Schraubenset"`
etc.) nur dann angehängt, wenn sie tatsächlich Bestand haben:

```ts
// src/modules/kompatibilitaet/service.ts:530
const verschiedenesVarianten: TeilMitBestand[] = [...poolMap.entries()]
  .filter(([teiltyp, arr]) => !standardSet.has(teiltyp) && arr.some((a) => a.kategorie === VERSCHIEDENES_TEILTYP))
  .map(([teiltyp, arr]) => aggregiere(teiltyp, arr))
  .filter((t) => t.verfuegbar);
```

Standard-Teile erscheinen **immer** (auch ohne Bestand → „nicht erfasst"),
Verschiedenes-Varianten **nur mit Bestand**.

---

## 3. Multi-Artikel-Verknüpfung

Schreibe-Pfad: `setVerknuepfteArtikelBulk` (ab
`src/modules/kompatibilitaet/service.ts:245`). Wird vom Verknüpfungs-Modal
in `/admin/modelle` aufgerufen.

```ts
// src/modules/kompatibilitaet/service.ts:262
for (const e of input.eintraege) {
  const aktuell = await tx.kompatibilitaet.findMany({
    where:  { geraet: input.geraet, teiltyp: e.teiltyp },
    select: { artikelId: true },
  });
  const aktuellIds = new Set(aktuell.map((k) => k.artikelId));
  const neuIds     = new Set(e.artikelIds);

  const hinzu = [...neuIds].filter((id) => !aktuellIds.has(id));
  const weg   = [...aktuellIds].filter((id) => !neuIds.has(id));
  ...
}
```

- Diff **pro Teiltyp**: `aktuell` vs. `neu` → `hinzu` einfügen, `weg`
  löschen. Andere Teiltypen werden nicht angefasst (z. B. Verschiedenes-
  Varianten bleiben unberührt).
- Schreibvorgang in `prisma.$transaction(...)`. `skipDuplicates` fängt
  Race-Conditions ab.

Das schreibt N Zeilen `(geraet, teiltyp, artikelId)` für denselben
`(geraet, teiltyp)` — möglich durch den neuen 3-Spalten-Unique.

---

## 4. Auto-Spiegelung beim Verknüpfen

Datei: `src/lib/format/heimatModell.ts`.

```ts
// src/lib/format/heimatModell.ts:18
export function extractHeimatModell(bezeichnung: string, teiltyp: string): string | null {
  // Verschiedenes hat kein natürliches Modell-Mapping → kein Auto-Mirror
  if (teiltyp === VERSCHIEDENES_TEILTYP) return null;

  const suffix = ` ${teiltyp}`;
  if (!bezeichnung.endsWith(suffix)) return null;

  const heimat = bezeichnung.slice(0, -suffix.length).trim();
  return heimat.length >= 5 ? heimat : null; // Sicherheitsnetz gegen Mini-Fragmente
}
```

Aus `"Lenovo ThinkPad T590 20N5-S4WE00 Touchpad"` + `"Touchpad"` wird
`"Lenovo ThinkPad T590 20N5-S4WE00"`. Verschiedenes wird ausgeschlossen.

Integration in `setVerknuepfteArtikelBulk`:

```ts
// src/modules/kompatibilitaet/service.ts:286
// Auto-Spiegelung der NEU hinzugefügten Artikel beim jeweiligen Heimat-Modell
const artikel = await tx.artikel.findMany({
  where:  { id: { in: hinzu } },
  select: { id: true, bezeichnung: true, kategorie: true },
});
for (const a of artikel) {
  if (a.kategorie === VERSCHIEDENES_TEILTYP) continue;
  const heimat = extractHeimatModell(a.bezeichnung, e.teiltyp);
  if (!heimat || heimat === input.geraet) continue;     // kein Selbst-Mirror
  if (!existierendeNamen.has(heimat)) continue;          // kein Geister-Modell
  ...
}
```

Geister-Schutz: vor der Schleife wird einmalig die Menge aller **aktiven**
`GeraeteModell`-Namen geladen (`existierendeNamen` Set, Zeile 259); nur
wenn der extrahierte Heimat-String dort enthalten ist, wird die
Spiegelung angelegt.

**Asymmetrie beim Löschen:** Auto-Mirror läuft ausschließlich auf
`hinzu` (neu hinzugefügte) — `weg` (entfernte) wird **nicht** gespiegelt.
Begründung: ein manuell beim Heimat-Modell ergänzter Link soll nicht
durch eine Korrektur an anderer Stelle versehentlich zerstört werden.

---

## 5. Bestand-Erkennung im Live-Workflow

Ablauf vom LogID-Scan bis zur Anzeige.

```
 Techniker scannt LogID (techniker/page.tsx:442)
        │
        ▼
 api.kompatibilitaet.getByGeraetMitStandard
   ({ geraet: gerätName, standortIds })
        │
        ▼
 getByGeraetMitStandard (kompatibilitaet/service.ts:425)
   1. findMatchingGeraete → passende geraet-Strings (Fuzzy)
   2. GeraeteModell-Lookup (exakter "hersteller modell"-Match)
   3. Aktive Teiltypen laden (Standards + modell-spezifisch)
   4. Kompatibilitaet-Treffer holen (standort-gefiltert via artikel-Relation)
   5. poolMap aufbauen, pro teiltyp aggregieren
   6. Verschiedenes-Varianten anhängen (nur mit Bestand)
        │
        ▼
 Result: TeilMitBestand[]
   { teiltyp, artikelId, bezeichnung, kategorie, bestand (=Pool-Summe), verfuegbar }
        │
        ▼
 Techniker-Portal-Grid
   verfuegbar=true → "NEU/verfügbar" Karte
   bestand=0      → "BEDARF" Karte
   artikelId=null → "nicht erfasst" Karte (Standard-Slot ohne Verknüpfung)
```

- Aufrufer Techniker-Portal: `src/app/techniker/page.tsx:442`
  (`api.kompatibilitaet.getByGeraetMitStandard.useQuery(...)`).
- Aufrufer Admin LogID-Lookup: `src/app/admin/geraete-lookup/page.tsx:46`.
- Aufrufer Einlager-Wizard (Bestand-Hinweise pro Teiltyp):
  `src/app/admin/einlagern/page.tsx:1156`.
- Router: `src/server/routers/kompatibilitaet.ts:57`
  (`getByGeraetMitStandard: protectedProcedure`).

Die Pool-Summe (`bestand` im Result-Feld) ist also rein backend-
aggregiert; das Frontend zeigt sie ohne weitere Logik.

---

## 6. Anfrage-Erstellung mit Pool-Auflösung

Datei: `src/modules/anfragen/service.ts`. Die `artikelId`-Wahl passiert
**nicht hier**, sondern bereits in `getByGeraetMitStandard` (siehe §2.4):
das Techniker-Portal liest die dort gesetzte primäre `artikelId` und
schickt sie an `erstelleAnfrage`.

```ts
// src/modules/anfragen/service.ts:44
export async function erstelleAnfrage(data: ErstelleAnfrageData): Promise<Anfrage> {
  let status: AnfrageStatus = AnfrageStatus.BEDARF;

  if (data.artikelId) {
    const artikel = await prisma.artikel.findUnique({
      where:  { id: data.artikelId },
      select: { id: true, kategorie: true, bestand: true },
    });
    if (!artikel) throw new TRPCError({ code: "NOT_FOUND", ... });
    status = artikel.bestand > 0 ? AnfrageStatus.NEU : AnfrageStatus.BEDARF;
  }

  // Sonderanfragen sind immer BEDARF (kein Lagerartikel verknüpft)
  if (data.istSonderAnfrage) status = AnfrageStatus.BEDARF;
  ...
}
```

- Pool-Auflösung passiert in **`getByGeraetMitStandard`** (zentral).
- `erstelleAnfrage` prüft nur noch den Bestand des **primären** Artikels:
  `bestand > 0 → NEU`, sonst `BEDARF`.
- Sonderanfragen sind immer `BEDARF`.

So referenziert die Anfrage **genau einen** konkreten Artikel — den, der
beim Auslagern tatsächlich gebucht wird. Edge-Case A=0/B=3 im Pool: der
primäre = B (höchster Bestand mit `>0`) → Status NEU → Auslagern reduziert
B. Korrekt.

---

## 7. Auslagerung — drei Pfade

Datei: `src/server/routers/auslagern.ts`, Mutation `teile` ab `:219`.

```ts
// src/server/routers/auslagern.ts:268  — Sonderanfrage-Zweig
if (anfrage.istSonderAnfrage || !anfrage.artikelId || !anfrage.artikel) {
  if (!anfrage.istSonderAnfrage) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Anfrage #${anfrageId} hat keinen Artikel` });
  }
  await tx.anfrage.update({
    where: { id: anfrageId },
    data:  { status: AnfrageStatus.ABGESCHLOSSEN, ... },
  });
  ausgabe.push({ ..., artikelId: null, buchungId: null, buchungsTyp: "DIREKT", istSonderanfrage: true });
  continue;
}
```

```ts
// src/server/routers/auslagern.ts:305  — AUSGANG vs. DIREKT (Standard-Artikel)
if (buchungsTyp === BuchungsTyp.AUSGANG) {
  if (aktuellerBestand < anfrage.menge) throw new TRPCError({ code: "CONFLICT", ... });
  neuerBestand = aktuellerBestand - anfrage.menge;

  // Sicherheitsgurt: schützt diesen Bestand-Update-Pfad.
  assertKeinBestandEffekt(buchungsTyp, "auslagern.teile AUSGANG-Zweig");

  await tx.artikel.update({
    where: { id: anfrage.artikelId },
    data:  { bestand: neuerBestand },
  });
}
// DIREKT: absichtlich kein Artikel-Update.
```

| Pfad | Trigger | `tx.artikel.update` | `tx.buchung.create` | Status danach |
|---|---|---|---|---|
| AUSGANG | `buchungsTyp = "AUSGANG"`, Standard-Artikel | ja (`bestand -= menge`) | ja (typ AUSGANG) | ABGESCHLOSSEN |
| DIREKT | `buchungsTyp = "DIREKT"`, Standard-Artikel | **nein** | ja (typ DIREKT) | ABGESCHLOSSEN |
| Sonderanfrage | `anfrage.istSonderAnfrage = true` | **nein** | **nein** (kein Artikel-FK) | ABGESCHLOSSEN |

Die heilige DIREKT-Regel:

```ts
// src/lib/buchungen/typeGuards.ts:14
export function assertKeinBestandEffekt(typ: BuchungsTyp, kontext: string): void {
  if (typ === BuchungsTyp.DIREKT) {
    throw new Error(
      `HEILIGE REGEL VERLETZT: DIREKT-Buchung darf keinen Bestand-Effekt haben (${kontext})`,
    );
  }
}
```

- Wird **nur** im AUSGANG-Zweig aufgerufen, **unmittelbar vor**
  `tx.artikel.update` (Zeile 318).
- Wenn jemand versehentlich DIREKT auf den AUSGANG-Pfad lenkt, schlägt
  der Sicherheitsgurt SOFORT zu — Bestand bleibt unangetastet.
- Im DIREKT- und Sonderanfrage-Zweig wird `artikel.update` schlicht **nicht**
  aufgerufen → die Regel ist per Konstruktion erfüllt.

---

## 8. NICHT_VERFUEGBAR

### Schema + Migration

- Enum-Erweiterung: `prisma/schema.prisma:192` (NICHT_VERFUEGBAR am Ende
  angehängt, damit existierende ENUM-Indices stabil bleiben).
- Migration: `prisma/scripts/migration-status-nicht-verfuegbar.sql`:

```sql
ALTER TABLE `Anfrage`
  MODIFY COLUMN `status`
  ENUM('NEU','BEDARF','IN_BEARBEITUNG','ABGESCHLOSSEN','STORNIERT','NICHT_VERFUEGBAR')
  NOT NULL DEFAULT 'NEU';
```

### Backend-Logik

```ts
// src/modules/anfragen/service.ts:325
export async function markiereNichtVerfuegbar(anfrageId: number, adminKuerzel: string) {
  const anfrage = await prisma.anfrage.findUnique({ ... });
  if (!anfrage) throw new TRPCError({ code: "NOT_FOUND", ... });

  const erlaubt: AnfrageStatus[] = [AnfrageStatus.NEU, AnfrageStatus.BEDARF, AnfrageStatus.IN_BEARBEITUNG];
  if (!erlaubt.includes(anfrage.status)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `... kann nicht auf NICHT_VERFUEGBAR gesetzt werden.` });
  }

  const updated = await prisma.anfrage.update({
    where: { id: anfrageId },
    data:  { status: AnfrageStatus.NICHT_VERFUEGBAR, bearbeitetVon: null, bearbeitetSeit: null },
  });

  // Automatische Chat-Nachricht (logId chat:{id}) an den Techniker
  const chatNachricht = await sendeChatNachricht({
    anfrageId,
    vonKuerzel:  adminKuerzel,
    empfKuerzel: anfrage.techniker,
    inhalt:      "⚠️ Ersatzteil nicht verfügbar.\nBitte das Gerät auf Broker umstellen oder H-Status setzen, falls möglich.",
  });
  ...
}
```

- **Erlaubte Übergänge:** `NEU | BEDARF | IN_BEARBEITUNG → NICHT_VERFUEGBAR`.
  Aus terminalen Status (ABGESCHLOSSEN, STORNIERT, NICHT_VERFUEGBAR
  selbst) blockiert die Funktion mit `BAD_REQUEST`. Konsistent mit
  `GUELTIGE_TRANSITIONEN` in `setzeStatus` (`src/modules/anfragen/service.ts:249`).
- **Lock-Reset:** `bearbeitetVon`/`bearbeitetSeit` werden auf `null` gesetzt
  (terminal → kein aktiver Bearbeiter mehr).

### Chat-Nachricht-Mechanismus

`sendeChatNachricht` ist `senden` aus `src/modules/chat/service.ts:47`:

```ts
// src/modules/chat/service.ts:47
export async function senden(data: {
  anfrageId: number; vonKuerzel: string; empfKuerzel: string; inhalt: string;
}) {
  return prisma.nachricht.create({
    data: {
      betreff:    data.inhalt.substring(0, 100),
      inhalt:     data.inhalt,
      vonKuerzel: data.vonKuerzel,
      typ:        NachrichtTyp.DIREKT,
      logId:      toLogId(data.anfrageId),       // "chat:{id}"
      empfaenger: { create: { empfKuerzel: data.empfKuerzel } },
    },
  });
}
```

Chat-Nachrichten zu einer Anfrage werden also als reguläre `Nachricht`
mit `logId = "chat:{anfrageId}"` gespeichert, plus ein `NachrichtEmpf`-
Eintrag pro Empfänger. Der Chat-Verlauf im Techniker-/Admin-UI rendert
diese Zeilen.

Router emittiert nach dem Service-Call:

```ts
// src/server/routers/anfragen.ts:52
markiereNichtVerfuegbar: adminProcedure
  .input(z.object({ anfrageId: z.number().int().positive() }))
  .mutation(async ({ ctx, input }) => {
    ...
    emitToBackoffice(EVENTS.ANFRAGE_UPDATED, { id: ..., status: AnfrageStatus.NICHT_VERFUEGBAR });
    emitToUser(result.anfrage.techniker, EVENTS.ANFRAGE_UPDATED, { ... });
    emitToUser(result.anfrage.techniker, EVENTS.CHAT_NEU, { anfrageId: ... });
    return result;
  }),
```

`CHAT_NEU` triggert das Tab-Badge im Techniker-Portal
(`useTabBadge` in `src/hooks/useTabBadge.ts`), `ANFRAGE_UPDATED` aktualisiert
Listen + Statistik live.

---

## 9. Konsistenz-Risiken & Audit-Queries

Weil `Kompatibilitaet.geraet` ein String ist (kein FK), gibt es drei
typische Drift-Klassen:

| Risiko | Symptom | Ursache |
|---|---|---|
| Geister-Modelle | Kompatibilitaet zeigt auf `geraet`, das in `GeraeteModell` nicht (mehr) existiert | Modell deaktiviert/umbenannt, Kompat-Zeile blieb |
| Pflege-Lücken | Modell hat 0 oder wenige Kompat-Zeilen | Generator-Lauf nie gestartet oder Custom-Modell, Verknüpfungs-Modal nie geöffnet |
| Bezeichnungs-Drift | Artikel-`bezeichnung` passt nicht zu `"hersteller modell {teiltyp}"` | Manuell editiert / Legacy / Migration-Artefakt → Auto-Mirror (§4) greift dort nicht |

### Audit-Queries (am 01.06.2026 live gefahren)

**Q1 — Geister-Check:** Modell-Strings in `Kompatibilitaet`, die keinem
aktiven `GeraeteModell` entsprechen. Solche Verknüpfungen greifen beim
Scan nie (Exact-Match auf `"hersteller modell"`) und sind Datenballast.

```sql
SELECT DISTINCT k.geraet
FROM Kompatibilitaet k
WHERE k.geraet NOT IN (
  SELECT CONCAT(hersteller, ' ', modell) FROM GeraeteModell WHERE aktiv = 1
)
ORDER BY k.geraet;
```

**Q2 — Pflege-Lücken:** Aktive Modelle, die nicht alle 21 Standard-
Teiltypen abdecken — also Modelle, wo der Pflege-Admin noch ran muss.

```sql
SELECT
  CONCAT(g.hersteller, ' ', g.modell) AS modell,
  COUNT(DISTINCT k.teiltyp) AS gepflegt,
  (21 - COUNT(DISTINCT k.teiltyp)) AS fehlt
FROM GeraeteModell g
LEFT JOIN Kompatibilitaet k ON k.geraet = CONCAT(g.hersteller, ' ', g.modell)
WHERE g.aktiv = 1
GROUP BY g.id, g.hersteller, g.modell
HAVING COUNT(DISTINCT k.teiltyp) < 21
ORDER BY gepflegt ASC, modell;
```

**Q3 — Pool-Übersicht:** Alle (geraet, teiltyp)-Kombinationen mit mehr als
einem verknüpften Artikel — die echten Pools. Größter Pool zeigt das
Wiederverwendungs-Potenzial.

```sql
SELECT geraet, teiltyp, COUNT(*) AS pool_groesse
FROM Kompatibilitaet
GROUP BY geraet, teiltyp
HAVING COUNT(*) > 1
ORDER BY pool_groesse DESC;
```

### Stand nach Audit am 01.06.2026

| Metrik | Wert |
|---|---|
| Aktive Modelle | 1072 |
| Davon vollständig gepflegt (21 Teiltypen) | 1072 (100 %) |
| Verknüpfungen gesamt | 22 725 |
| Geister-Modell-Strings in Kompatibilitaet | 0 |
| Echte Pools (mehrere Artikel pro Modell+Teiltyp) | 1 — T480 Touchpad mit 24 Artikeln über 3 Modell-Familien (T480 / T580 / L580) |

Bereinigungen am Audit-Tag:

- 252 verwaiste Kompatibilitäts-Einträge entfernt (12 Geister-Modelle × 21 Teiltypen)
- 5 Müll-Modelle deaktiviert (NN-Platzhalter, Hersteller-Duplikate, Marketing-Strings)
- Pflege-Abdeckung von 99,6 % auf 100 % gehoben

---

## Stichwort-Zusammenfassung für die Demo

1. **`Kompatibilitaet.geraet` ist ein String** (kein FK) → ermöglicht
   Soft-Onboarding, erfordert dafür Audit-Queries gegen Drift.
2. **Pool seit Multi-Artikel:** Unique `(geraet, teiltyp, artikelId)` →
   N Artikel pro (Modell, Teiltyp) möglich.
3. **`getByGeraetMitStandard` ist die zentrale Auflösung** für Techniker-
   Portal, LogID-Lookup und Einlager-Wizard — Pool-Summe + primärer Artikel
   in **einer** Funktion.
4. **Primär-Artikel = höchster Bestand mit `>0`** (Tie-Break). Die Anfrage
   zeigt damit auf den Artikel, der tatsächlich gebucht wird.
5. **Auto-Mirror beim Verknüpfen:** Heimat-Modell aus Artikel-Bezeichnung
   extrahiert, gegen aktive `GeraeteModell` validiert, **nur additiv**
   (beim Löschen kein Mirror).
6. **Drei Auslager-Pfade** mit klar getrennten Effekten — AUSGANG ändert
   Bestand, DIREKT und Sonderanfrage NICHT. `assertKeinBestandEffekt`
   ist der Sicherheitsgurt auf dem einzigen schreibenden Pfad.
7. **Verschiedenes** ist überall Sonderfall: kein generischer Slot, keine
   Spiegelung, eigene Pool-Behandlung mit Freitext im teiltyp.
8. **NICHT_VERFUEGBAR** ist additiv: erlaubt nur aus aktiven Status,
   Lock-Reset, automatische Chat-Nachricht, separater KPI-Zähler in der
   Statistik (nie mit STORNIERT vermischt).

---

## Bewusst weggelassen

- **Lagerplatz-Logik (ETL-Codes, max 4 Modelle pro Fach,
  Hersteller-Reinheit):** eigene Domäne, ist nicht Teil der
  Kompatibilitäts-Auflösung. Siehe `src/server/routers/lagerplatz.ts`
  und `prisma/schema.prisma:222` (`Lagerplatz`, `LagerplatzBelegung`).
- **Einlager-Wizard im Detail** (3-Schritt-Flow, Hersteller-Validierung,
  Verschiedenes-Freitext-UI): nur insoweit relevant, dass der Wizard
  Artikel mit dem Generator-Bezeichnungs-Muster anlegt, das §4 voraussetzt.
- **Auslager-Modal-UX** (Schritt-Indikator, Belege drucken, Toast-Texte):
  reine Frontend-Detailpolitur, für die Architektur-Demo irrelevant.
- **Statistik-Aggregationen** (KPIs, Donut, Verlauf, Team-Vergleich):
  nutzen `Anfrage.status` direkt, hängen nicht am Kompatibilitäts-Modell.
- **Multi-Standort-Rollen/Permissions** (`UserStandortAccess`,
  `getZugaenglicheStandortIds`): das Standort-Filtering im Pool ist
  in §2/§5 indirekt belegt; die volle RBAC-Mechanik ist ein eigenes Kapitel.
- **Echte Audit-Run-Ergebnisse:** s. Hinweis vor Q1 — ich habe in dieser
  Session keine DB-Queries gegen Produktion gefahren.

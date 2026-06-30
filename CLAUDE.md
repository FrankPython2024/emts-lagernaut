# CLAUDE.md — EMTS Lagernaut v2

> Diese Datei wird von Claude Code beim Start gelesen. Sie bündelt den dauerhaften
> Projektkontext, die Deploy-Regeln und den aktuellen Stand. Bei Änderungen am
> Projekt bitte aktuell halten.

---

## Projekt

**EMTS Lagernaut v2** — Warehouse-Management-System für IT-Refurbishment bei **AfB Sömmerda**
(sozial-grünes IT-Unternehmen). Löste ein Google-Sheets/Apps-Script-v1 ab, läuft in
Produktion. Inklusiv by design: **WCAG 2.1 AA, leichte Sprache, 56px Touch-Targets,
3 Schriftgrößen, Dark/Light**. Der **Einlager-Assistent** ist die UX-Referenz für Inklusivität.

**AfB-Markenfarben:** Primär `#202F61` · Cyan `#008BD2` · Grün `#04B475`

---

## Stack & Infrastruktur

- **Runtime:** Next.js 15 · React 19 · TypeScript · tRPC v11 · **Prisma 5.22 (gepinnt — NIE auf v7)** ·
  MySQL 8 · Redis (ioredis, `enableOfflineQueue:false`) · BullMQ · Socket.io · Meilisearch ·
  NextAuth (JWT/Credentials) · Docker Compose
- **VPS:** Hetzner CX23 — `49.13.162.158`, Pfad `/var/www/lagernaut/emts-lagernaut`,
  live unter `https://emts-lagernaut.duckdns.org`
- **GitHub:** `FrankPython2024/emts-lagernaut`
- **Lokal:** Frank arbeitet auf Windows/PowerShell (`C:\Users\Laptop\Desktop\EMTS Lagernaut`)
- **Charts:** recharts · **Drag & Drop:** react-grid-layout · **QR:** `qrcode` / `qrcode.react` ·
  **Print-Labels:** custom `src/lib/print/` (57×32mm Artikel/Verbrauchsmaterial; 55×30mm Colli)
- **Nginx:** WS-fähig (`map` + `proxy_buffering off` + 86400s Timeout)

---

## ⚠️ Deploy-Regeln (WICHTIG)

**Claude Code committet und pusht NIE selbst.** Frank macht `git add` / commit / push mit
**explizit benannten Pfaden** (kein `git add -A`, solange keine `.gitignore` existiert).

**NIEMALS stagen:** `.claude/settings.local.json`, `tsconfig.tsbuildinfo`, `*_AUDIT.md`,
`*_DIAGNOSE.md`, `*.csv`

**Wiederkehrende Falle:** Gezieltes `git add` lässt oft eine geänderte Hilfsdatei zurück
(z.B. `src/lib/mobil/export.ts`) → Build bricht mit „Module not found" / „has no exported
member" ab. **Reflex: vor JEDEM Push `git status` prüfen**, ob wirklich alle geänderten
Dateien gestaged sind.

**Build erfordert Swap** (4GB-VPS, OOM-Schutz):
```bash
swapon /swap_build_4g 2>/dev/null; cd /var/www/lagernaut/emts-lagernaut && git pull && docker compose up -d --build
```

**Bei Schema-Änderung** verkettet anhängen (minimiert Fenster, in dem Code eine fehlende
Spalte liest):
```bash
... && docker compose exec -T app npx prisma db push
```
**STOPP-Punkt:** Bei jeder „data loss"-/`DROP`-Warnung in `db push` → **abbrechen** und
melden. Nur additive Änderungen ohne Bestätigung durchziehen.

**RBAC-Änderung:** `docker compose exec app npx tsx prisma/scripts/seed-rbac.ts` (idempotent).

**Prisma 7 bricht** `url = env("DATABASE_URL")` in schema.prisma → Build-Fehler.
Falls v7 im Build auftaucht: `rm -rf node_modules` auf VPS + `docker compose build --no-cache`.

---

## DB-Diagnose ohne Passwort

`mysql -p` triggert Passwort-Prompt → **nicht nutzen**. Stattdessen Prisma im Container:
```bash
docker compose exec -T app node <<'EOF'
const {PrismaClient}=require("@prisma/client");
const p=new PrismaClient();
(async()=>{ /* ... */ })().finally(()=>p.$disconnect());
EOF
```
- Linux-MySQL: **Tabellennamen case-sensitive** (GeraeteModell/Anfrage/Artikel/
  Kompatibilitaet/LagerplatzBelegung großgeschrieben; lagerplatz klein).
- **CSV-Dateien sind QUOTED** (`"LogId";"..."`) und können **BOM** haben → beim Einlesen
  Quotes + BOM strippen: `s.replace(/^\uFEFF/,"").trim().replace(/^"(.*)"$/,"$1").trim()`.
- **CSV im Container ist flüchtig:** Nach jedem Rebuild verschwindet eine per
  `docker compose cp` kopierte Datei → erneut kopieren.

---

## Arbeitsweise mit Frank

- **Ein Schritt pro Antwort**, auf Output warten, dann nächster Schritt.
- **Plain-Language zuerst** (Problem + was der Fix bewirkt, optional ein Beispiel),
  danach technischer Output.
- **Konservative Aufwandsschätzung** (Feature-Pass = 15–30 Min, nicht Stunden); konkrete
  Schritte statt Zeit-Labels.
- **Datum/Zeit per Websuche verifizieren**, nicht aus dem Verlauf ableiten.
- **Risikoreiche DB-Operationen immer erst als Trockenlauf/SELECT**, bevor geschrieben wird.

---

## Kern-Prinzipien & Lernpunkte

- **DIREKT-Buchung = Pass-Through, ändert NIE den Bestand.** `assertKeinBestandEffekt()`-Guard
  erzwingt das im Code. Gilt auch für BEDARF-Teile via DIREKT-Pfad und Test-Modus.
- **Duplikat-Vermeidung:** Vor dem Anlegen eines Modell/Artikel IMMER case-insensitiv prüfen,
  MIT und OHNE Hersteller-Präfix. Bei Mehrdeutigkeit Admin-Bestätigung. Datenkonsistenz hat
  höchste Priorität.
- **Hersteller-Präfix:** `GeraeteLookup.bereinigt` MIT Präfix ("HP EliteBook 840 G5");
  `Kompatibilitaet.geraet` und `Artikel.bezeichnung` OHNE ("EliteBook 840 G5"). Zentral:
  `src/lib/geraete/modellName.ts` (`stripHerstellerPrefix()`, `getModellInfoForLogId()`).
- **`PickupPosition.bezeichnung` muss `@db.Text`** sein (nicht VARCHAR 191) — Overflow killt
  still den ganzen `createMany`-Batch. `bereinigePositionsFelder()` cappt defensiv
  (colli/stellplatz→191, bezeichnung→2000; logId nie cappen).
- **Anfrage hat keinen `modellId`-FK** — Bestell-Empfehlung aggregiert per `geraeteName`-String.
- **Socket.io-Panel ≠ Auth-State.** Sockets bestehen bis Tab-Reload, unabhängig vom Token.
- **Geräte-Import:** nur HP, Lenovo, Dell, Fujitsu (typo-tolerant; HPE explizit abgelehnt =
  Server). Modellnummern bleiben erhalten ("Precision 7530"); Marketing-Text raus.

---

## Modul-Stand (zuletzt: Mobil-Bereich „digital Education", Parser ~99,5 %, Mobil-Anfragen A+B, Login-Routing /start)

### Mobil-Ersatzteile (Smartphone/Tablet-Teile via LogID aus ReForm-CSV) — KOMPLETT & AUDITIERT
- **Quelle:** ReForm-CSV-Export (";"-getrennt, UTF-8, Werte in Quotes, 44 Spalten; alle Infos
  nur im Freitext "Bezeichnung"; Geräteart/Hersteller/Status/Verbleib unbrauchbar).
  Nützliche Spalten: LogId, Bezeichnung, Colli, Stellplatz, EK (dt. Komma), AAN, Lieferant.
- **Schema:** `MobilModell`, `MobilTeiltyp`, `MobilTeil` (logId @unique, +aan, +lieferant, +farbe,
  +ausgeschieden/-Am, +zuletztGesehenImport, **+bereich** @db.VarChar(32) default "STANDARD"),
  `MobilTeilModell` (n:m), `MobilAlias`, `MobilMindestbestand` (**@@unique [modellId,teiltypId,bereich]**
  + `@@index([modellId])`), `MobilAnfrage` (s.u.).
- **Bereich/Kostenstelle „digital Education":** `MobilTeil.bereich` trennt reguläre Teile ("STANDARD")
  von "DIGITAL_EDUCATION" (eigene Kostenstelle). Eigener **Reiter** in `/admin/mobil` (Standard ↔
  digital Education), eigener Import (Bereich-Auswahl), eigene Statistik (Umschalter), getrennte
  Zahlen. **ALLE Browse-/Statistik-Queries filtern `bereich`.** Import bereich-gescoped: ein DE-Import
  berührt NUR DE-Teile (Abgangs-Erkennung zusätzlich nach bereich). Mindestbestand **pro Bereich**.
  ⚠️ **MySQL-Falle:** der 3-spaltige Unique braucht `@@index([modellId])`, sonst lässt sich der alte
  2-spaltige Unique nicht droppen (modellId-FK braucht ihn als Backing) — `db push` ordnet das NICHT
  selbst, daher per Hand migriert: ALTER ADD COLUMN bereich → ADD INDEX(modellId) → DROP altes Unique
  → ADD neues 3-spaltiges Unique (Namen Prisma-konform `..._key`/`..._idx`).
- **Ein MobilTeil pro LogID** (1 physisches Stück). Kompatible Modelle in `MobilTeilModell`-Join,
  `MobilTeil.modellId` = primär. **Bestand = COUNT(DISTINCT teilId)** je Bereich, EK über Primär-Modell.
- **Parser** (`src/lib/mobil/parser.ts`): Hersteller/Modell/Teiltyp/Farbe-Erkennung. Teiltypen:
  Akku, Display, Displaymodul, Digitizer, Kameraglas, Backcover, Middle Frame, SIM-Tray, **Klebestreifen**.
  - **Displaymodul** = Display/Screen-Familie + Modul-Marker (modul/assembly/einheit) ODER die Phrase
    **„Modul[e] Assembly" allein** (iPad-Lieferanten-Wortlaut ohne „Display"). Reines LCD/OLED/Touch →
    Display; Digitizer = reines Touch-Glas (geht vor).
  - **iPad:** Größe auch in **„inch"-Schreibweise** + Jahr ohne Klammer („iPad (10.9 inch 2022)" →
    iPad 10.9" (2022)); iPad Air 3 robust (10[.,]5"); generische Größen iPad 10.2"/10.9".
  - **Klebestreifen** = „adhesive strip/tape/seal" / „Klebestreifen/Kleberahmen" (nur als Haupt-Teil).
  - **Keyword-frei** mit FREMD_KEYWORD-Guard (iphone/ipad/samsung/galaxy/pixel/google/xiaomi/redmi/
    poco/sm- → kein Raten). Erkennung ~99,5 % auf den iPad-CSVs (Test `npm run test:mobil`).
  - **Samsung:** „Samsung S21+" → „Galaxy S21 Plus"; S21 ≠ S21+; „SM-S908" ≠ S9; Display↔Backcover:
    letztes Schlüsselwort gewinnt.
- **Import** (`src/modules/mobil/import.ts`): idempotenter Upsert by logId, MANUELL geschützt.
  **Abgangs-Erkennung (Snapshot→Diff):** fehlt im Import → `ausgeschieden=true`, gescoped nach
  **bereich** (Pflicht) + Hersteller (K1-Default; `vollAbgleich` herstellerübergreifend). 50%-Sicherung
  pro Scope. Wieder-Eingang reaktiviert.
- **Bestandsintegrität:** ALLE zählenden Queries filtern `ausgeschieden=false` UND `bereich`.
- **UI:** `/admin/mobil` (Reiter Standard/digital Education → Hersteller→Modell→Teile-Modal mit
  Chip-Liste 📍🎨·AAN·EK·🏭, nach Colli), `/admin/mobil/import` (Bereich-Auswahl, Trockenlauf default),
  `/admin/mobil/statistik` (recharts + Bereich-Umschalter; Drill-down → `statTeileDetail`),
  `/admin/mobil/anfragen` (Mobil-Anfragen, s.u.).
- **Rechte:** `MOBIL_VIEW`/`MOBIL_MANAGE`, an ADMIN geseedet.
- **Export-Download (CSV/XLSX): server-seitiger Endpoint** `src/pages/api/mobil/export.ts`
  (`Content-Disposition: attachment`) — ein echter Link `/api/mobil/export?format=&modellId=&teiltyp=&bereich=`,
  **KEIN** programmatischer Blob-Klick (der startete in manchen Browsern/WebViews still nicht; bewährtes
  Muster wie Fehlteile/Lagerfuchs). Clipboard = nur LogIDs.

### Mobil-Anfragen (Techniker fragt Mobilteil an) — A+B komplett
- **Schema:** `MobilAnfrage` (techniker, bereich, modellId→MobilModell, teiltyp String, menge,
  kommentar, status `MobilAnfrageStatus`, bearbeitetVon, erledigtLogId). Eigenes System, KEIN
  Artikel-/Laptop-Anfrage-Bezug (verschmutzt deren Statistik/Bestell-Empfehlung nicht).
- **Recht:** `ANFRAGE_MOBIL_CREATE` (pro Nutzer vergebbar; Laptop bleibt `ANFRAGE_CREATE`). Springer
  = beide; Nur-Mobil = MOBIL_CREATE geben + ANFRAGE_CREATE per Deny entziehen. ADMIN via Wildcard.
- **Techniker-Flow** (`src/app/techniker/MobilAnfrageBereich.tsx`, rechtebasierter Reiter im Portal):
  Bereich → Hersteller → Modell. **Klick aufs Modell öffnet ein Pop-up** (wie Admin-Übersicht) mit
  den Teiltypen, Teiltyp → Dialog (Menge/Kommentar) → anfragen. **KEIN „Bedarf" für Mobil:** nur
  Teiltypen mit Bestand >0 erscheinen/sind anfragbar; `erstellen` lehnt 0-Bestand ab (Race-Schutz),
  Status immer NEU. Router `mobilAnfrage` (hersteller/modelle/teiltypen/erstellen/meine), gated
  ANFRAGE_MOBIL_CREATE.
- **Admin-Bearbeitung:** geteilte Komponente `MobilAnfragenListe` — als eigene Seite
  `/admin/mobil/anfragen` UND als **Reiter „📱 Mobil" in `/admin/anfragen`** (optisch getrennt vom
  Notebook). Filter Status/Bereich, „N offen"-Badge. Aktionen (MOBIL_MANAGE): In Arbeit / Storno /
  **Ausgeben** (wählt eine LogID → markiert das Teil `ausgeschieden` = Abgang) / „Ohne Teil erledigen".
- **Kein Test-Modus** für Mobil-Anfragen (anders als Laptop).

### Kategorie-Preise & Wert-Auswertung (Laptop-Ersatzteile)
- **Problem:** Laptop-`Artikel` haben keinen Preis (aus Altgeräten geerntet). Lösung: Stückpreis je
  **Kategorie** pflegen → Wert der über Anfragen ausgegebenen Teile auswerten.
- **Schema:** `KategoriePreis` (kategorie @unique @db.VarChar(191), preis @db.Decimal(10,2),
  erstelltAm/aktualisiertAm). Additiv, **kein FK** auf Artikel (Verknüpfung über Kategorie-Name-String).
- **Eingabe:** `/admin/preise` (Nav „💶 Kategorie-Preise", Stammdaten). Kategorie-Liste kommt **LIVE
  aus `Artikel.groupBy(kategorie)`** (immer = echte DB, ~22 Kategorien), je Zeile Preis-Feld (dt.
  Komma), **Bulk-Speichern** nur geänderter Zeilen. tRPC `preise.kategorienMitPreis` /
  `preise.setzePreise` (preis=null → Eintrag löschen). Decimal→number serverseitig (superjson).
- **Auswertung:** Panel **„💸 Wert ausgegeben"** in `/admin/statistiken` (Übersicht „Alle Techniker").
  `preise.wertAusgegeben`: `SUM(menge × Kategorie-Preis)` über Buchungen `typ IN (AUSGANG, DIREKT)`,
  gejoint Buchung→Artikel(kategorie)→KategoriePreis ($queryRaw). Folgt dem Seiten-Zeitfilter (`tage`)
  + Standortfilter. Kategorien **ohne** Preis separat gewarnt (zählen NICHT in die Summe).
- **Caveat:** kein Preis-Snapshot auf `Buchung` → bewertet mit **aktuellem** Preis (Vergangenheitswert
  ändert sich bei Preis-Anpassung). Test-Modus nicht enthalten (erzeugt keine echte Buchung).
- **Rechte:** wiederverwendet `ARTIKEL_VIEW`/`ARTIKEL_EDIT` (Preise) + `STATISTIK_VIEW` (Auswertung) —
  **kein neues Recht, kein seed-rbac** (nur `db push` für die neue Tabelle nötig).

### Verbrauchsmaterial — erweitert
- **Schema:** `VerbrauchsArtikel` (code/QR, name, mindestbestand, aktuellerBestand, aktiv …) +
  `VerbrauchsZaehlung` (artikelId, datum, vorher, bestand, verbrauch=max(0,vorher−bestand),
  benutzer). **Kein Runden-/Inventur-Modell** — „aktuelle Runde" = diese Woche (Montag 00:00).
- **Handheld-Scan:** `/admin/verbrauchsmaterial/zaehlen`. `artikelByCode` (Scan-Lookup),
  `zaehlen` (Mutation), `dieseWoche` (Fortschritt X/Y).
- **NEU — „Noch offen"-Liste:** `dieseWoche` liefert zusätzlich `offen`/`offenAnzahl` (aktive
  Artikel minus diese Woche gezählte). Handheld zeigt antippbare Liste der ungezählten Artikel
  (Antippen aktiviert via `waehleAusSuche`); selbst-aktualisierend nach jedem Speichern.
- **NEU — „Teilmenge dazuzählen"** (Artikel an mehreren Lagerorten): `zaehlen` hat Modus
  `addieren`/`ersetzen` (default ersetzen). Bei existierender Wochen-Zählung **UPDATE statt
  CREATE** (eine Zählung pro Artikel/Woche). **`vorher` bleibt IMMER der Vorwochenwert**
  (aus `woche.vorher`), `bestand` wächst (4+6=10), `verbrauch`=max(0,vorher−summe). Behebt
  nebenbei Bug, dass erneutes Zählen `vorher` verfälschte. UI: orangenes Banner „schon X
  erfasst" + Buttons ➕Dazuzählen (grün, default bei Re-Scan) / ✏️Ersetzen (blau) + Live-Summe.
  Dazuzählen nur via **Code-Scan**; Suche/Offen-Liste → immer ersetzen.

### Weitere Module (live)
- Admin-Portal (Artikel, Buchungen, Anfragen mit Lock-System, Modelle/Kompatibilität, Benutzer,
  Statistiken, Nerd-Dashboard, Einlager-Assistent, LogID-Lookup, Activity Log, Belege 57×32mm)
- Techniker-Portal (LogID-Suche, 4-Zustände-Grid, Warenkorb, Sonderanfragen, Chat, Profil)
- Lagerfuchs (Geräte-Tracking aus ReForm-LogID-CSV; Snapshot→Diff; Tabs Übersicht/Auswertungen/
  Stellplatz/Ausgeschieden/Importe/Gerät-verfolgen/Fehlteile)
- Pickup-Modul, Lagerwagen/Hauptcolli, Colli-Etiketten (55×30mm), Globale Suche (Meilisearch),
  Dashboard 2.0 (12 Widgets, drag&drop), Multi-Standort

### RBAC
- Rollen ∪ individuelle `UserPermission` (additiv) ∖ `UserPermissionDeny` (Entzug gewinnt;
  SYSTEM_ADMIN nie entziehbar = Lockout-Schutz). `getMeinePermissions` in
  `src/modules/rollen/service.ts` liest live aus DB.
- **Rollen:** ADMIN (Wildcard), ADMIN_READONLY (Latifa, 9 Read-Rechte), BETRACHTER (Lagerchef),
  PICKUP, TECHNIKER.
- **`permissionProcedure`** ist wildcard-aware. **`adminProcedure`** prüft nur `rolle==="ADMIN"`
  (ignoriert SYSTEM_ADMIN-Wildcard) → ~116 Procedures hängen daran. **Offene M1-Migration:**
  inkrementell adminProcedure→permissionProcedure umstellen, damit „Recht entziehen" auch dort
  greift.
- **Login-Routing (`/start`):** nach Login entscheidet `/start` rechtebasiert (live) — Admin-Rolle
  (ADMIN/ADMIN_READONLY/BETRACHTER) **+** Anfrage-Recht → Auswahl „🛠️ Verwaltung / 📝 Anfragen";
  nur Anfrage-Recht → `/techniker`; nur Admin → `/admin`; Pickup → `/pickup`. Root `/` leitet auf
  `/start`. Damit auch NICHT-Techniker-Rollen mit Anfrage-Recht ins Portal kommen, prüft die
  **Edge-Middleware `/techniker` rechtebasiert** über ein `darfAnfragen`-Flag im **JWT** (beim Login
  aus den Rechten aufgelöst, `src/core/auth/config.ts`; Middleware-Matcher um `/start` ergänzt).
  ⚠️ Anfrage-Recht NACH dem Login vergeben/entzogen → fürs **Routing** erst nach Re-Login wirksam
  (die Seiten selbst prüfen weiter live via `usePermissions`).

---

## Offene Punkte / Backlog

- **Mobil-Audit-Reste:** H1 (parallele Importe nicht serialisiert), NIEDRIG-Kosmetik (totes
  `MobilModell.aktiv`, `logIdsProTeiltyp`↔`statTeileDetail`-Doppelung, fehlende Indizes
  colli/zuletztGesehenImport). M1 (parseEk ×100 bei Punkt-Dezimal) = latent, aktuell kein
  Schaden (alle EK dt. Komma, max 186,60€).
- **`.gitignore`** anlegen (.claude/, tsconfig.tsbuildinfo, *_AUDIT.md, *_DIAGNOSE.md, *.csv)
  → dann wird `git add -A` sicher. Löst das wiederkehrende Untracked-Problem dauerhaft.
- **RBAC M1-Migration** (adminProcedure→permissionProcedure).
- **MEILISEARCH_KEY rotieren** (noch Default).
- Temp `console.log("[nav]…")` in `src/pages/api/socketio.ts` entfernen.
- Mobil-Statistik-Bestandsverlauf füllt sich automatisch über kommende Importe (aktuell
  Platzhalter, 1 Zeitpunkt).
- Mobile-responsive für breite Tabellen (Lagerfuchs zuerst; Ziel: Zebra Android Handheld).
- Login-freie QR-Erfassungsseite `/q/[token]` für Verbrauchsmaterial (grünes Licht, nicht
  gestartet).
- Hybrid-Konzept ReForm (Java/MySQL, Stammdaten-Quelle) + Lagernaut (Workshop-Modul) — laufend
  mit Latifa.

---

## Geschäftsregeln (Referenz)

- **ETL-Sömmerda Lagerung:** `ETL-{Regal}-{Ebene}-{Fach}`; ein Fach = ein Modell (bis 4 Boxen);
  Regale 1+11=Lenovo, 7+8=Dell, 9+10=HP, Fujitsu flexibel; 125 Plätze.
- **17 Standard-Teiltypen (Laptop):** Mainboard, Display, Displaymodul, Touchpad, Touchpad
  Buttons, Tastatur, Lautsprecher, Füße vorne/hinten, Power Button, USB Board, LAN Board,
  WLAN/UMTS Karte, Akku, D-Cover, DC IN. Plus Sonderanfragen.
- **Bestandsregeln:** Bestand >0 → NEU; =0 → BEDARF; exakter Modell-Match via LogID (kein
  Fuzzy). Kein Lagerplatz im Techniker-Portal sichtbar.
- **Status-Flow:** NEU → IN_BEARBEITUNG → ABGESCHLOSSEN; Storno nur bei NEU/BEDARF.

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

**Build erfordert Swap** (4GB-VPS, OOM-Schutz) **und vorher Cache aufräumen** — der Docker-
Build-Cache wuchs in wenigen Deploys auf ~8 GB und hat am 2026-08-05 die Platte gefüllt
(Details unten). `builder prune` kostet nichts, weil `--build` den Cache ohnehin verwirft:
```bash
swapon /swap_build_4g 2>/dev/null; docker builder prune -af; cd /var/www/lagernaut/emts-lagernaut && git pull && docker compose up -d --build
```
`docker builder prune -af` (Build-Cache) und `docker image prune -af` (ungenutzte Images)
sind gefahrlos. **NIEMALS `docker system prune --volumes`** — dort liegt die MySQL-Datenbank.

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

### ⚠️ Server-Reboot: NIEMALS vorher `docker compose stop`

Alle vier Dienste haben `restart: unless-stopped`. Das heißt wörtlich „starte neu, **außer** es
wurde bewusst gestoppt" — ein per `stop` gestoppter Container bleibt nach dem Reboot **unten**.
Am 2026-08-17 war Lagernaut deshalb nach einem Kernel-Update tot: `docker compose ps` lieferte
eine **leere Tabelle** (nicht etwa Container im Status „Exited"), Startseite 502.
- **Richtig:** einfach `reboot`. systemd stoppt die Container selbst, Docker startet sie beim
  Hochfahren wieder — MySQL bekommt dabei 10 s zum Wegschreiben, was im Leerlauf reicht.
- **Falls doch gestoppt wurde:** danach von Hand `docker compose up -d` (kein Rebuild nötig,
  die Images sind noch da). Nach einem Reboot **~25 s warten**, bevor man die Startseite prüft —
  der MySQL-Kaltstart dauert länger, bis dahin liefert die App 502.
- Reboot-Bedarf steht in `/var/run/reboot-required.pkgs` (Kernel/libc → wirklich neu starten).
- Der Build-Swap ist nach dem Reboot aus; der Deploy-Befehl schaltet ihn mit `swapon` selbst ein.

### ⚠️ „PrismaClient is not a constructor" — ZUERST Paket gegen Bundle prüfen

Dieses Fehlerbild (500 auf allen Seiten, Log wiederholt
`TypeError: d.PrismaClient is not a constructor` aus `.next/server/…/route.js`) sieht nach der
Prisma-Falle oben aus, war am **2026-08-05 aber ein kaputter Build**. Erst dieser Test:
```bash
docker compose exec -T app sh -c '
node -e "console.log(require(\"@prisma/client/package.json\").version)"
node -e "console.log(typeof require(\"@prisma/client\").PrismaClient)"
ls node_modules/.prisma/client'
```
**Steht dort `5.22.0` und `function`, ist die Prisma-Spur tot** — das Paket ist gesund, nur das
*kompilierte Bundle* ist es nicht. Ursache war: Build-Cache füllte die Platte → Build brach beim
Schreiben ab (`no space left on device`) → halbfertiges `.next` blieb liegen.
Behebung: `docker builder prune -af` + `docker image prune -af`, dann
`docker compose build --no-cache app && docker compose up -d app`, danach `prisma db push`.

Zwei Fallstricke bei der Suche:
- **`df -h` kann lügen** — es zeigte 16 GB frei, während es schon knallte. Immer auch **`df -i`**
  prüfen (Inodes); `node_modules` bringt Hunderttausende Kleinstdateien mit.
- **HTTP 307 auf `/` ist KORREKT** (Weiterleitung auf `/start`). Mit `curl -skL … -w "%{http_code}"`
  prüfen, sonst hält man die gesunde Weiterleitung für den Fehler.
- Nach `docker image prune -af` wird `node:20-alpine` neu geladen; `apk add` scheiterte dabei einmal
  mit **Exit-Code 3** (Spiegelserver). Kein echtes Problem — einfach nochmal bauen.

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

## Modul-Stand (zuletzt: Teilenummern + Foto-Erkennung + Gerätefotos; davor Teiltyp-Massenzuordnung, Bestellanfragen Eigenbedarf, Datenträger/RAM-Erfassung, Abgaben an Niederlassungen)

### ⚠️ Ein Barcode ist NICHT die Teilenummer (Kernerkenntnis 2026-08-19)

Der wichtigste Satz aus dem ganzen Teilenummern-Thema, gemessen mit der eigenen
Suchinstanz:

| gesucht | Fundstellen |
|---|---|
| `DA0X8JTB8D0` (aufgedruckt, HP USB-Board) | **43** |
| `8SSN20V43652C3DG1AK01XR` (Barcode, Lenovo-Tastatur) | **0** |

Beide stehen auf demselben Etikett. Der **Scanner nimmt den Barcode**, und der
enthält zusätzlich Werk, Datum und Stücknummer — er beschreibt also **genau
dieses eine Exemplar** und steht nirgends im Netz. Suchbar ist nur die im
Klartext aufgedruckte Nummer.

Folgen im Code:
- `kandidaten()` in `src/modules/teilenummern/service.ts` zerlegt Sammelbarcodes
  in plausible Teilstücke und sucht auch danach — **ohne Herstellerwissen**,
  damit die Regel nicht altert. Trifft aber nicht jedes Format.
- `kuerzungsVorschlaege()` liefert anklickbare Kürzungen auf der Pflegeseite.
  Reihenfolge ist Absicht: Vorsatz 2 / Länge 10 zuerst → bei „8SSN20V43652…"
  steht `SN20V43652` an erster Stelle.
- **Deshalb ist der Fotoweg entstanden:** Das Foto liest den Klartext.

### Teilenummern als Artikel-Identität (Aug 2026)

**`Artikel.teilenummerId` schlägt die Bezeichnung.** Dasselbe USB-Board, einmal
über die LogID eines Spendergeräts geerntet und einmal lose erfasst, muss auf
DENSELBEN Artikel laufen. Über den getippten Namen klappt das nicht — genau
daran liegt es, dass ein Touchpad 24-mal in der DB steht (24.657 Artikel bei
143 vorkommenden Gerätenamen × 17 Teiltypen).

- **Schema:** `Teilenummer` (nummer @unique, hersteller, teiltyp, istSeriennummer,
  geprueft, sichtungen, notiz, **fotoDaten/fotoMime/fotoAm**), `TeilenummerModell`
  (quelle SPENDER|MANUELL|AUTOMATISCH, bestaetigt), `Artikel.teilenummerId`
  mit `@@unique([teilenummerId, standortId])`.
- **Auflösungsreihenfolge** in `execute()`: Teilenummer → Kompatibilität →
  Bezeichnung → neu anlegen. Scheitert das Verknüpfen, **bricht die Einlagerung
  NICHT ab** — Bestand stimmt, Fall landet in der Pflegeliste.
- **`findeEintrag()` sucht in BEIDE Richtungen**: gespeicherte Nummer in der
  Eingabe ODER Eingabe in einer gespeicherten. Ohne das entstünden zwei
  Einträge, je nachdem ob jemand gescannt oder abgetippt hat.
- **Seriennummern** (`istSeriennummer`) taugen nicht als Identität — sie
  erzeugten je Stück einen Artikel. Verdachtsanzeige (1× gesehen), Entscheidung
  durch einen Menschen auf `/admin/teilenummern`.
- **Weg B „Einzelnes Teil ohne Gerät"** (`StepLosesTeil`, Schritt 7): Anker ist
  die Nummer statt der LogID. Nummer ODER Bezeichnung ist Pflicht. Es wird
  **keine Kompatibilität geraten** — nur bestätigte Modelle der Nummer werden
  übernommen.
- **Rechte:** ARTIKEL_VIEW / ARTIKEL_EDIT / ARTIKEL_EINLAGERN wiederverwendet,
  kein seed-rbac.

### Foto-Erkennung von Ersatzteilen (Aug 2026)

Dritter Einstieg im Assistenten: **„📷 Ersatzteil erkennen lassen"** (Schritt 8),
mündet in Schritt 7. Erscheint nur, wenn `GEMINI_API_KEY` gesetzt ist.

**Bildaufbereitung im Browser** (`src/lib/bilder/aufbereiten.ts`) — der Teil,
ohne den es bei Kunststoffteilen still scheitert:
- Übersicht auf 768 px (Frage „was ist das"), **plus 2 Ausschnitte der
  beschrifteten Stellen in Originalauflösung** (Frage „was steht drauf").
- Die Stellen werden über **Kantenenergie** je Gitterzelle gefunden, kein Modell.
- ⚠️ **Nicht relativ zum Mittelwert filtern!** Auf einer Platine ist das ganze
  Bild voller Kanten, dann sticht nichts heraus und es kam **kein einziger**
  Ausschnitt zustande. Jetzt: stärkste Zellen, absolute Untergrenze.
- ⚠️ Immer über die **Kamera-App** (`capture`), nie über die Live-Vorschau:
  gemessen 3120×4160 gegen 1280×720.

**Erkennung** (`src/modules/teilenummern/bilderkennung.ts`), harte Fesseln:
- `teiltyp` nur aus den 17 bekannten, sonst verworfen.
- ⚠️ **Das Modell darf NICHT sagen, in welche Geräte ein Teil passt.** Diese
  Angabe steht nicht im Foto — es kam nur der Hersteller zurück (der steht als
  Logo drauf). Geräte kommen aus der **Nummernsuche**, siehe unten.
- Bekannte Nummer schlägt die frische Erkennung.

**Gemini-Fallen** (`src/lib/ki/gemini.ts`), alle am 19.08.2026 real aufgetreten:
- 404 „no longer available to new users" → Modellname veraltet. Über
  `GEMINI_MODELL` in der `.env` änderbar; die Fehlermeldung nennt den Nachfolger.
- 503 „high demand" → vorübergehend, wird bis zu 2× wiederholt.
- **Leere Antwort trotz 200** → `maxOutputTokens` zu klein. Denkende Modelle
  verbrauchen das Kontingent fürs Denken; 800 reichten nicht, jetzt 4096.
  Denkschritte kommen als eigene Teile und werden herausgefiltert.
- **Timeout** → 15 s zu knapp bei mehreren Bildern. Jetzt 60 s, und nach einem
  Timeout wird **nicht** wiederholt (3× 60 s = 3 Minuten Wartezeit).

### Suchquelle: eigene SearXNG-Instanz (Aug 2026)

**Warum nicht Google/Brave:** Brave hat sein Gratis-Kontingent im Februar 2026
abgeschafft (Karte + Abrechnung). Googles Custom Search JSON API ist laut
eigener Doku **für neue Kunden geschlossen** (Bestand bis 01.01.2027), „Im
gesamten Web suchen" wird eingestellt, und die Cloud Console verlangt bei neuen
Konten Zahlungsdaten. Es gibt derzeit **keine kostenlose Websuche für Programme**,
auf die man bauen sollte.

**Lösung:** `searxng`-Container in der `docker-compose.yml`, **ohne Portfreigabe**
(nur im Docker-Netz). `searxng/settings.yml` braucht zwingend `search.formats: [html, json]`,
sonst kommt 403. `SEARXNG_SECRET` in der `.env`.
`src/lib/suche/index.ts` wählt die Quelle: SearXNG vor Google, sonst nichts.

**Der Abgleich ist KEINE offene Leseaufgabe**, sondern ein Vergleich gegen eine
geschlossene Liste: „welche UNSERER 1160 Modelle kommen in den Fundstellen vor".
Stumpfer Textvergleich, kein Sprachmodell nötig. Modellnamen unter 6 Zeichen
werden übersprungen (ein Modell „5490" träfe in jeder Preisangabe).
Fundstellen ohne die Nummer werden verworfen (sonst kommen Paketverfolgungen).

**Prüfstein:** Ist das Spendermodell bekannt, MUSS es in den Funden vorkommen —
sonst deutliche Warnung.

### Gerätefotos im Pickup (Aug 2026)

Antippen einer LogID öffnet Details: Gerät, Hersteller, Colli, Stellplatz und
**Bildergalerie**. Die Zeile zeigt das Gerät jetzt **unter** der LogID in voller
Breite statt abgeschnitten daneben.

- **Quelle: der AfB-Shop.** `afbshop.de/search?search=<Modell>` → Produktseite →
  Galerie (front, front-links/rechts, back, back-links/rechts, **ports**).
  Rechtlich unkritisch: AfB-Material für AfB-Zwecke.
- ⚠️ **Ausgewertet wird der DATEINAME, nicht die Seitenstruktur** — Shopware-
  Markup ändert sich, Bildnamen nicht. Und derselbe Filter („Dateiname enthält
  den Modellnamen") wirft Werbebanner, Prüfsiegel und Zahlungssymbole von
  selbst weg. **Keine Ausschlussliste nötig.**
- **Schema:** `GeraeteFoto` (schluessel = normalisierter Modellname, `position`,
  `ansicht`, `quelle` SELBST|SHOP, `@@unique([schluessel, position])`).
  **Position 0 gehört dem selbst aufgenommenen Foto** und wird nie vom Shop
  überschrieben.
- Erfolglose Suche wird 30 Tage in Redis gemerkt (`shopbild:leer:*`).
- ⚠️ **Vorschauleisten brauchen `?mini=1`.** Ohne das lädt eine 64-px-Kachel das
  volle Bild — sieben Mal je Detailansicht. Genau daran lag die Ladezeit.
  `src/lib/bilder/groesse.ts` (sharp) verkleinert beim Speichern auf 1400 px
  und liefert Miniaturen mit 200 px.

### Kamera-Test (Aug 2026, temporär)

`/admin/kameratest` — misst, ob die Kamera eines Geräts eine Teilenummer lesbar
aufnimmt: Auflösung, Schärfe (Laplace-Varianz), Helligkeit, Überstrahlung, plus
1:1-Ausschnitt zum Selbstbeurteilen. Fotos landen serverseitig unter
`/var/www/lagernaut/reform/teilefotos` (Bind-Mount, überlebt Rebuild).
Schwellen kalibriert: lesbares Foto = 74, künstlich verwischt = 3 → gut ab 40.
**Kann raus, sobald die Frage beantwortet ist.**


### Teiltypen: Standard vs. modellgebunden + Massenzuordnung (Aug 2026)

**Die Teileauswahl des Technikers speist sich aus ZWEI Quellen** — das erklärt, warum ein frisch
angelegter Teiltyp erst mal nirgends auftaucht:
- **`Teiltyp.istStandard = true`** → gilt implizit für **jedes** Gerät, ohne jede Verknüpfung.
  Auch für Geräte, die gar keinen `GeraeteModell`-Eintrag haben. Das sind die 17 Standard-Teiltypen.
  Über den Router **absichtlich nicht änderbar** (`teiltypen.aktualisieren` lässt das Feld weg).
- **Eigene Teiltypen** (`istStandard = false`) hängen an einzelnen Modellen über **`ModellTeiltyp`**.
  Ohne Zeile dort ist der Teiltyp für Techniker unsichtbar.

`getByGeraetMitStandard` löst das Modell auf, indem es `"<hersteller> <modell>"` (lowercase) gegen
den übergebenen Gerätenamen vergleicht — im Techniker-Portal ist das `selectedGeraet.bereinigt`,
also **MIT** Hersteller-Präfix. Trifft nichts, fällt es auf „nur Standards" zurück.
⚠️ Vor einer Massenzuordnung deshalb prüfen, ob `GeraeteModell.modell` den Hersteller **nicht**
nochmal enthält (sonst „HP HP EliteBook …" → nie ein Treffer). Stand 2026-08-19: 143 von 143
vorkommenden Gerätenamen treffen, 3 von 1160 Modellen haben den Hersteller doppelt (irrelevant,
kommen in keiner LogID vor).

**Massenzuordnung** in `/admin/teiltypen` (Panel „Teiltyp allen Gerätemodellen zuordnen"):
Auswahl → **Trockenlauf** (`teiltypen.zuordnungsStand`: gesamt / bereits / fehlend) → Knopf.
`ordneTeiltypAllenModellenZu` schreibt per `createMany` + `skipDuplicates` (idempotent, beliebig
wiederholbar), `entferneTeiltypVonAllenModellen` ist das Gegenstück mit Rückfrage. Standards sind
serverseitig gesperrt — für sie wären die Zeilen wirkungslose Karteileichen.
⚠️ **Momentaufnahme:** Später neu angelegte Modelle bekommen den Teiltyp NICHT automatisch →
Knopf erneut drücken. Wer echtes „gilt immer und überall" braucht, will einen Standard-Teiltyp.
Erster Einsatz: **Thermalmodul**, 1160 Modelle (2026-08-19).

### Bestellanfragen Eigenbedarf (Aug 2026)

**Löst die wöchentliche Excel-Liste ab**, die montags an die Standortleitung ging (die sie zum
Einkauf weiterreicht). Seite `/admin/bestellanfragen`, Nav „🛒 Bestellanfragen".
- **Schema:** `Bestellanfrage` (anzahl, hersteller, beschreibung, link, verwendungsort, notiz,
  angefordertVon/-Am, versendetAm, geliefertAm, status) + Enum `BestellanfrageStatus`
  **OFFEN / BESTELLT / GELIEFERT / NICHT_GENEHMIGT / STORNIERT**. Status ist im UI **frei wählbar**
  (`<select>` je Zeile) — auch Korrekturen zurück; zusätzlich Schnellknopf „✓ Geliefert".
- **Kopieren für die Mail:** schreibt **beides** in die Zwischenablage — `text/html` (AfB-Cyan-
  Kopfzeile, Zebrastreifen, Spalte „Pos.", Link gekürzt auf „zum Artikel") **und** `text/plain`
  mit Tabulatoren als Rückfall. In der Textfassung stehen die **vollen URLs**, sonst wäre der Link
  dort verloren. Layout folgt dem Blatt „Übertrag für Email" der alten Excel.
- ⚠️ **Kopieren und „als bestellt markieren" sind bewusst getrennt.** Der Text entsteht aus `liste`;
  erst der Knopf „✓ Ist raus" setzt OFFEN → BESTELLT und stempelt `versendetAm`. Ein Fehlklick auf
  Kopieren verschiebt also nichts.
- **Rechte** (erstes Feature der Reihe, das wirklich `seed-rbac` braucht):
  `BESTELLANFRAGE_VIEW` (Liste + Kopieren) / `BESTELLANFRAGE_CREATE` (Bedarf erfassen) /
  `BESTELLANFRAGE_MANAGE` (Status, bearbeiten, löschen, verschicken). Router nutzt
  `permissionProcedure`, UI blendet über `usePermissions` aus (Aktionen-Spalte fällt ganz weg,
  Status-Feld gesperrt). **VIEW ist an BETRACHTER und ADMIN_READONLY geseedet; CREATE bewusst
  NICHT** — wer auch erfassen soll (Bereichsleitung), bekommt es pro Person, damit „Betrachter"
  seinem Namen treu bleibt.

### Datenträger & Arbeitsspeicher im Einlager-Assistenten (Aug 2026)

Eigener Erfassungs-Zweig für **nicht gerätegebundene** Teile: Ein 512-GB-NVMe ist ein
512-GB-NVMe, egal aus welchem Notebook er stammt. **Keine LogID** — die Riegel kommen kartonweise,
die Herkunft des einzelnen Stücks ist weder bekannt noch relevant.
- **Merkmale statt Freitext** (`src/lib/einlagern/komponenten.ts`): Datenträger = Art (SSD/HDD) ·
  Größe · Schnittstelle (SATA / NVMe PCIe3 / NVMe PCIe4) · Bauform (M.2 2230/2242/2280, 2,5", 3,5");
  RAM = Größe · Generation (DDR3/DDR3L/DDR4/DDR5) · Bauform (SO-DIMM/DIMM). Plus Menge, optional
  Einzelpreis und Lagerplatz.
- ⚠️ **Die Bezeichnung wird AUSSCHLIESSLICH in `bezeichnungDatentraeger()` / `bezeichnungRam()`
  gebaut** („SSD 512 GB NVMe PCIe3 M.2 2280", „RAM 16 GB DDR4 SO-DIMM"). An zwei Stellen gebaut
  entstünden Schreibvarianten desselben Artikels — genau der Fehler, durch den ein einziges
  Touchpad 24-mal in der DB steht.
- **Erfassung** (`src/modules/einlagern/komponenten.ts`): je Zeile Artikel über den Unique-Schlüssel
  **(bezeichnung, kategorie, standortId)** suchen, sonst anlegen, dann EINGANG über `bucheLager`.
  Kategorien fest: „Datenträger" / „Arbeitsspeicher".
- **Wiegen zur Mengenschätzung verworfen:** Die Paketwaage hat 100-g-Stufen (verifiziert — 1-Liter-
  Flasche zeigte 1,1 kg). Ein RAM-Riegel wiegt ~10 g, das ist nicht auflösbar. Nicht erneut anfangen.

### Bauteil-Ernte, Ersatzteil-Pool, Stückzahl & Abgaben (Aug 2026)

**Bauteil-Ernte — `Buchung.herkunftLogId` + `herkunftArt`.** Die im Einlager-Assistenten gescannte
Spender-LogID wurde vorher nur ins Server-Log geschrieben und war danach weg. Jetzt gespeichert →
Panel „🔧 Bauteil-Ernte" in `/admin/statistiken` (Materialwert, Spendergeräte, Ø Teile je Gerät,
Top-Spendermodelle via `GeraeteLookup`). `herkunftArt` trennt **`SPENDER`** (geerntet) von
**`DRUCK`** (3D-gedruckt) — Auswahl im Bestätigungs-Schritt des Assistenten, zentral in
`src/lib/einlagern/herkunft.ts`. **Bei DRUCK wird `herkunftLogId` bewusst auf null gesetzt**, sonst
zählen 3D-Chargen (280 Füße in EINER Buchung sind real) als Ernte und ruinieren die Kennzahl.

**Ersatzteil-Pool — `Artikel.poolPartnerId`.** Zwei baugleiche Artikel (Füße vorne ↔ hinten) teilen
rechnerisch EINEN Bestand. Logik in `src/lib/artikel/pool.ts`.
⚠️ **Der Pool wird IMMER vor der Buchung aufgelöst, NIE in `bucheLager`** — sonst hebelt man
bedingtes Dekrement, Bestandsprüfung in der TX und die DIREKT-Regel aus. Es wird **nicht reserviert**
(gleiches Verhalten wie ohne Pool). Berührt: `erstelleAnfrage`, `anfragen.setStatus` (Partner-Bestand
zusätzlich per `syncBestandAusHistorie` nachziehen!), `auslagern.teile`/`listAnfragen`/`gruppeDetails`,
`kompatibilitaet.getByGeraetMitStandard`. Verknüpfen auf der Artikel-Detailseite.
⚠️ **Kandidaten-Filter NICHT über `kategorie`** — die IST der Teiltyp, das schließt das Gegenstück aus.
Richtig: über den Gerätenamen (`bezeichnung` minus Teiltyp, `startsWith`).

**Stückzahl bei den Füßen — `WarenkorbItem.menge` → `Anfrage.menge`.** Nur `TEILTYPEN_MIT_MENGE`
(Füße vorne/hinten), max 2, serverseitig geprüft. Verfügbarkeit prüft jetzt `bestand >= menge`
(bei menge=1 identisch zur alten Regel). Sichtbar im Techniker-Portal („2×") und im Admin
(gelbes „2× Stück" — sonst packt die Ausgabe stillschweigend eines).

**Abgaben an Niederlassungen — `Niederlassung` + `Buchung.niederlassungId` + `Artikel.preis`.**
Festplatten/RAM sind normale `Artikel` **je Variante** („SSD 512 GB M.2 NVMe", Kategorie
„Festplatte"); `Artikel.preis` (Einzelpreis) schlägt `KategoriePreis`, weil die Kategorie bei
Datenträgern nichts über den Wert sagt. **Rat: Kategoriepreis für Festplatte/RAM LEER lassen** —
sonst bekommt ein vergessener Einzelpreis still einen falschen Pauschalwert; ohne ihn erscheint
ehrlich „⚠️ N ohne hinterlegten Preis".
`Niederlassung` ist **bewusst NICHT `Standort`** (dort arbeitet niemand mit Lagernaut) und hat eine
`adresse` für den Beleg. Abgabe = **normale AUSGANG-Buchung mit Ziel**; `bucheLager` kennt keine
Niederlassungen, das Ziel wird danach nachgetragen. Seite `/admin/abgaben`, Rechte `ARTIKEL_VIEW` /
ADMIN — **kein neues Recht, kein seed-rbac**.
**Auslagerbeleg** (`src/lib/print/auslagerbeleg.ts`): A4, Absender/Empfänger mit Anschrift,
Positionen, Sammelbeleg über Mehrfachauswahl. Wertangaben durchgängig als **statistischer,
ungefährer Marktwert** gekennzeichnet („keine Rechnung, keine Zahlungsaufforderung") — wer die
Beschriftungen ändert, muss den Hinweis mitpflegen.
⚠️ **Beleg-Nr aus der Buchungs-Id** (`AN-<Jahr>-<Id>`), NICHT über `naechsteBelegNr` (Redis-Zähler
→ Nachdruck bekäme eine neue Nummer). ⚠️ **Alle Nicht-ASCII-Zeichen werden zu HTML-Entities**
(`nurAscii`) — das Druckfenster (`window.open` + `document.write`) erkennt den Zeichensatz nicht
zuverlässig, sonst steht „Sömmerda" auf dem Papier.

**Statistik-Seite:** Panels „💰 Gesamt ausgegeben" (Technik + Niederlassungen; **Ernte bewusst NICHT
enthalten** — das ist Zufluss, der im Lager liegt), „💸 Wert ausgegeben", „🔧 Bauteil-Ernte",
„🚚 Abgaben an Niederlassungen". Alle folgen dem tage-/standortId-Filter.
Zusätzlich eine **umschaltbare Dashboard-Ansicht** (`DashboardAnsicht.tsx`, Umschalter oben,
**klassisch bleibt Standard**, Wahl in `localStorage["statistik-ansicht"]`). Deren Farbpalette ist
mit dem dataviz-Validator gegen beide Kartenflächen geprüft — **Reihenfolge ist Teil der Prüfung**
(Violett trennt Grün und Gelb, sonst ΔE 7.8 bei Rot-Grün-Schwäche). Wer Farben ändert, muss den
Validator erneut laufen lassen.

**Lagerplätze:** ⚠️ **ZWEI getrennte Systeme.** `Lagerplatz` (Tabelle `lagerplatz`) = strukturierte
ETL-Fächer (Regal/Ebene/Fach, Belegung, Router `lagerplatz`). `LagerplatzConfig` = frei angelegte
Codes (nur code/beschreibung/bereich, Router `lagerplaetze` — Mehrzahl!); Artikel hängen daran nur
über den **String** `Artikel.lagerplatz`, ohne Fremdschlüssel. Der Einlager-Assistent liest beide
(Platz-Browser zeigt „Eigene Lagerplätze", gefiltert auf `ausConfig`). Bearbeiten/Löschen in
`/admin/lagerplaetze`; **beim Umbenennen ziehen die Artikel in EINER Transaktion mit**, Löschen nur
bei 0 Artikeln.

**⚠️ Standort-Zuordnung steckt im JWT.** Ohne Standort liefert die Zugriffsprüfung `[]` → Filter
`standortId IN ()` → trifft **nichts**, still. Sah im Einlager-Assistenten aus wie „Lager ist voll"
(meldet jetzt „Kein Standort zugewiesen"). Neue Konten bekommen beim Anlegen **keinen** Standort.
**Nach dem Setzen: ab- und wieder anmelden**, sonst wirkt es nicht.

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
- **Eigene Teiltypen anlegen:** Teiltyp-Feld im Editor (`LogIdEditor` in `/admin/mobil` + Review-Seite)
  ist ein **`<select>`** mit voller Liste + Sonderoption **„➕ Neuer Teiltyp…"** (blendet ein Textfeld
  ein). Bewusst KEIN `<input list>`/Datalist — der filtert bei vorbelegtem Wert die Vorschläge auf
  genau diesen Text (sieht aus wie „nur 1 Option"). `reviewZuordnen` upsertet `MobilTeiltyp` by name
  → neuer Teiltyp (z. B. „Back Glass") wird angelegt + zugeordnet; `katalog`-Invalidate macht ihn
  künftig in der Auswahl sichtbar.
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
  ANFRAGE_MOBIL_CREATE. **`mobilAnfrage.teiltypen` leitet die Liste aus dem echten Bestand ab (ALLE
  vorhandenen Teiltypen inkl. manuell angelegter wie „Back Glass"), NICHT aus der festen
  `MOBIL_TEILTYPEN`-Parser-Liste** — sonst wären Custom-Teiltypen für den Techniker unsichtbar.
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
- **Sonderanfragen-Bewertung:** Sonderanfragen haben **keinen Artikel** → keine Kategorie/Preis →
  erzeugen **keine Buchung** (`istSonderAnfrage` ⇒ `artikelId=null`; bucheLager läuft nur mit artikelId).
  Damit „alles erfasst" ist: erledigte Sonderanfragen zählen im Panel mit **Pauschale 5 €**
  (`SONDER_PAUSCHALE`), überschreibbar per **Admin-Review** je Anfrage (Feld `Anfrage.sonderWert
  Decimal?`; null = Pauschale). `wertAusgegeben` liefert Block `sonderanfragen {anzahl, bewertet,
  pauschal, pauschale, wert}` und `gesamt` = Teile-Wert **+** Sonder-Wert (`teileWert` separat).
  Sonderanfragen sind **nicht standort-gebunden** → nur bei „alle Standorte" (kein standortId) einbezogen.
  Review-Seite **`/admin/sonderanfragen`** (Nav „💬 Sonderanfragen bewerten", Auswertung): Liste +
  Bulk-Werte setzen; tRPC `anfragen.sonderListe` (ANFRAGE_VIEW_ALL, blendet tote Zustände
  `STORNIERT`/`NICHT_VERFUEGBAR` aus — liefern keinen Wert) / `anfragen.setSonderWert`
  (adminProcedure, null → Pauschale). Panel-Sub-Zeile verlinkt dorthin.
- **Caveat:** kein Preis-Snapshot auf `Buchung`/Sonderanfrage → bewertet mit **aktuellem** Preis
  (Vergangenheitswert ändert sich bei Anpassung). Test-Modus nicht enthalten (erzeugt keine Buchung).
- **Rechte:** wiederverwendet `ARTIKEL_VIEW`/`ARTIKEL_EDIT` (Preise) + `STATISTIK_VIEW` (Auswertung)
  + `ANFRAGE_VIEW_ALL`/ADMIN (Sonderanfragen-Bewertung) — **kein neues Recht, kein seed-rbac**
  (nur `db push` für Tabelle/Spalte nötig).

### Impact / Nachhaltigkeit (Laptop-Ersatzteile)
- **Zweck:** Wirkung der Wiederverwendung sichtbar machen (AfB sozial-grün, „was bringt das"). Seite
  **`/admin/impact`** (Nav „🌱 Impact / Nachhaltigkeit", Auswertung), Recht `STATISTIK_VIEW` (lesen).
- **Datenbasis:** wiederverwendete Teile = `SUM(menge)` über Buchungen `typ IN (AUSGANG, DIREKT)`;
  versorgte Geräte = distinkte `logId` erledigter (Nicht-Test-)Anfragen. Folgt tage-/standortId-Filter.
- **Kennzahlen:** CO₂ eingespart (kg/t), Elektroschrott vermieden (kg), eingesparter Materialwert (€,
  = `preise.wertAusgegeben.teileWert`), wiederverwendete Teile, versorgte Geräte. CO₂ zusätzlich als
  „≈ km Autofahrt" (nur Veranschaulichung, Konstante 0,12 kg/km).
- **Faktoren PAUSCHAL + editierbar:** `ImpactEinstellung` (Singleton id=1, `co2ProTeilKg`,
  `gewichtProTeilKg` @db.Decimal(10,3)). Startwerte im Code (5 kg CO₂ / 0,15 kg je Teil), im UI
  überschreibbar (`impact.setFaktoren`, adminProcedure). Fehlt die Zeile → Defaults. Router `impact`
  (`kennzahlen`/`setFaktoren`). **Nur additiv (`db push`), kein seed.** Später verfeinerbar auf je-Teiltyp.

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
- **NEU — Foto-Galerie je Artikel (0..n) + A5-Lagerplatz-Schild:**
  - **Schema:** Tabelle `VerbrauchsArtikelFoto` (`id` autoincr, `artikelId`+`@@index`, `position`,
    `mimeType`, `daten Bytes @db.MediumBlob`, Zeitstempel; `onDelete: Cascade`). **Titelbild =
    kleinste `position`** (Liste-Thumbnail, A5-Schild, Info-Vorschau). Bytes in der DB (überlebt
    Rebuild). `liste` lädt nur das Titelbild-Meta (`take:1` position asc → `hatBild`+`bildStand`),
    NIE die Bytes. **Migration von der alten 1:1-Tabelle `VerbrauchsArtikelBild`:** additiv (neue
    Tabelle) + einmaliges Skript `prisma/scripts/migrate-vm-fotos.ts` (übernimmt Altbild als
    position 0, idempotent). Alte Tabelle + Relation `bild` bleiben vorerst, später per db push
    entfernbar (droppt sie dann).
  - **Upload/Verwaltung:** Client verkleinert (canvas → JPEG, ~1600px) → tRPC `fotoHinzufuegen`
    (base64, MIME jpeg/png/webp + 8-MB-Deckel, hängt ans Ende), `fotoLoeschen`, `fotosNeuOrdnen`
    (Client schickt Foto-Id-Reihenfolge → position 0..n), `fotos` (Metadaten-Liste je Artikel).
    App-Router-tRPC → **kein** 1-MB-Body-Limit. Rechte: `MATERIAL_MANAGE` (fotos = VIEW).
  - **Ausliefern:** `GET /api/verbrauchsmaterial/bild/[artikelId]?v=<ms>` (Titelbild = kleinste
    position) bzw. `GET /api/verbrauchsmaterial/foto/[fotoId]?v=<ms>` (einzelnes Galerie-Foto),
    beide Pages-API + Session + `MATERIAL_VIEW`, `Cache-Control: private,max-age=86400`.
  - **Formular** (`/admin/verbrauchsmaterial` `ArtikelForm`): **Foto-Galerie** — mehrere Fotos
    hinzufügen (Mehrfachauswahl, `capture="environment"`-Kamera), je Foto ★Als-Titel / ←→ sortieren
    / ✕ entfernen; erstes trägt „★ Titel"-Badge. `speichern` verkettet Stammdaten → Löschungen →
    Uploads in Reihenfolge → `fotosNeuOrdnen`.
  - **A5-Schild** (`src/lib/print/lagerplatzSchild.ts`, `printLagerplatzSchild`): `@page A5`,
    bewährte window.open+document.write+Auto-Print-Mechanik (wartet auf `load`, damit das Foto
    mitdruckt; Fallback-Timeout). Inhalt **groß/kontraststark (inklusiv)**: Foto oben, Name+
    Merkmale, AAN prominent, Standort/Kategorie, unten großer Scan-QR (roher `VM-…`-Code) +
    „Zum Erfassen scannen". Buttons **📄 Schild** je Zeile + **📄 A5-Schilder** in der Bulk-Leiste.
  - **Übersicht „ohne Foto":** Liste hat eine **Foto-Spalte** (Titelbild-Thumbnail bzw. rotes „Kein
    Foto"), Filter **„Nur ohne Foto"** (`liste`-Input `nurOhneFoto` → `where.fotos={none:{}}`) und
    ein Kopf-Badge **„📷 N ohne Foto"** (Query `ohneFotoAnzahl` = aktive Artikel ohne Foto; Klick
    schaltet den Filter).
  - **Klick aufs Titelbild (bzw. „Kein Foto") → Info-Pop-up** (`ArtikelInfo`): Titelbild groß +
    Miniatur-Streifen aller Fotos, Name/Merkmale, **AAN und Code je mit „📋 Kopieren"**
    (`navigator.clipboard`), Kategorie/Standort/Bestände + Schnellzugriff „📄 Schild"/„Bearbeiten"
    (Foto-Metadaten via `fotos`-Query). Klick auf ein Foto → **bildschirmfüllende** Lightbox mit
    Blättern (‹ ›, Zähler; Klick auf Rand/× schließt).

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

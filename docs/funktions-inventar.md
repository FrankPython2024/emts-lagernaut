# Lagernaut v2 — Funktions-Inventar

## Auf einen Blick

Lagernaut ist das interne Lager- und Anfragen-System für die
Aufbereitungs-Werkstatt von AfB Sömmerda. Techniker bekommen darüber
schnell die richtigen Ersatzteile für das Gerät, an dem sie gerade
arbeiten — der Lager-Admin behält Bestand, Lagerplätze und Verknüpfungen
im Griff, und die Geschäftsleitung sieht Auswertungen für Steuerung und
Reporting. Ein System, drei Welten, eine gemeinsame Daten-Basis.

## Drei Nutzer-Rollen

| Rolle | Wer | Wofür |
|---|---|---|
| **Techniker** | Werkstatt-Mitarbeiter | Geräte scannen, Ersatzteile anfragen, eigene Anfragen verfolgen |
| **Admin** | Lager-Admin / Prozess-Steuerung | Bestände pflegen, ein- und auslagern, Anfragen bearbeiten, Modelle verknüpfen |
| **Betrachter** | Geschäftsleitung / Audit | Lesender Zugriff auf Statistiken, Verläufe, Aktivitäten — keine Schreib-Rechte |

Jede Rolle bekommt nur die Bereiche zu sehen, für die sie zuständig ist.
Detailliertere Berechtigungen lassen sich über eine eigene Rollen-Verwaltung
feiner einstellen.

---

# Techniker-Portal

Das Techniker-Portal ist die Oberfläche für die Werkstatt. Optimiert für
Bedienung mit Handschuhen, am Touch-Tablet und am Handheld-Scanner. Wer
sich anmeldet, kommt direkt auf die Such-Maske — keine Untermenüs, keine
Suche nach dem richtigen Knopf.

## Geräte erkennen & Teile finden

### LogID-Scan

Der Techniker scannt mit dem Handheld den Geräte-Barcode (LogID). Das
System identifiziert in Sekundenbruchteilen das passende Modell — auch
wenn der Aufkleber den vollen Maschinen-Typ-Modell-Code enthält
(z. B. „Lenovo ThinkPad T480 20L6-S2AD03"). Kein Suchen, kein Tippen.

### Ersatzteil-Übersicht („4-State-Grid")

Pro Gerät zeigt das Portal eine Kachel-Übersicht aller relevanten
Teiltypen (Mainboard, Tastatur, Touchpad, Akku, Cover …). Jede Kachel hat
einen von vier Zuständen:

- **Verfügbar** (grün) — Ersatzteil auf Lager, bestellbar.
- **Bedarf** (orange) — Anfrage ist möglich, aber kein Bestand. Geht
  in die BEDARF-Liste des Admins.
- **In Bearbeitung / Erledigt** — bereits angefragt, läuft.
- **Nicht erfasst** (grau) — für dieses Modell gibt es keine
  Verknüpfung. Hinweis an den Admin, dass Pflege fehlt.

Der Bestand pro Teiltyp ist die **Pool-Summe** aller vom Admin
verknüpften Artikel. Heißt: ein Touchpad, das für mehrere Modelle taugt,
zählt in jedem dieser Modelle in der Übersicht — ohne Doppelzählung. Was
am Ende geliefert wird, ist transparent: das System wählt den Artikel
mit dem höchsten Bestand.

### Sonderanfragen (Freitext)

Manchmal braucht der Techniker etwas, das nicht im Standard-Sortiment
geführt ist (z. B. „Schraubenset Lüfterseite Mitte"). Über einen
Sonderanfrage-Button kann er das frei tippen. Solche Anfragen erscheinen
beim Admin sichtbar markiert und werden separat behandelt — sie wandern
nicht in den normalen Lager-Bestand.

## Anfragen stellen

### Cart-Prinzip

Mehrere Teile für dasselbe Gerät landen in einem gemeinsamen Korb. Erst
beim Absenden entsteht eine Anfrage-Gruppe — der Admin sieht so alles
zum Vorgang in einer Karte beieinander, nicht als verstreute Einzelteile.

### Status-Verfolgung

Der Techniker sieht in seiner Anfragen-Liste, was wo steht. Status-Kette:

```
NEU  →  IN_BEARBEITUNG  →  ABGESCHLOSSEN
  ↓                              ↓
BEDARF   ↘                       ↑
           STORNIERT  oder  NICHT_VERFÜGBAR
```

- **NEU**: angenommen, wartet auf Bearbeitung.
- **IN_BEARBEITUNG**: ein Admin hat sie aktiv übernommen.
- **BEDARF**: kein Bestand vorhanden — wartet auf Einlagerung.
- **ABGESCHLOSSEN**: ausgelagert, Teil liegt zur Abholung bereit.
- **STORNIERT**: vom Techniker selbst oder Admin abgesagt.
- **NICHT_VERFÜGBAR**: vom Admin als nicht beschaffbar markiert (neu) —
  Techniker erhält Hinweis, das Gerät auf Broker oder H-Status zu setzen.

Storno und Nicht-verfügbar sind **getrennte Zustände** und werden in
allen Auswertungen separat geführt — das ist wichtig für ehrliche Quoten.

## Kommunikation

### Chat in der Anfrage

An jeder Anfrage hängt ein Chat. Techniker und Admin können sich direkt
zur Sache austauschen, ohne den Kontext zu verlieren. Bei der Markierung
„nicht verfügbar" wird automatisch eine Erklär-Nachricht eingestellt —
der Techniker weiß sofort woran er ist.

### Live-Aktualisierung

Alle Änderungen erscheinen in Echtzeit. Status wechselt, Chat kommt rein,
neue Anfrage in der Liste — kein Neuladen nötig.

### Tab-Counter bei Abwesenheit

Wenn der Techniker das Lagernaut-Fenster im Hintergrund hat (z. B. weil
parallel das ReForm-System läuft), zählt der Browser-Tab-Titel die
neuen Ereignisse mit: `(3) EMTS Lagernaut`. Sobald er zurückwechselt,
springt der Zähler auf 0 — wie bei Slack oder Gmail.

## Eigene Übersicht

### Profil-Statistik

Jeder Techniker hat eine eigene Profil-Seite mit den persönlichen
Kennzahlen: Anfragen gesamt, Erledigungs-Quote, häufigste Teile, beste
Woche. Das hilft, den eigenen Verlauf zu sehen — nicht zum Ranking,
sondern zur eigenen Orientierung.

### Schriftgröße & Dark-Mode

Drei Schriftgrößen (klein/mittel/groß) und ein Dark-Light-Umschalter
sind direkt im Footer — pro Benutzer gespeichert. Wer in dunkler Halle
arbeitet oder die Brille gerade nicht zur Hand hat, stellt sich das
Portal so ein, dass es passt.

---

# Admin-Bereich

Der Admin-Bereich ist das Steuerpult. Hier wird der Bestand gepflegt,
Anfragen bearbeitet, Lagerplätze konfiguriert, Statistiken eingesehen.
Linker Bereich: feste Sidebar mit Bereich-Gruppen (Übersicht, Betrieb,
Stammdaten, Analyse, System).

## Lager-Pflege

### Artikel-Verwaltung

Listen-Ansicht aller Artikel mit Filter (Kategorie, Lagerplatz, Bestand),
Suche, Sortierung. Pro Artikel: Bestand, Lagerplatz, Buchungs-Historie,
Etiketten drucken. Mehrfach-Auswahl für Massen-Labels.

### Modell-Verwaltung

Die Geräte-Modelle (Hersteller + Modell + ggf. Maschinen-Typ-Code) sind
die zentrale Stammdatei. Sie werden beim Einlagern automatisch erfasst
oder lassen sich manuell anlegen. Ein Aktivitäts-Schalter blendet
ausgemusterte Modelle aus, ohne Daten zu verlieren.

### Kompatibilitäts-Verknüpfungen

Hier wird festgelegt: welches Teiltyp eines Modells wird von welchem
Artikel bedient. **Pro (Modell, Teiltyp) sind mehrere Artikel erlaubt
(„Pool")** — z. B. ein Touchpad, das gleichzeitig zu T480, T580 und L580
passt. Der Techniker sieht beim Scan dann den summierten Bestand aus
allen verknüpften Artikeln.

**Wichtig:** Verknüpfungen entstehen **nur durch explizite Admin-
Pflege**. Keine automatischen Treffer durch Wort-Ähnlichkeit, keine
versteckte Spiegelung im Hintergrund. Was im Modal angehakt wurde, gilt
— sonst nichts. Das macht das System für Audits eindeutig.

Zwei Modale unterstützen die Pflege:

- **Pro Modell**: alle Teiltypen auf einen Blick, mit Suchfeld pro
  Teiltyp und Multi-Auswahl je Artikel.
- **Pro Artikel (Pool-Modell)**: ein Artikel kann mit einem Klick an
  viele Modelle gleichzeitig verknüpft werden. Modelle sind nach
  Basis-Modell-Familie gruppiert („Lenovo ThinkPad T480 (47 Varianten)") —
  ein Häkchen verknüpft mit allen 47 MTM-Varianten auf einmal.

## Ein- und Auslagern

### Einlager-Assistent

Ein **dreistufiger Wizard**, der den Lager-Admin durch das Einlagern führt:

1. **Gerät**: LogID scannen oder Modellname tippen — System schlägt das
   passende Modell vor, prüft auf Ähnlichkeit (Tippfehler-Schutz).
2. **Lagerplatz**: System schlägt den passenden Platz vor (gleiches
   Modell hat schon einen, oder das Fach passt zum Hersteller). Auch
   ein eigener Platz wählbar.
3. **Teile**: alle relevanten Teiltypen als große Kacheln. Pro Teil
   Grading (A+ / A / B / C), Menge, optionale Notiz, optional Freitext
   bei Verschiedenes-Sammelkategorie. Beim Bestätigen werden Artikel
   und Buchungen in einem Rutsch erzeugt.

Optimiert für Touch-Bedienung und Bedienbarkeit mit Handschuhen — große
Buttons, klare Schritt-Anzeige, keine versteckten Felder.

### Auslager-Wizard mit drei Pfaden

Aus einer Anfrage heraus startet der Auslager-Vorgang. Der Wizard zeigt
alle Teile der Anfrage-Gruppe und behandelt sie je nach Lage anders:

| Pfad | Wann | Effekt auf Bestand |
|---|---|---|
| **AUSGANG** | Teil auf Lager, normaler Fall | Bestand sinkt um die Menge |
| **DIREKT** | Teil als BEDARF angefragt, aber heute schon erhältlich (z. B. aus laufender Lieferung) | Kein Bestand-Effekt (Pass-Through) |
| **Sonderanfrage** | Freitext-Anfrage ohne Standard-Artikel | Kein Bestand-Effekt, manuell quittiert |

Die DIREKT-Regel ist im System fest verdrahtet und kann nicht versehentlich
durchbrochen werden — Sicherheitsgurt im Code, der jeden potenziellen
Bestand-Schreibvorgang prüft.

### Belege (57 × 32 mm Etikett)

Jede Auslagerung erzeugt einen Beleg im Etiketten-Format — kleines
selbstklebendes Label, passend für die Etiketten-Drucker in der Werkstatt.
Drauf steht: Artikel, Lagerplatz, Grading, Techniker, LogID, Beleg-Nummer.
Mehrere Belege drucken in einem Rutsch möglich. Einlager-Belege ebenfalls.

## Anfragen-Steuerung

### Bearbeitung mit Lock-System

Wenn ein Admin eine Anfrage-Gruppe „in Bearbeitung" nimmt, ist sie für
andere Admins sichtbar gesperrt — vermeidet doppelte Arbeit, wenn mehrere
Admins gleichzeitig im Lager unterwegs sind. Die Sperre lässt sich
zurückgeben (vom Bearbeiter selbst) oder im Notfall freigeben (jeder
andere Admin, mit Begründung im Log).

### Status-Wechsel

Der Admin setzt Status von Hand oder über den Auslager-Wizard:

- **Status „nicht verfügbar"**: Wenn klar ist, dass das Teil nicht
  beschaffbar ist (z. B. Modell zu alt, Lieferengpass), markiert der
  Admin die Anfrage entsprechend. Eine vorgefertigte Chat-Nachricht
  geht automatisch an den Techniker („⚠️ Ersatzteil nicht verfügbar.
  Bitte das Gerät auf Broker umstellen oder H-Status setzen, falls
  möglich."). So weiß der Techniker sofort, wie er weiter mit dem
  Gerät verfahren soll.

- **Storno** ist klar als rote Karte hervorgehoben (rote Border,
  ausgegraute Kachel) — keine Verwechslungsgefahr mit aktiven Anfragen.

## Lagerplatz-System

### Strukturierter Aufbau

Ca. 125 physische Lagerplätze im aktuellen Haupt-Lager, durchnummeriert
als ETL-Codes (z. B. `ETL-1-5-3` = Regal 1, Ebene 5, Fach 3). Pro Fach
sind bis zu vier Modelle erlaubt — und nur Modelle desselben Herstellers
(Hersteller-Reinheit als Regel). Das System verhindert automatisch
Vermischung.

### Visuelle Übersicht

Eine Lager-Karte zeigt alle Plätze auf einen Blick: frei / belegt / voll,
mit Hersteller-Markierung. Klick auf einen Platz öffnet das Detail mit
allen darin gelagerten Modellen und deren Bestand pro Teiltyp.

### Vorschläge beim Einlagern

Beim Einlagern macht das System automatisch einen Platz-Vorschlag. Logik:
gleiches Modell hat schon einen Platz → den nehmen. Sonst der nächste freie
Platz im Hersteller-Bereich. Der Admin kann den Vorschlag annehmen oder
selbst einen suchen.

### Lagerstruktur-Editor

Für die Konfiguration des Lagers (wie viele Regale, Ebenen, Fächer) gibt
es einen eigenen Editor. Beim Anlegen eines neuen Standorts kann die
Struktur **als Vorlage** vom Hauptstandort übernommen werden — kein
manuelles Anlegen von 125 Plätzen.

## Statistik & Reporting

### Dashboard 2.0

Das Admin-Dashboard ist modular aufgebaut: über ein Dutzend Widgets
(KPIs, letzte Anfragen, letzte Buchungen, Top-Teiltypen,
Auslagerungs-Trend, Mindestbestand, Lagerplatz-Heatmap, Aktivitäts-Feed,
System-Status …). Jeder Admin kann **per Drag & Drop** seine eigene
Anordnung wählen und einzelne Widgets ein- oder ausblenden. Die
Konfiguration ist pro Benutzer gespeichert — Frank sieht morgens andere
Schwerpunkte als Latifa.

### Statistik-Seite

Eigene Auswertungs-Seite mit:

- **5 KPI-Karten**: Gesamt, Erledigt, Bedarf, Storniert,
  Nicht-verfügbar (sauber getrennt).
- **Status-Verteilung** als Balken-Chart, farblich nach Status.
- **Anfragen-Verlauf** über Zeit (Anfragen, Erledigt, Bedarf,
  Nicht-verfügbar als eigene Reihen).
- **Team-Vergleich**: pro Techniker Volumen, Erledigungsrate,
  Bedarfsquote — keine Rangliste, sondern Übersicht.
- **Monats-Detail**: Klick auf einen Monat öffnet detailliertes Modal
  mit Top-Teilen und Geräten.
- **Jahres-Archiv**: 12 Monate pro Techniker, durchklickbar bis ins
  Detail.

### Reports

Tages-Übersicht (PDF-Ausdruck der Anfragen-Liste) und Monats-Berichte
ermöglichen Reporting in Richtung Geschäftsleitung ohne Excel-Export.

## Audit & Nachvollziehbarkeit

### Activity-Log

Im System gibt es ein laufendes Aktivitäts-Protokoll: wer hat wann was
gemacht (Status-Wechsel, Einlagerung, Sperre vergeben/freigegeben). Im
Admin-Dashboard als Widget sichtbar, lückenlos.

### Belege

Jede Buchung erzeugt einen nachvollziehbaren Beleg mit eindeutiger
Nummer. Belege lassen sich später neu drucken (z. B. wenn das Etikett
verloren ging).

### Stresstest-Suite

Eine separate Test-Umgebung simuliert mehrere Techniker und Admins
parallel — gut für Performance-Audits vor größeren Rollouts. Ergebnisse
werden in einer Historie gespeichert, mit Antwortzeit-Perzentilen und
Fehler-Quote.

---

# Übergreifende Stärken

## Inklusive Bedienung

Das System ist von Grund auf für inklusive Nutzung entworfen — und das ist
für AfB mehr als nur eine technische Anforderung, es ist Programm:

- **WCAG 2.1 AA als Designziel** in allen relevanten Oberflächen
  (Kontraste, Beschriftungen, Tastatur-Navigation).
- **Große Touch-Targets** (mind. 44 px, an kritischen Stellen 56 px) —
  bedienbar mit Handschuhen, am Tablet, am Touchscreen.
- **Drei Schriftgrößen** (klein/mittel/groß), pro Benutzer gespeichert.
- **Dark- und Light-Mode**, automatisch oder manuell umschaltbar.
- **Plain Language**: Status-Bezeichnungen sind klar und kurz
  („Neu", „Bedarf", „Erledigt"), keine Insider-Abkürzungen.
- **Konsistente Tastatur-Bedienung**: Esc schließt Modale, Strg+K öffnet
  die Globale Suche, Tab-Navigation funktioniert überall.

Das hat zwei Effekte: Werkstatt-Mitarbeitende mit Einschränkungen können
den Job ohne Hindernisse machen — und neue Kolleg:innen finden sich
schneller zurecht, weil die Oberfläche selbsterklärend ist.

## Mehrere Standorte

Lagernaut ist mandantenfähig für mehrere AfB-Standorte:

- **Sidebar-Standort-Wechsler** für Admins, die mehrere Standorte
  betreuen.
- **Daten-Isolation**: Anfragen, Artikel und Lagerplätze sind pro
  Standort getrennt. Ein Techniker aus Sömmerda sieht nichts aus
  Hamburg und umgekehrt.
- **Vorlage übernehmen**: Neuer Standort kann die Lagerstruktur des
  Hauptstandorts als Startwert kopieren — Onboarding eines weiteren
  Standorts dauert dann nicht Tage, sondern Stunden.
- **Rollen pro Standort**: Berechtigungen lassen sich pro Standort
  vergeben, falls eine Person für mehrere zuständig ist.

## Sicherheit & Verfügbarkeit

- **Aktivitäts-Protokoll** macht jede relevante Aktion nachvollziehbar.
- **Lock-System** verhindert doppelte Bearbeitung.
- **Heilige Buchungs-Regel**: DIREKT-Buchungen ändern niemals den Bestand
  — im Code als Sicherheitsgurt verdrahtet. Verhindert versehentliche
  Bestands-Drift auch bei zukünftigen Code-Änderungen.
- **Status-Tracking** (online/offline-Anzeige der Techniker im
  Live-Bereich).
- **Server-seitige Backup-Routine** (Datenbank-Snapshots auf Infrastructure-
  Ebene). Wiederherstellung wurde geübt.

## Globale Suche

Über **Strg+K** öffnet sich an jeder Stelle ein Such-Modal — Volltext über
Artikel, Modelle, Anfragen und Buchungen gleichzeitig. Aktuelle Treffer
werden nach Typ gruppiert angezeigt, mit Status-Markierung. Pfeiltasten +
Enter springen direkt zur Detail-Seite. Spart das Klicken durch die Menüs,
wenn man schon weiß, wonach man sucht.

---

# Technische Eckdaten

Für die wenigen Tech-Fragen aus dem Stakeholder-Termin:

| Aspekt | Wert |
|---|---|
| Frontend | Next.js (React) mit moderner Web-Plattform |
| Backend | Node.js, typsicheres Datenabruf-Protokoll |
| Datenbank | MySQL (relational, ACID-konform) |
| Live-Aktualisierung | Web-Socket-basiert |
| Volltext-Suche | Eigener Such-Index neben der Datenbank |
| Hintergrund-Verarbeitung | Job-Queue für Such-Index-Updates etc. |
| Hosting | Eigener Server (Hetzner, deutsches Rechenzentrum) |
| Betrieb | Container-basiert (Docker), automatisches Neuaufsetzen möglich |
| Verschlüsselung | HTTPS-Transport, Passwörter gehasht |
| Mehrsprachigkeit | Aktuell Deutsch, Englisch-Erweiterung architektonisch vorgesehen |

Stand: Juni 2026. Das System läuft produktiv am Standort Sömmerda; ein
Rollout an weitere Standorte ist technisch vorbereitet.

# Dashboard 2.0 — Audit-Befund

_Stand: 2026-05-19 · Scope: Phase 1 + 2 aller Dashboard-Dateien_  
_Fix-Pass: 2026-05-19 — K1, K2, K3, K4, M6, M7, M8 behoben (siehe ~~durchgestrichen~~)_

---

## Zusammenfassung

**Befunde initial:** 4 🔴 kritisch · 9 🟡 mittel · 6 🟢 kosmetisch  
**Nach Fix-Pass:**   ~~0~~ 🔴 kritisch offen · 6 🟡 mittel offen · 6 🟢 kosmetisch offen

**Pauschal-Eindruck:** Solide Basis. Die 12 Widgets folgen einem einheitlichen Pattern, Backend-Procedures sind
sauber getrennt. Die kritischsten Probleme betreffen Auto-Refresh (Dashboard-Titel verspricht 
„Auto-Refresh alle 30s", aber nur 3 von 12 Widgets aktualisieren sich tatsächlich automatisch),
fehlende Socket.io-Invalidierung und ein dupliziertes Utility. Kein Sicherheitsrisiko erkennbar.
Alle Procedures korrekt als `adminProcedure` markiert.

---

## Kritisch 🔴

### K1) Auto-Refresh: 9 von 12 Widgets aktualisieren sich NICHT automatisch

**Dateien:** Alle Widget-Dateien außer `LetzteAnfragenWidget.tsx`, `LetzteBuchungenWidget.tsx`, `AktivitaetWidget.tsx`

**Problem:**  
Die Dashboard-Page zeigt „Widgets aktualisieren sich automatisch" (`src/app/admin/page.tsx:17`).
React Query's `staleTime` verhindert nur erneutes Fetchen bei bereits aktiver Query, aber
**ohne `refetchInterval` wird die Daten NICHT im Hintergrund neu geladen** — nur bei
Window-Fokus, Navigation oder Component-Remount.

Betroffen: `StatsWidget` (staleTime 30s), `AnfragenStatusWidget` (60s), `AuslagerungsTrendWidget` (60s),
`TopTeiltypenWidget` (120s), `TechnikerAktivitaetWidget` (60s), `LagerplatzHeatmapWidget` (120s),
`MindestbestandWidget` (120s), `SystemStatusWidget` (60s), `QuickActionsWidget` (kein Query).

Die KPI-Zahlen (StatsWidget) können 5+ Minuten veraltet sein ohne dass der User es merkt.

**Risiko:** Falsche Entscheidungsgrundlage für Admin bei Live-Betrieb. Demo-Kritisch.  
**Fix-Aufwand:** XS — `refetchInterval` hinzufügen, Werte je Widget zwischen 30s–120s.

---

### K2) Socket.io-Events invalidieren tRPC-Cache nicht

**Dateien:** Alle Widget-Dateien, `src/app/admin/layout.tsx`

**Problem:**  
Wenn ein Techniker eine Anfrage stellt, sendet `src/modules/realtime/socket.ts` den Event
`ANFRAGE_NEU`. Das Admin-Layout zeigt dazu bereits einen Toast. Aber die Dashboard-Widgets
(`AnfragenStatusWidget`, `StatsWidget`, `LetzteAnfragenWidget` usw.) erhalten keine
Cache-Invalidierung — sie zeigen veraltete Zahlen bis der nächste `refetchInterval` feuert
(oder gar nie, wenn K1 nicht gefixt wird).

**Risiko:** Admin sieht neue Anfrage als Toast, aber KPI-Zahl bleibt unverändert.  
**Fix-Aufwand:** S — `useSocket` im Dashboard-Kontext, bei `ANFRAGE_NEU` / `BUCHUNG_ERSTELLT`
via `utils.dashboard.invalidate()` (tRPC-Utils).

---

### K3) Dupliziertes `relTime()`-Utility

**Dateien:**  
- `src/components/dashboard/widgets/LetzteAnfragenWidget.tsx:9–16`
- `src/components/dashboard/widgets/AktivitaetWidget.tsx:6–14`

**Problem:**  
Identische Implementierung an zwei Stellen. Wenn eine Instanz gefixt wird (z.B. „vor Xh" statt
„Xh"), bleibt die andere veraltet. Klassischer DRY-Verstoß mit Maintenance-Risiko.

**Risiko:** Inkonsistente Zeitanzeige im Dashboard bei zukünftigen Änderungen.  
**Fix-Aufwand:** XS — `src/lib/dashboard/dateUtils.ts` mit exportierter `relTime()`-Funktion.

---

### K4) Lagerplatz-Heatmap nur farbkodiert — A11y-Verstoß (Farbenblindheit)

**Datei:** `src/components/dashboard/widgets/LagerplatzHeatmapWidget.tsx:57–65`

**Problem:**  
Belegt/Frei wird ausschließlich über Farbe unterschieden (Cyan vs. Grau). Für Nutzer mit
Rot-Grün- oder Blau-Gelb-Sehschwäche (ca. 8% aller Männer) ist die Unterscheidung nicht
erkennbar. Das widerspricht WCAG 2.1 Criterion 1.4.1 (Use of Color).

**Risiko:** A11y-Compliance-Verstoß. Demo gegenüber GF kann problematisch sein falls
betroffen.  
**Fix-Aufwand:** S — zweiten visuellen Kanal hinzufügen: `border` oder `text-center` mit
kleinem Initialen-Text (`B`/`F`) oder diagonal gestreifter Background-Pattern per CSS.

---

## Mittel 🟡

### M1) Kein `refetchOnWindowFocus` Handling

**Datei:** `src/components/dashboard/widgets/LagerplatzHeatmapWidget.tsx:9`,
`TechnikerAktivitaetWidget.tsx:9`

**Problem:**  
React Query refetcht standardmäßig beim Window-Fokus, selbst wenn `staleTime` noch nicht
abgelaufen ist. Mit `staleTime: 120_000` bei LagerplatzHeatmap bedeutet das: User tippt in
einem anderen Tab, klickt zurück → Query feuert neu. Das ist bei Chart-Daten unnötig.
Empfehlung: `refetchOnWindowFocus: false` für träge Daten (120s).

**Risiko:** Gelegentliche unnötige DB-Last, wahrnehmbare Chart-Redraws.  
**Fix-Aufwand:** XS — Option hinzufügen.

---

### M2) N+1-ähnlich: `technikerAktivitaet` macht 2 parallele groupBy-Queries

**Datei:** `src/server/routers/dashboard.ts:100–113`

**Problem:**  
Zwei separate `prisma.anfrage.groupBy()`-Calls (alle Anfragen + abgeschlossene Anfragen)
werden mit `Promise.all` parallel ausgeführt. Das sind 2 DB-Round-Trips die als eine einzige
Query mit einem `_count` über einen `where`-Filter implementiert werden könnten — oder via
Raw-SQL mit `CASE WHEN`.

In der Praxis ist es bei kleinen Datensätzen kein Problem, aber bei >10k Anfragen und einer
trägen DB kann es die Widget-Ladezeit spürbar erhöhen.

**Risiko:** Performance-Degradation bei wachsenden Datenmengen.  
**Fix-Aufwand:** S — Raw-SQL-Aggregation oder separater Prisma-Call mit `where.bearbeitetVon` join.

---

### M3) `SCHWELLWERT = 2` im Backend hardcoded

**Datei:** `src/server/routers/dashboard.ts:159`

**Problem:**  
Mindestbestand-Schwellwert ist ohne Konfigurationsmöglichkeit eingebaut.
Frank könnte das nicht selbst ändern ohne Code-Deployment.

**Risiko:** Flexibilitätsproblem. Kein Bug, aber fehlende Admin-Konfiguration.  
**Fix-Aufwand:** M — Settings-Tabelle oder `.env`-Variable; alternativ als Procedure-Input.

---

### M4) `any`-Cast in DashboardGrid unterdrückt Typ-Prüfung für react-grid-layout

**Datei:** `src/components/dashboard/DashboardGrid.tsx:112–130`

**Problem:**  
`<Responsive {...({...} as any)}>` umgeht die TypeScript-Prüfung komplett.
Props die sich in react-grid-layout v3 geändert haben (z.B. `draggableHandle` deprecated)
werden nicht gemeldet. Wenn die Library ein Breaking-Change-Update bekommt, gibt es keinen
Compile-Fehler — stattdessen Runtime-Bugs.

**Risiko:** Stille Regression bei Library-Update.  
**Fix-Aufwand:** S — eigene `Partial<ResponsiveGridLayoutProps>` Type-Extension oder
`// @ts-expect-error` mit Kommentar statt `any`.

---

### M5) Dashboard-Breakpoints stimmen nicht mit Tailwind überein

**Datei:** `src/components/dashboard/DashboardGrid.tsx:118`

**Problem:**  
```
breakpoints: { lg: 1280, md: 996, sm: 768, xs: 480, xxs: 0 }
```
Tailwind nutzt `lg: 1024px`, `md: 768px`, `sm: 640px`. Das `lg`-Layout (12 cols) 
greift bei react-grid-layout erst ab 1280px, Tailwind's `lg:` aber ab 1024px.
Im Fensterbereich 1024–1279px zeigt react-grid-layout das `md`-Layout (2-spaltig),
während Tailwind-Classes das `lg`-Layout rendern — visueller Konflikt.

**Risiko:** Layout-Inkonsistenz auf 1024–1279px-Screens (typische Laptops).  
**Fix-Aufwand:** S — Breakpoints auf Tailwind-Defaults angleichen: `{ lg: 1024, md: 768, sm: 640 }`.

---

### M6) StatsWidget hat keinen Error-State

**Datei:** `src/components/dashboard/widgets/StatsWidget.tsx:15–25`

**Problem:**  
`stats.error` wird nicht abgefangen. Bei einem Backend-Fehler zeigen alle 4 KPI-Karten `0`
ohne Hinweis dass die Daten nicht geladen werden konnten. Das sieht im Notfall aus wie „alles OK".

**Risiko:** Irreführende Nullwerte bei DB-Ausfall.  
**Fix-Aufwand:** XS — Error-State hinzufügen wie in anderen Widgets.

---

### M7) SystemStatusWidget: Zeitstempel fehlt

**Datei:** `src/components/dashboard/widgets/SystemStatusWidget.tsx`

**Problem:**  
Die Status-Anzeige hat `staleTime: 60_000` aber keinen `refetchInterval`. 
Das Datum des letzten Checks ist nicht sichtbar. „DB: OK" könnte ein
60-sekündiger Cache-Treffer sein — der User weiß nicht ob der Service gerade
wirklich erreichbar ist oder ob die Anzeige veraltet ist.

**Risiko:** Falsches Sicherheitsgefühl beim Admin.  
**Fix-Aufwand:** XS — Zeitstempel `Geprüft vor ${relTime(lastCheck)}` im Footer.

---

### M8) `WidgetCard`: Drag-Handle-Icon `⠿` (Braille-Muster) nicht universell gerendert

**Datei:** `src/components/dashboard/WidgetCard.tsx:28`

**Problem:**  
Das Braille-Muster `⠿` (U+283F) ist kein standard Drag-Icon. Es rendert auf Windows
oft als leeres Rechteck (fehlende Schriftart) oder als unbekanntes Zeichen.
Auf Android/iOS ähnlich. Nutzer erkennen möglicherweise nicht dass es ein Drag-Handle ist.

**Risiko:** Schlechte UX im Edit-Mode wenn Icon nicht rendert.  
**Fix-Aufwand:** XS — ersetzen durch `⋮⋮` (U+22EE×2) oder SVG-Icon.

---

### M9) QuickActionsWidget: Touch-Targets möglicherweise unter 44px auf Mobile

**Datei:** `src/components/dashboard/widgets/QuickActionsWidget.tsx:22`

**Problem:**  
`min-h-[80px]` ist ausreichend, aber `min-w` fehlt. Bei sehr schmalem Viewport
(xs, xxs) könnte `w` durch Grid-Constraints kleiner als 44px werden.
Zusätzlich kein `aria-label` auf den Links — Screen-Reader liest nur den Text-Content.

**Risiko:** A11y-Problem auf Mobile/Screen-Reader.  
**Fix-Aufwand:** XS — `min-w-[80px]` ergänzen, `aria-label` für alle Links.

---

## Kosmetisch 🟢

### C1) Magic Numbers ohne benannte Konstanten

**Dateien:** Mehrere Widget-Dateien

- `TechnikerAktivitaetWidget.tsx:31` — `pct >= 80` und `pct >= 50` ohne Konstanten
- `dashboard.ts:93+111` — `daysAgo(7)` und `daysAgo(30)` ohne `AKTIVITAET_TAGE`-Konstante
- `dashboard.ts:170` — `take: 20` (Mindestbestand-Limit)

**Fix-Aufwand:** XS — Konstanten in `src/lib/dashboard/constants.ts`.

---

### C2) AfB-Farbpalette an 3+ Stellen dupliziert

**Dateien:**  
- `src/server/routers/dashboard.ts:22` (anfragenStatusVerteilung Farben)
- `src/components/dashboard/widgets/TopTeiltypenWidget.tsx:9` (COLORS Array)
- `src/components/dashboard/widgets/AuslagerungsTrendWidget.tsx:24+28` (inline Strings)

Farben wie `#008BD2`, `#04B475`, `#F59E0B` sind in `src/app/globals.css` als CSS-Variablen
vorhanden, werden in den Widget-Dateien aber als Hardcoded-Strings wiederholt.

**Fix-Aufwand:** XS — Shared `CHART_COLORS`-Objekt in `src/lib/dashboard/constants.ts`.

---

### C3) `shortDate()`-Funktion lokal in AuslagerungsTrendWidget

**Datei:** `src/components/dashboard/widgets/AuslagerungsTrendWidget.tsx:7–10`

Kleine Hilfsfunktion die bei Erweiterung des Dashboards wiederverwendet werden würde.
Gehört in `src/lib/dashboard/dateUtils.ts` (zusammen mit `relTime()` aus K3).

**Fix-Aufwand:** XS — zusammen mit K3 extrahieren.

---

### C4) Admin-Page Subtitle-Datum rendert serverseitig nicht korrekt

**Datei:** `src/app/admin/page.tsx:12–16`

`new Date().toLocaleString('de-DE')` im Server-Render gibt Serverzeit zurück. Da die Komponente
`"use client"` ist, passiert das tatsächlich clientseitig — aber der initiale Hydration-Stand
könnte kurzzeitig eine andere Zeit zeigen als nach Hydration (Hydration-Mismatch-Warnung
möglich). Empfehlung: `useEffect` oder `Suspense` für dynamische Zeiten.

**Fix-Aufwand:** XS — `useState(null)` + `useEffect` für Datum-Init.

---

### C5) `LetzteBuchungenWidget`: Menge ohne Tausender-Formatierung

**Datei:** `src/components/dashboard/widgets/LetzteBuchungenWidget.tsx:30`

`×{b.menge}` ohne `toLocaleString('de-DE')`. Bei Menge 1000 erscheint `×1000` statt `×1.000`.
Konsistenz mit anderen Stellen im System die `de-DE` nutzen.

**Fix-Aufwand:** XS.

---

### C6) Fehlender `xxs`-Breakpoint im defaultLayout

**Datei:** `src/lib/dashboard/defaultLayout.ts`

`DashboardGrid.tsx:118` definiert `xxs: 0` als Breakpoint mit `cols.xxs: 2`, aber
`DEFAULT_LAYOUT` hat keinen `xxs`-Eintrag. react-grid-layout greift dann auf den
nächst-größeren Breakpoint zurück (sm mit 6 cols) — 6 cols in 2-col-Container ist nicht optimal.

**Fix-Aufwand:** XS — `xxs`-Layout hinzufügen (alle Widgets full-width, h etwas kleiner).

---

## Was gut ist ✅

- **Alle 12 Procedures** korrekt als `adminProcedure` markiert — kein Datenleak an Techniker.
- **Promise.all** konsequent in allen Backend-Procedures — keine sequenziellen DB-Calls.
- **Loading/Error/Empty-State** in 11 von 12 Widgets vorhanden (nur StatsWidget fehlt Error-State).
- **WidgetCard Context-Pattern** (widgetContext.tsx) elegant — keine Prop-Drilling durch Widget-Komponenten.
- **Reset-Key-Counter** (`setResetKey`) clevere Lösung für react-grid-layout Remount-Problem.
- **ResizeObserver** korrekt in `useEffect` mit Cleanup (`.disconnect()`) — kein Memory Leak.
- **localStorage-Fehlerbehandlung** mit try/catch überall — SSR-sicher, keine Crashes bei Private-Browsing.
- **`minW`/`minH`** für alle 12 Widgets definiert — verhindert unbenutzbar kleine Widgets.
- **Drag-Handle-Klasse** (`.widget-drag-handle`) isoliert dragging auf dediziertes Element —
  kein versehentliches Draggen beim Scrollen.
- **AfB-Farbpalette** konsequent in Charts: Navy, Cyan, Green, Amber, Red.
- **`structuredClone`-Äquivalent** (JSON.parse/stringify) im Reset verhindert Referenz-Bug.

---

## Empfehlung

### Pflicht-Fixes vor Demo (< 2h Aufwand):

| # | Fix | Status |
|---|---|---|
| K1 | `refetchInterval` zu allen 9 Widgets ergänzen | ✅ erledigt |
| K2 | Socket.io → tRPC Cache-Invalidierung | ✅ erledigt |
| K3 | `relTime()` in shared Utility extrahieren | ✅ erledigt |
| K4 | Heatmap: zweiter visueller Kanal (WCAG) | ✅ erledigt |
| M6 | StatsWidget Error-State | ✅ erledigt |
| M7 | SystemStatusWidget: letzter Check-Zeitstempel | ✅ erledigt |
| M8 | `⠿` → `⋮⋮` im Drag-Handle | ✅ erledigt |

### Optional-Fixes nach Demo:

| # | Fix | Aufwand |
|---|---|---|
| K2 | Socket.io → tRPC Cache-Invalidierung | S |
| K4 | Heatmap: zweiter visueller Kanal für Farbenblinde | S |
| M5 | Breakpoints auf Tailwind-Defaults angleichen | S |
| M2 | Techniker-Aktivität: Single-Query Optimierung | S |
| M3 | Schwellwert konfigurierbar machen | M |
| C1–C6 | Konstanten, shared Utils, xxs-Layout | XS je |

# Audit Phase 3 — UI + Accessibility

**Datum:** 2026-05-15  
**Geprüft:** Lagernaut v2, Branch `main`  
**Kontext:** AfB Sömmerda — Sozialunternehmen für Menschen mit Behinderung.
Barrierefreiheit ist hier keine Kür, sondern Pflicht.  
**Basis:** Phase 1 + 2 abgeschlossen.

---

## A) Touch-Targets ≥ 60px

### Befund A-1: 🔴 KRITISCH — Viele Buttons unter 60px

**`src/app/admin/einlagern/page.tsx`**

| Zeile | Element | Ist | Soll |
|-------|---------|-----|------|
| ~112 | Input | `minHeight: 56` | ≥ 60 |
| ~320 | Input Grading-Auswahl | `minHeight: 48` | ≥ 60 |
| ~581 | Button „← Andere Nummer" | `minHeight: 56` | ≥ 60 |
| ~626 | Button „← Nummer eingeben" | `minHeight: 56` | ≥ 60 |
| ~851 | Input Lagerplatz | `minHeight: 44` | ≥ 60 |
| ~1436 | Input Lagerplatz Bestätigung | `minHeight: 44` | ≥ 60 |

Die Hauptbuttons (`S.bigBtn`) haben `minHeight: 70` — korrekt! ✅  
Aber alle Sekundär-Inputs/Buttons sind zu klein.

**`src/app/admin/anfragen/page.tsx`**
- Filter-Buttons: `py-1.5` ≈ 20px Höhe — deutlich zu klein

**`src/app/admin/layout.tsx`**
- Navigation-Links: `py-2.5` — ergibt ~38px Gesamthöhe — zu klein
- Theme-Toggle: `py-2` — zu klein

**`src/components/ui/Modal.tsx`**
- Close-Button `×`: `w-8 h-8` = 32×32px — kritisch zu klein

**Empfehlung:** Standard-Variable definieren: `--touch-target: 60px`, alle Inputs/Buttons anpassen.  
**Aufwand:** M (3–5h)

---

## B) 3 Schriftgrößen-Toggle

### Befund B-1: ✅ GUT — Techniker-Portal vorbildlich umgesetzt

`src/app/techniker/layout.tsx`:
- 3 Buttons (S/M/L), LocalStorage-Persistenz (`tk_fontsize`), Body-Class-System ✅
- CSS-Variablen in globals.css korrekt: `--base-font: 14/18/22px` ✅

### Befund B-2: 🟡 WICHTIG — Admin-Panel hat KEINEN Font-Größen-Toggle

`src/app/admin/layout.tsx` hat Dark-Mode-Toggle aber **kein** Font-Size-Toggle.  
Admin-Nutzer mit Sehbeeinträchtigung können die Schriftgröße nicht einstellen.

**Fix:** Font-Size-Toggle aus techniker/layout.tsx in admin/layout.tsx übernehmen (neben Dark-Toggle).  
**Aufwand:** XS (<1h)

---

## C) Dark Mode

### Befund C-1: ✅ VORBILDLICH — Infrastruktur korrekt aufgebaut

- `src/app/layout.tsx:20–24`: Darkmode-Script vor Hydration (kein Flicker) ✅
- `src/app/globals.css`: CSS-Variablen (`--bg`, `--card-bg`, `--text`, etc.) ✅
- `src/components/ui/Modal.tsx`: vollständige Tailwind `dark:`-Klassen ✅
- `src/components/ui/Toast.tsx`: dark mode korrekt ✅
- Einlager-Wizard (S.card etc.): nutzt `var(--card-bg)`, `var(--border)` ✅

### Befund C-2: 🔴 KRITISCH — Hardkodierte Navy-Farbe im Dark Mode unlesbar

`src/app/admin/einlagern/page.tsx` enthält an vielen Stellen inline `color: "#202F61"` (Navy).  
Im Dark Mode wird die Seite dunkel → Navy auf Dunkel = unsichtbarer Text.

Betroffen (Auswahl):
- Zeile ~266, ~647, ~777, ~1149, ~1366, ~1397: `color: "#202F61"` auf variablem Hintergrund

**Fix:** `color: "#202F61"` → `color: "var(--afb-navy)"` (oder `var(--text)` wo semantisch).  
Zusätzlich in globals.css definieren:
```css
:root { --afb-navy: #202F61; }
.dark { --afb-navy: #6B8EF0; }  /* heller Blauton für Dark Mode */
```
**Aufwand:** S (1–2h)

### Befund C-3: 🟡 WICHTIG — Mobile Topbar in Admin ohne Dark-Mode-Klasse

`src/app/admin/layout.tsx:173`: `background: "#202F61"` auf dem mobilen Topbar ohne `dark:`-Klasse.  
Im Dark Mode bleibt die Topbar Navy statt sich anzupassen.  
**Fix:** Zu CSS-Variable oder `dark:bg-[#1a2550]` wechseln.  
**Aufwand:** XS

---

## D) Leichte Sprache

### Befund D-1: 🟡 WICHTIG — Englische Zeichenkette im Techniker-Portal

`src/app/techniker/layout.tsx:194`:
```tsx
{dark ? "☀️ Hell" : "🌙 Dark"}
```
→ „Dark" sollte „Dunkel" sein (einzige englische UI-Zeichenkette im System).

**Fix:** `"🌙 Dark"` → `"🌙 Dunkel"`  
**Aufwand:** XS (<5min)

### Befund D-2: ✅ GUT — Restliche UI vollständig deutsch

Alle Navigations-Labels, Fehlermeldungen, Toast-Texte, Buttons: durchgängig Deutsch. ✅  
Keine Tippfehler oder Grammatikfehler gefunden.

### Befund D-3: ✅ GUT — aria-labels auf Deutsch

Alle `aria-label`-Werte in `einlagern/page.tsx` und anderen Seiten korrekt auf Deutsch. ✅

---

## E) AfB Corporate Colors

### Befund E-1: ✅ GUT — Farbpalette konsistent

Primärfarben korrekt eingesetzt:
- `#202F61` (Navy) — Header, primäre Buttons ✅
- `#008BD2` (Cyan) — Hover, Akzentfarben ✅
- `#04B475` (Green) — Erfolg, Empfehlungen ✅

Systemfarben (`#fa3e3e`, `#f7b928`, `#8e44ad`) sind bewusst und zweckgebunden eingesetzt. ✅

Grading-Farben korrekt (`gradingFarbe()` in mehreren Dateien):
- A+/A → `#04B475` (Green) ✅
- B → `#008BD2` (Cyan) ✅  
- C → `#F59E0B` (Orange/Gelb) ✅

---

## F) Loading / Error / Empty States

### Befund F-1: ✅ VORBILDLICH — Einlager-Wizard und Dashboard

- Einlager-Wizard: Loading-Spinner während execute, Toast bei Fehler ✅
- Dashboard (`admin/page.tsx`): `PageLoader` bei isLoading ✅
- Anfragen-Seite: `PageLoader` + Fehler-Card + leere Tabelle mit Text ✅
- Lagerplätze-Detailmodal: Ladeindikator sichtbar ✅

### Befund F-2: 🟢 KOSMETISCH — Einige Sub-Queries ohne expliziten Error-State

`src/app/admin/modelle/page.tsx`: Kompatibilitäts-Query hat kein separates Error-Handling (würde als leer erscheinen). Kein kritisches Problem, da Admin-Seite mit vertrautem User.

---

## G) Tastatur-Navigation

### Befund G-1: ✅ GUT — Escape-Handling in Modals

`src/components/ui/Modal.tsx:15`: Escape-Handler korrekt ✅  
`src/app/admin/einlagern/page.tsx:166–169`: TeilKonfigurator-Modal Escape ✅  
`src/app/admin/einlagern/page.tsx:177`: LagerplatzBrowser-Modal Escape ✅

### Befund G-2: 🟡 WICHTIG — Kein Focus-Trap in Modals

`src/components/ui/Modal.tsx` schließt mit Escape, aber **fängt den Tab-Fokus nicht** im Modal. Tastaturbediener können mit Tab aus dem Modal heraus in den Hintergrund gelangen.

**Fix:** `focus-trap-react` (~1KB) einbinden, oder manuell mit `tabIndex` und `onKeyDown`.  
**Aufwand:** S (1–2h)

### Befund G-3: 🟢 KOSMETISCH — Focus-Ring teilweise unsichtbar

Einige Buttons haben `outline: "none"` ohne `focus-visible`-Ersatz. Sichtbarer Fokus-Ring ist WCAG AA Pflicht.

**Fix:** In globalem CSS: `*:focus-visible { outline: 2px solid var(--afb-navy); outline-offset: 2px; }`  
**Aufwand:** XS

---

## H) WCAG 2.1 AA

### Befund H-1: ✅ — `lang="de"` korrekt

`src/app/layout.tsx:13`: `<html lang="de">` ✅

### Befund H-2: 🔴 KRITISCH — Login-Formular ohne verknüpfte Labels

`src/app/login/page.tsx`:
- Username-Input: `placeholder="KÜRZEL"` ohne `<label htmlFor="...">` — WCAG Failure 1.3.1
- Password-Input: `id="pw"` gesetzt, aber kein `<label htmlFor="pw">` — Screen-Reader findet Feld nicht

**Fix:**
```tsx
<label htmlFor="kuerzel" className="sr-only">Kürzel</label>
<input id="kuerzel" type="text" placeholder="KÜRZEL" ... />

<label htmlFor="pw" className="sr-only">Passwort</label>
<input id="pw" type="password" ... />
```
**Aufwand:** XS (<15min)

### Befund H-3: 🟡 WICHTIG — Close-Buttons ohne aria-label

`src/app/admin/layout.tsx` (Mobile Sidebar Close), diverse Modals:  
`×` als einziger Button-Inhalt ohne `aria-label="Schließen"`.  
Screen-Reader liest „×" vor — nicht hilfreich.

**Fix:** `aria-label="Schließen"` zu allen `×`-Buttons.  
**Aufwand:** XS

### Befund H-4: ✅ GUT — Alt-Texte korrekt

- AfB-Logo `src/app/layout.tsx:50`: `alt="AfB"` ✅  
- Login-Logo `src/app/login/page.tsx:96`: `alt="AfB Logo"` ✅  
- Alle relevanten `<img>`-Tags haben Alt-Texte ✅

---

## I) Mobile (375px)

### Befund I-1: ✅ GUT — Tabellen horizontal scrollbar

Alle Admin-Tabellen haben `overflow-x-auto`:
- `buchungen/page.tsx` ✅
- `lagerplaetze/page.tsx` ✅  
- `modelle/page.tsx` ✅
- `anfragen/page.tsx` ✅

### Befund I-2: ✅ GUT — Modals mit max-width

- `Modal.tsx`: `max-w-lg` ✅
- Einlager-Modals: `maxWidth: 480/560px` ✅

### Befund I-3: 🟢 KOSMETISCH — ETL-Grid auf 375px eng

`src/app/admin/lagerplaetze/page.tsx` — EtlReihe-Grid mit 4–5 Spalten:  
Auf 375px-Viewpoint werden die Kacheln sehr schmal (<60px). Horizontal-Scroll wäre akzeptabel, gibt es aber nicht auf dem Grid.

**Fix:** `overflow-x-auto` auf den Grid-Container der EtlReihe.  
**Aufwand:** XS

---

## Gesamt-Übersicht

| # | Schwere | Befund | Datei | Aufwand |
|---|---------|--------|-------|---------|
| A-1 | 🔴 KRITISCH | Touch-Targets <60px (15+ Stellen) | `einlagern/page.tsx`, `anfragen/page.tsx`, `layout.tsx`, `Modal.tsx` | M |
| C-2 | 🔴 KRITISCH | `#202F61` hardkodiert in Dark Mode | `einlagern/page.tsx` | S |
| H-2 | ✅ ERLEDIGT | Login + Benutzer-Formulare mit htmlFor/id verknüpft | `login/page.tsx`, `benutzer/neu`, `benutzer/[id]` | XS |
| B-2 | 🟡 WICHTIG | Font-Size-Toggle fehlt im Admin-Panel | `admin/layout.tsx` | XS |
| C-3 | 🟡 WICHTIG | Mobile Topbar ohne Dark-Mode | `admin/layout.tsx:173` | XS |
| D-1 | 🟡 WICHTIG | „Dark" statt „Dunkel" | `techniker/layout.tsx:194` | XS |
| G-2 | 🟡 WICHTIG | Kein Focus-Trap in Modals | `Modal.tsx` | S |
| H-3 | 🟡 WICHTIG | `×`-Buttons ohne `aria-label` | Mehrere Dateien | XS |
| F-2 | 🟢 KOSMETISCH | Sub-Query ohne Error-State | `modelle/page.tsx` | XS |
| G-3 | 🟢 KOSMETISCH | Focus-Ring teilweise unsichtbar | global CSS | XS |
| I-3 | 🟢 KOSMETISCH | ETL-Grid auf 375px ohne Scroll | `lagerplaetze/page.tsx` | XS |

---

## Was vorbildlich umgesetzt ist

- **Dark-Mode-Infrastruktur** (`globals.css`, CSS-Variablen, kein Flicker) — Beispielhaft ✅
- **Einlager-Wizard Touch-Targets** (`S.bigBtn`: 70px) — Korrekt ✅
- **Barrierefreie aria-labels im Wizard** — Durchgängig Deutsch, beschreibend ✅
- **Font-Size-Toggle im Techniker-Portal** — Vollständig mit LocalStorage ✅
- **Mobile Tabellen** — Alle scrollbar ✅
- **Escape-Handling in Modals** — Konsistent umgesetzt ✅
- **AfB-Farbsystem** — Konsequent eingehalten ✅
- **Grading-Farben** — A+=A=Green, B=Cyan, C=Orange — Spec-konform ✅

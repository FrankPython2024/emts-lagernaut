# Diagnose: Schriftgrößen-Toggle wirkt nicht überall

**Datum:** 2026-05-15  
**Status:** Diagnose abgeschlossen — Ursache gefunden

---

## TL;DR

Der Toggle-Mechanismus hat einen fundamentalen CSS-Fehler:
**Klassen werden auf `<body>` gesetzt, aber `rem`-Einheiten sind relativ zu `<html>`.**
Ein 10-Minuten-Fix in 2 Dateien behebt das vollständig.

---

## A) Wie der Mechanismus aktuell funktioniert

### Was passiert beim Klick auf „Groß":

```
1. JS: document.body.classList.add("font-large")
2. CSS: body.font-large { --base-font: 22px; }
3. CSS: body { font-size: var(--base-font); }  → body wird 22px
```

**Das Problem:** `rem`-Einheiten in CSS sind per Spec **immer relativ zum `<html>`-Element**, 
nicht zum `<body>`. Ändert man nur `<body>`, skaliert nichts, das `rem` verwendet.

**Konkret:**
```css
/* Tailwind text-sm = 0.875rem */
/* 0.875 × html.font-size(16px) = 14px  — IMMER, egal was body macht */

/* Inline: fontSize: "0.9rem" */
/* 0.9 × html.font-size(16px) = 14.4px  — IMMER */
```

Was DOCH skaliert (als Nebeneffekt): Text, der kein `font-size` hat und 
`font-size` von body **erbt** (d.h. keine eigene Größe gesetzt hat). Das ist 
in einer React-App mit Tailwind-Klassen fast nichts.

### Zusammenfassung der Kette:

| Was | Skaliert? | Warum |
|-----|-----------|-------|
| Tailwind `text-sm`, `text-base` etc. | ❌ NEIN | 0.875rem × 16px (html-root) |
| Inline `fontSize: "0.9rem"` | ❌ NEIN | × html-root, nicht body |
| Inline `fontSize: "14px"` | ❌ NEIN | Absolut |
| Text ohne `font-size` | ✅ JA | Erbt von body |

In der Praxis: **fast alles hat eine explizite Größe → toggle wirkt nicht sichtbar.**

---

## B) Tailwind text-* Klassen — Inventar

Tailwind v3 (eingesetzt) verwendet **rem-Einheiten by default**.

Gefunden: **mehrere hundert** `text-*`-Vorkommen in ~52 Dateien.

Top-Dateien:
- `statistiken/page.tsx` — 65 Vorkommen
- `geraete-import/page.tsx` — 56 Vorkommen
- `modelle/page.tsx` — 48 Vorkommen
- `anfragen/page.tsx` — 46 Vorkommen

Da alle `rem` verwenden, würden sie **mit dem Fix (s. unten) automatisch skalieren** — 
kein manuelles Anpassen nötig.

---

## C) Inline `fontSize`-Stellen

**415 inline `fontSize`-Properties** in `src/`.

Die meisten verwenden `rem`-Werte (`"0.85rem"`, `"1.1rem"`, `"1.4rem"` etc.) — 
diese skalieren **nach dem Fix ebenfalls automatisch**.

**Nicht skalierend bleiben (und das ist richtig):**
- `fontSize: "6pt"`, `"7pt"`, `"9pt"` → in Druckkomponenten (`EinlagerBeleg.tsx`, `ArtikelLabel.tsx`)  
  Drucker kennt keine CSS-Variablen — diese müssen absolut bleiben.
- `fontSize: "6px"`, `"14px"` → einzelne Spezialfälle (QR-Code, Badges)

**Migration nötig:** ~5–10 absolute px-Werte in der UI (nicht in Print).

---

## D) Der konkrete Fix (kleiner Pfad)

**2 Änderungen, ~10 Minuten:**

### 1. `src/app/globals.css` — Klassen von `body` auf `html`/`:root` verschieben

```css
/* ALT (wirkt nicht) */
body.font-small  { --base-font: 14px; }
body.font-medium { --base-font: 18px; }
body.font-large  { --base-font: 22px; }

/* NEU (wirkt auf alle rem) */
:root, html.font-small  { font-size: 14px; }
      html.font-medium { font-size: 18px; }
      html.font-large  { font-size: 22px; }
```

*(Die `--base-font`-Variable kann wegfallen oder als Alias bleiben.)*

### 2. JS — `document.body` → `document.documentElement`

In `FontSizeToggle.tsx` (und `techniker/layout.tsx`):
```typescript
// ALT
document.body.classList.remove("font-small", "font-medium", "font-large");
document.body.classList.add(`font-${s}`);

// NEU
document.documentElement.classList.remove("font-small", "font-medium", "font-large");
document.documentElement.classList.add(`font-${s}`);
```

**Ergebnis nach Fix:**
- `html.font-large` → `font-size: 22px` → `1rem = 22px` überall
- Alle Tailwind `text-sm/base/lg` skalieren automatisch ✅
- Alle `fontSize: "0.9rem"` skalieren automatisch ✅
- Druckkomponenten mit `pt`/`px` bleiben unverändert ✅
- `--base-font`-Variable für `body { font-size }` kann bleiben (leichte Schrift-Größenanpassung)

---

## E) Großer Pfad (nicht empfohlen)

Alle 415 Inline-Properties und ~500 Tailwind-Klassen auf CSS-Variable umstellen.

**Aufwand:** 8–16h, hohes Regressionsrisiko.  
**Nicht nötig**, weil der kleine Fix das gleiche Ergebnis liefert.

---

## Empfehlung

**Kleiner Fix** (10min, sicher):
1. `globals.css`: CSS-Klassen auf `html.*` umstellen
2. `FontSizeToggle.tsx` + `techniker/layout.tsx`: `document.documentElement` statt `document.body`

Danach skalieren:
- Alle Tailwind `text-*` ✅
- Alle Inline rem-Werte ✅
- Druckkomponenten bleiben absolut ✅

**Geschätzter Aufwand:** 10 Minuten Code + manueller Test.

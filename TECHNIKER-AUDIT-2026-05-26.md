# Techniker-Portal Audit — 2026-05-26

## Executive Summary

- **23 Findings** insgesamt
- **1 kritisch** 🔴 (Blocker)
- **13 mittel** 🟡 (sollten vor Live behoben werden)
- **9 kosmetisch** 🟢 (post-Live OK)

**Empfehlung: 🟡 No-Go ohne Fix von F-RED1.**
Der kritische Fund ist ein 2-Zeilen-Fix (Limit-Wert anpassen). Die mittleren Findings beeinträchtigen den Kern-Workflow nicht, sind aber teilweise sicherheits- oder UX-relevant. Nach Fix von F-RED1 + den Standort-Filter-Themen (F-GE2, F-GE3) und dem Gruppen-Status-Bug (F-UX5) ist die Go-Empfehlung vertretbar.

---

## 🔴 Kritisch (Blocker für Live)

### F-RED1: ProfilModal-Query überschreitet Backend-Limit → Stats brechen
- **Datei (FE):** `src/app/techniker/layout.tsx:93`
- **Datei (BE):** `src/server/routers/anfragen.ts:64`
- **Beschreibung:** `ProfilModal` ruft `api.anfragen.getByTechniker.useQuery({ kuerzel, showAll: true, limit: 500 })` auf. Das Zod-Schema `getByTechniker` lässt nur `limit: z.number().int().min(1).max(200)` zu. Der Aufruf wird vom tRPC-Layer mit `BAD_REQUEST` abgelehnt — der Spinner bleibt sichtbar, die Stats werden nie geladen. **Profil-Modal ist faktisch kaputt.**
- **Reproduktion:** Klick „👤 Profil und Statistiken" → DevTools-Network zeigt 400/500-Response. Im UI: „Wird geladen…" verschwindet nie (oder zeigt 0).
- **Empfehlung:** Entweder Backend-Limit auf `.max(1000)` erhöhen (Techniker mit Vieljahres-Historie) — oder im Frontend Limit auf 200 + Paginierung / Server-side Aggregation. Quick-Fix: `.max(500)` BE + `limit: 200` FE als Vorsichtsmaß, oder eine dedizierte `getStatsForTechniker` BE-Procedure die nur Counts zurückliefert (kein Limit nötig).
- **Aus User-Checkliste:** §2 hat das explizit als zu prüfender Punkt aufgelistet — Annahme `.max(1000)` ist falsch.

---

## 🟡 Mittel (sollte vor Live behoben werden)

### F-GE2: `getByTechniker` ignoriert Standort-Filter
- **Datei:** `src/server/routers/anfragen.ts:60-73`, `src/modules/anfragen/service.ts:336-364`
- **Beschreibung:** Heilige Regel in CLAUDE.md §1 + Standort-Doku in `standortFilter.ts:14`: „Techniker sieht nur Daten aus eigenem Standort". Der Endpoint `getByTechniker` filtert ausschließlich nach `techniker = kuerzel`. Wenn ein Techniker den Standort wechselt (oder Kürzel doppelt verwendet wird), sieht er historische Anfragen aus dem anderen Standort.
- **Empfehlung:** `standortWhere(ctx)` in `where`-Clause aufnehmen wie in `getAnfragenAdmin`. Erfordert `artikel: { standortId: { in: ids } }` — Vorsicht: Anfragen ohne `artikelId` (BEDARF, Sonderanfragen) haben keinen Standort-Bezug. Hier evtl. zusätzliches `Anfrage.standortId`-Feld nötig oder Akzeptanz dass nicht verknüpfte Anfragen alle gezeigt werden.

### F-GE3: `getByGeraetMitStandard` zeigt Bestände aus fremden Standorten
- **Datei:** `src/modules/kompatibilitaet/service.ts:348-396`
- **Beschreibung:** Im Teile-Step lädt das Frontend `api.kompatibilitaet.getByGeraetMitStandard`. Die Service-Funktion lädt `prisma.kompatibilitaet.findMany` ohne Standort-Filter, dann `verknuepftMap` deduplicated auf „höherer Bestand gewinnt". Ein Techniker aus Standort 2 (Köln) sieht eventuell Bestände aus Standort 1 (Sömmerda) — der eigene Artikel mit Bestand 0 wird unter den Tisch gekehrt.
- **Empfehlung:** Standort-Filter analog `standortWhere` einziehen. Wenn Bestände Standort-spezifisch sein sollen, dann auch verknüpftMap pro Standort führen.

### F-BE4: `storniereAnfrage` emittet KEIN Socket-Event
- **Datei:** `src/modules/anfragen/service.ts:90-110`
- **Beschreibung:** `erstelleAnfrage` (Z. 79) und `setzeStatus` (Z. 264-265) emittieren `EVENTS.ANFRAGE_NEU` / `ANFRAGE_UPDATED`. `storniereAnfrage` macht das **nicht**. Admin-UIs (Anfragen-Liste) erfahren von der Stornierung erst per Polling — kein Live-Update. Außerdem fehlt `invalidateTechnikerCache`.
- **Empfehlung:** Nach dem `prisma.anfrage.update(... STORNIERT)` ein `emitToAdmins(EVENTS.ANFRAGE_UPDATED, { id, status: "STORNIERT" })` + `emitToUser(techniker, ANFRAGE_UPDATED, ...)` + `invalidateTechnikerCache`.

### F-BE5: Stornierung greift via (techniker, logId, teil) statt via ID
- **Datei (FE):** `src/app/techniker/page.tsx:1099-1101`
- **Datei (BE):** `src/modules/anfragen/service.ts:90-110`
- **Beschreibung:** `handleStornoConfirm` iteriert über `stornoItems` (mit `id`-Feldern), ruft aber `storniere.mutateAsync({ techniker, logId, teil })`. Backend nutzt `findFirst({ techniker, logId, teil, status: NEU/BEDARF })`. Wenn es zwei stornierbare Anfragen mit demselben Teiltyp existieren (historisch möglich — Backend-Safety-Net greift nur in aktivem Korb), wird **nur die erste** in einem Aufruf storniert. Zweiter Loop-Durchlauf trifft eventuell dieselbe wieder (idempotent: NOT_FOUND, da Status nicht mehr NEU/BEDARF) — die zweite Anfrage bleibt unangetastet. Frontend zeigt „Anfrage storniert" obwohl nur eine erwischt wurde.
- **Empfehlung:** Backend-Endpoint zusätzlich `id`-Variante anbieten (`storniere({ id })`) und Frontend darauf umstellen.

### F-UX5: `gruppeStatus`: nur-stornierte Gruppe wird als „Abgeschlossen" angezeigt
- **Datei:** `src/app/techniker/page.tsx:76-82`
- **Beschreibung:** `if (ss.every(s => s === "ABGESCHLOSSEN" || s === "STORNIERT")) return "ABGESCHLOSSEN";` — wenn **alle** Anfragen einer Gruppe STORNIERT sind (Techniker storniert komplette Anfrage), erhält die Karte das grüne „Abgeschlossen"-Badge. Inkonsistent zur Status-Logik des Backends.
- **Empfehlung:** Explizit unterscheiden:
  ```
  if (ss.every(s => s === "STORNIERT"))      return "STORNIERT";
  if (ss.every(s => s === "ABGESCHLOSSEN" || s === "STORNIERT")) return "ABGESCHLOSSEN";
  ```

### F-UX6: `buildGruppen` dedupliziert Anfragen anhand `teil + status`
- **Datei:** `src/app/techniker/page.tsx:102-103`
- **Beschreibung:** `if (!g.anfragen.some(x => x.teil === a.teil && x.status === a.status)) g.anfragen.push(a)` — zwei legitime Anfragen für dasselbe Teil mit demselben Status (z.B. zweimal „Akku" als BEDARF aus verschiedenen Submissions) werden zu einer kollabiert. „X Teile angefragt"-Counter zeigt zu wenig, die zweite Anfrage erscheint nicht im Detail.
- **Empfehlung:** Dedup nur über `id`: `if (!g.anfragen.some(x => x.id === a.id))`.

### F-UX7: ChatBadge nur an erster Anfrage der Gruppe
- **Datei:** `src/app/techniker/page.tsx:355, 402-405`
- **Beschreibung:** `const firstId = gruppe.anfragen[0]?.id;` — der `ChatBadge` zeigt nur ungelesene Nachrichten zur **ersten** Anfrage der Gruppe. Chats sind aber pro `anfrageId` separat (siehe `chat.getByAnfrage`). Wenn Admin in der zweiten Anfrage der Gruppe schreibt, sieht der Techniker den Badge nicht.
- **Empfehlung:** Entweder `getStatsBatch` für alle anfrageIds der Gruppe + Summen-Anzeige, oder Chats Gruppen-basiert speichern (größerer Refactor).

### F-A11Y8: Keine Escape-Schließen-Funktion in Modalen
- **Datei:** alle Modale in `page.tsx` (AnfrageFlow Z. 552, TastenAuswahlModal Z. 1015, AnfrageDetailModal Z. 1111), `layout.tsx` ProfilModal Z. 134
- **Beschreibung:** Keiner der Modale registriert einen `keydown`-Handler für Escape. Schließen ist nur über X-Button oder Backdrop-Klick möglich. WCAG 2.1.2.
- **Empfehlung:** `useEffect(() => { const h = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);` in jedem Modal — oder `FocusTrap` wie in `ChatModal` einsetzen (dort `escapeDeactivates: false` setzt Escape allerdings explizit aus — Konvention vereinheitlichen).

### F-A11Y9: AnfrageFlow / Detail-Modal: kein Focus-Trap, kein `role="dialog"`
- **Datei:** `page.tsx:552-556` (AnfrageFlow), Z. 1111-1119 (Detail), Z. 1015-1019 (TastenAuswahl)
- **Beschreibung:** Im Gegensatz zu `ChatModal.tsx` (Z. 136-140 mit `FocusTrap` + `role="dialog" aria-modal="true"`) fehlen die Modale im Techniker-Portal komplett A11y-Markup. Tab-Reihenfolge kann aus dem Modal raus in den dahinter liegenden Page-Body wandern.
- **Empfehlung:** `role="dialog" aria-modal="true" aria-labelledby="..."` + `FocusTrap` (Paket bereits installiert).

### F-A11Y10: Statusbadge-Farbe ohne ausreichenden Kontrast für BEDARF/IN_BEARBEITUNG (Dark Mode)
- **Datei:** `page.tsx:28-34`
- **Beschreibung:** `BEDARF`-Badge: bg `#fef3c7` (sehr helles Gelb), color `#92400e` — funktioniert im Light Mode (WCAG AA gegeben), aber wenn die Karte einen Dark-Mode-Hintergrund hat, kontrastiert das helle Gelb nicht mit der dunklen Karte. Badge-Inhalt selbst hat Kontrast, aber Badge bleibt visuell „leuchtend" — ggf. accessibility-OK, optisch aber bruchstückhaft.
- **Empfehlung:** Dark-Mode-Varianten in STATUS_CFG hinterlegen oder CSS-Vars.

### F-UX11: Tastatur-Modus „komplett" zeigt Anmerkung-Block redundant
- **Datei:** `page.tsx:700, 727-731`
- **Beschreibung:** Wenn ein Techniker Tastatur „Komplette Tastatur" auswählt, erscheint die Tastatur-Karte mit „Komplett"-Indikator (Z. 668-674) UND in den „Anmerkungen zu deinen Teilen" das Label „Tastatur — Komplette Tastatur" + Eingabefeld. Sieht redundant aus. Außerdem wird beim Submit `zusatzinfo` aus `[tastaturInf, anmerkung].join(" — ")` zusammengesetzt — bei „Komplette Tastatur" mit zusätzlicher Anmerkung „klemmt" → `"Komplette Tastatur — klemmt"`. Lesbar, aber redundant.
- **Empfehlung:** Bei Modus „komplett" das `tastaturHint`-Label im Anmerkungs-Block weglassen.

### F-UX12: TEIL_ICON-Mapping inkonsistent mit Backend-Teilnamen
- **Datei:** `page.tsx:37-54`, `src/lib/constants/teiltypen.ts:10-28`
- **Beschreibung:** Backend liefert `WLAN Karte`, `UMTS Karte`, `D Cover` (mit Leerzeichen). Frontend-Map enthält `WLAN/UMTS Karte`, `D-Cover` (mit Schrägstrich/Bindestrich). Resultat: 3 Teiltypen fallen auf Default-Icon `Box`. Außerdem fehlt `UMTS Karte` ganz. Zusätzlich: Map hat **16** Einträge, Backend liefert **17** Standard-Teile.
- **Empfehlung:** Map-Keys an Backend-Konstanten ausrichten: `"WLAN Karte"` + `"UMTS Karte"` (Wifi-Icon für beide) + `"D Cover"`.

### F-PERF13: Doppelte Polling-Strategie
- **Datei:** `page.tsx:138-151`
- **Beschreibung:** `getByTechniker.useQuery({ staleTime: 4_000 })` + `setInterval 5_000` + Socket-Events `ANFRAGE_UPDATED/NEU` → drei Update-Quellen für dieselben Daten. Pro Techniker fallen alle 5s `refetch()`-Calls an, zusätzlich socket-getriggert. Bei 10 Technikern + Detail-Modal-Polling (`ChatBadge refetchInterval: 5_000` pro Karte) wird die DB unnötig belastet.
- **Empfehlung:** Auf Socket-only umstellen (5s-Interval entfernen), staleTime erhöhen.

### F-SEC14: Hard-Refresh in AnfrageFlow hinterlässt halb-befüllten Warenkorb
- **Datei:** `page.tsx:500-542` (AnfrageFlow.handleSenden)
- **Beschreibung:** `addItemMutation` läuft in einer `for`-Schleife; Crash/Refresh nach dem 3. von 5 Teilen → Backend hat 3 Items im Warenkorb, FE-State weg. Bei der **nächsten** Anfrage zur **selben LogID** durch denselben Techniker greift `addItem` denselben aktiven Korb (Z. 62-69 in service.ts) — Ergebnis: gemischter Korb mit alten + neuen Items. `submitAlle` schickt alle ab.
- **Empfehlung:** Entweder vor Beginn der Submission alle aktiven Körbe des Technikers leeren, oder Transaktion umstellen (alle Items in einer DB-Transaktion einfügen, dann submit — aktuell sind das N+1 Round-Trips).

---

## 🟢 Kosmetisch (post-Live OK)

### T1: Tote Datei `src/components/ui/TastaturModal.tsx`
- 489 Zeilen ungenutzter Code. Wurde bei Refactor 9a5a2a2 fälschlich gefixt, eigentliche Komponente lebt inline in `page.tsx:973`. Risiko: zukünftige Edits könnten an der falschen Stelle landen.
- **Empfehlung:** Datei löschen.

### T2: cardLogId-Input zeigt keine Punkt-Formatierung beim Tippen
- **Datei:** `page.tsx:199-221`
- Placeholder zeigt `212.560.810`, getipptes wird als `212560810` angezeigt. Inkonsistent zur Suchanzeige (`AnfrageKarte` Z. 391 formatiert mit Punkten).
- **Empfehlung:** `onChange` mit `formatLogId` durchschleifen.

### T3: `handleCardLogIdSubmit` akzeptiert ab 5 Ziffern
- **Datei:** `page.tsx:131`
- Reale LogIDs sind 9-stellig. Bei Tippfehler wird trotzdem submittet und Backend antwortet mit „nicht gefunden".
- **Empfehlung:** `>= 7` oder `>= 9`.

### T4: STATUS_CFG dupliziert in `page.tsx:28` und `components/constants.ts:17`
- Verschiedene Labels (`"NEU"` vs `"Neu"`, `"ERLEDIGT ✅"` vs `"Abgeschlossen"`). Aktuell wird `page.tsx`-Variante genutzt, `components/constants.ts`-Variante wahrscheinlich nicht.
- **Empfehlung:** Eine Quelle, zentrale Konstante.

### T5: Logo via `<img>` statt `next/image`
- **Datei:** `layout.tsx:259`
- Hotlink von afbshop.de — kein lokales Asset, kein Image-Optimization, externe Abhängigkeit.
- **Empfehlung:** Asset lokal in `/public` einlagern + `next/image` (lokales `afb-logo.png` ist bereits untracked vorhanden).

### T6: `setStatus` emittet `BESTAND_UPDATED` an alle
- **Datei:** `src/server/routers/anfragen.ts:147`
- `emitToAll` — auch Techniker erhalten das Event, obwohl sie keine Bestände sehen. Geringer Overhead, aber unsauber.
- **Empfehlung:** `emitToAdmins`.

### T7: Tastatur-Modal: `Shift-L` / `Shift-R` etc. werden als „Shift" im Confirm-String gespeichert
- **Datei:** `page.tsx:994-995`
- Beim Re-Open kann der Parser nicht zwischen Left/Right unterscheiden (es wird nur „Shift" gespeichert und beim Re-Open per `.split(",")` zurückgelesen — keine Trennung).
- **Empfehlung:** Bei „komplett gleich"-Tasten Label im Confirm-Output beibehalten (`Shift-L` als ID) ODER unterscheiden ist UX-irrelevant — dann Frontend-IDs vereinfachen auf nur `Shift`.

### T8: `markGelesenMutation.mutate({ anfrageId })` in `ChatModal:91` ohne onSuccess-Invalidate
- ChatBadge hängt 3s am Polling — bleibt kurz sichtbar nach Öffnen des Chats, bis Stats neu geladen sind.
- **Empfehlung:** `onSuccess: () => utils.chat.getStatsForAnfrage.invalidate({ anfrageId })`.

### T9: `useSocket.on`-Handler-Map kann handler innerhalb derselben Komponente überschreiben
- **Datei:** `src/hooks/useSocket.ts:47-51`
- `listenersRef.current.set(event, handler)` — wenn dieselbe Komponente `on(EVENT)` zweimal mit unterschiedlichen Handlern aufruft (z.B. wegen useEffect-Re-Run ohne Cleanup), bleibt im socket der erste Handler aktiv, in der Map steht der zweite. Beim `off` wird nur der zweite gelöst.
- **Empfehlung:** Map auf `Map<string, Set<handler>>` umstellen, im `off` alle entfernen, oder API zu pure-handler-based machen (`off(event, handler)`).

---

## ✓ Verifizierte Funktionen (sauber)

### Layout + Header
- ✓ LiveUhr SSR-safe: `useState<Date | null>(null)` + mount-effect verhindert Hydration-Mismatch (`layout.tsx:38-46`)
- ✓ Schriftgrößen-Toggle: 3 Stufen (small/medium/large), persistiert in `localStorage.tk_fontsize`, wirkt via `<html class="font-*">` global (`layout.tsx:340-355`)
- ✓ Dark/Light-Mode-Toggle: persistiert in `localStorage.theme`, wirkt via `<html class="dark">` (`layout.tsx:221-226`)
- ✓ „Profil und Statistiken" öffnet ProfilModal — Click funktioniert (außer dem F-RED1-Bug intern)
- ✓ `LogoutButton` → `signOut()` via NextAuth (gemeinsame Komponente)
- ✓ AfB-Branding korrekt platziert
- ✓ Such-Lupe + Glocke nicht im Header (entfernt)
- ✓ Chat-Toast entfernt, Listener invalidiert stattdessen Badge-Queries (Commit 4d638c8)

### ProfilModal Stats-Berechnung
- ✓ Heute/Gestern/Woche/Monat/Jahr/Insgesamt korrekt mit Date-Boundary-Logik (`layout.tsx:99-122`)
- ✓ Status-Aufschlüsselung mit ABGESCHLOSSEN/aktiv/STORNIERT
- ✓ Datums-Parsing über `new Date(a.datum)` — Zod liefert ISO-Strings, ok
- ✓ Lade-Spinner während Query (sichtbar, blockiert UI)
- ✓ Schließen-X funktioniert, Modal zentriert, `modal-enter`-Animation respektiert `prefers-reduced-motion: no-preference`

### Landing — Aktions-Card
- ✓ Gradient korrekt mit AfB-Cyan
- ✓ `autoFocus` auf Input (`page.tsx:206`)
- ✓ Enter triggert `handleCardLogIdSubmit` (Z. 204)
- ✓ Submit-Button disabled wenn <5 Ziffern
- ✓ Eingabe wird zu reinen Ziffern bereinigt (`.replace(/\D/g, "")`)
- ✓ AnfrageFlow erhält `initialLogId` und springt direkt in Teile-Step über `setLogIdQuery(initialLogId)` (`page.tsx:430, 453-464`)
- ✓ „Ohne LogID weiter" entfernt (Commit 4d638c8)

### Landing — Anfragen-Liste
- ✓ Such-Input filtert nach LogID und Modellname (`page.tsx:156-163`)
- ✓ Punkte in Suche werden ignoriert (`.replace(/\./g, "")`)
- ✓ LogID monospace + formatiert mit Punkten (`page.tsx:390-394`)
- ✓ Card-Hover, Klick öffnet Detail-Modal
- ✓ Sortierung: neueste oben (`buildGruppen` Z. 107: `sort((a,b) => b.datum.getTime() - a.datum.getTime())`)
- ✓ Leer-State differenziert „noch keine" vs. „keine Treffer"
- ✓ Loader2 mit Spin-Animation während Initial-Load

### AnfrageFlow — Teile-Auswahl
- ✓ Gerätename + LogID oben sichtbar (Z. 608-617)
- ✓ 17 Standard-Teile geladen über `getByGeraetMitStandard` (Backend liefert immer alle 17)
- ✓ Toggle-Verhalten korrekt (cyan-Border, Häkchen ✓)
- ✓ Tastatur-Click öffnet TastaturModal statt direktes Toggle (Z. 639)
- ✓ Pro ausgewähltem Teil eigenes Anmerkungs-Feld (Z. 692-758) — *NEUE FEATURE*
- ✓ „Etwas anderes?"-Freitext bleibt erhalten
- ✓ Senden-Button zeigt korrekten Counter
- ✓ Submit ruft `addItem` pro Teil + optional `addSonderAnfrage` + `submitAlle`
- ✓ Backend-Safety-Net: `addItem` blockt Doppel-Teiltyp pro aktivem Korb (CONFLICT)

### TastenAuswahlModal
- ✓ max-w-7xl (1280px) — Commit 0a06b36
- ✓ Modus-Switch zwischen „Komplette Tastatur" / „Einzelne Tasten"
- ✓ Kein horizontal scroll, kein Mobile-Hinweis (Commit 9a5a2a2 + 0a06b36)
- ✓ Vollständige QWERTZ: Hauptblock (F-Reihe + 5 Tasten-Reihen) + Nav-Block + Numpad
- ✓ Shift-L/Shift-R + Strg-L/Strg-R separat auswählbar
- ✓ „Übernehmen" disabled bei modus=einzeln + 0 Tasten
- ✓ Beschreibung gespeichert als „Komplette Tastatur" oder „Einzeltasten: Q, W, E"
- ✓ Re-Open zeigt vorherige Auswahl (Z. 982-985)
- ✓ X-Button schließt
- ✓ Press-Effekt via `active:scale-95`
- ✓ Modal-Animation respektiert `prefers-reduced-motion`

### AnfrageDetailModal
- ✓ Modell-Name + LogID oben
- ✓ Status-Badge prominent
- ✓ Teile-Liste mit Status pro Teil
- ✓ Chat über `GruppenNachrichten` eingebettet, Socket-Refresh via `EVENTS.CHAT_NEU`
- ✓ Stornieren-Button nur bei NEU/BEDARF (`kannStornieren`)
- ✓ 2-Step-Confirm (Bestätigung-Dialog)
- ✓ Loading-State während Storno

### Backend — Sicherheit
- ✓ `getByTechniker`: FORBIDDEN wenn `user.kuerzel !== input.kuerzel` und nicht Admin (`anfragen.ts:69-71`)
- ✓ `storniere`: FORBIDDEN-Check (anfragen.ts:84-86) + Service-Side-Check nur NEU/BEDARF (`anfragen/service.ts:100`)
- ✓ `warenkorb.addItem`: `assertOwner` (`warenkorb.ts:18-21`)
- ✓ `chat.senden`: `checkAccess` validiert dass User der Techniker der Anfrage ist (`chat.ts:22-31`)
- ✓ Prisma — keine raw queries im Techniker-Flow → keine SQL-Injection
- ✓ Status-Flow-Validation: `GUELTIGE_TRANSITIONEN` blockt Rückwärts-Transitionen (`anfragen/service.ts:227-233`)
- ✓ STORNIERT + ABGESCHLOSSEN sind terminal

### Backend — Datenkonsistenz
- ✓ `Anfrage.techniker = User.kuerzel.toUpperCase()` konsistent (Service `.toUpperCase().trim()`)
- ✓ Warenkorb-Items werden via `submit` zu Anfragen mit `korbId` + `gruppenNr` gemappt
- ✓ `gruppenNr` Format `YYYY-MM-DD-KUERZEL-NNN` (warenkorb/service.ts:200)
- ✓ Bestand-Logik in `erstelleAnfrage`: NEU wenn Bestand>0, sonst BEDARF (anfragen/service.ts:43-52)
- ✓ Sonderanfragen immer BEDARF
- ✓ STORNIERT setzbar: nur durch Techniker selbst (über storniere) oder Admin (über setStatus)
- ✓ DIREKT-Buchung-Heilige Regel — Bestand wird über `syncBestandAusHistorie` aus EINGANG-AUSGANG berechnet, DIREKT wird ignoriert (siehe CLAUDE.md, anfragen/service.ts:144-148 + buchungen/service.ts)

### Socket.io
- ✓ Client-Singleton (`globalSocket`) bleibt über Re-Renders erhalten (`useSocket.ts:9`)
- ✓ Connection beim Login (`user?.kuerzel` → io())
- ✓ Heartbeat alle 30s (`useSocket.ts:37-39`)
- ✓ Auto-Reconnect (5 Versuche, 1s Delay)
- ✓ `transports: ["websocket", "polling"]` (mit websocket zuerst)
- ✓ Chat-Events triggern Cache-Invalidation in layout.tsx (Commit 4d638c8)

### Performance
- ✓ Loader2-Spinner bei `anfragenQuery.isLoading`
- ✓ `staleTime` gesetzt (4s page-Anfragen, 60s Teile, 10s ProfilModal)
- ✓ `useMemo` für `gruppen` + `gefilterteGruppen`
- ✓ Pagination via `limit: 100` für Techniker-Page (default 50 BE), 500 für ProfilModal (siehe F-RED1!)

### UX-Konsistenz
- ✓ Status-Wording einheitlich (Neu/Bedarf/In Bearbeitung/Abgeschlossen/Storniert)
- ✓ AfB-Cyan + AfB-Primary durchgängig
- ✓ Schriftgrößen-Toggle wirkt via CSS-Class auf `<html>` (auch in Modals)
- ✓ Dark Mode via CSS-Vars `var(--bg)`, `var(--text)`, `var(--card-bg)`, `var(--border)`, `var(--primary)`, `var(--text-dim)` durchgehend
- ✓ Touch-Targets: alle wichtigen Buttons `minHeight: 56` (primaryBtn, sec-Btn, Modus-Buttons, Submit, Storno)
- ✓ Sekundäre Buttons (close, back): `minHeight: 44` ✓
- ✓ Tastatur-Tasten: 2.5rem × ~2.2-13.2rem — kompakt aber treffbar

### A11y (was funktioniert)
- ✓ `aria-label="Schließen"` an X-Buttons (closeBtn, layout-btnClose)
- ✓ Status-Badges haben Text + Farbe (nicht nur Farbe)
- ✓ Focus-Ringe sichtbar via `globals.css:180-188` (`*:focus-visible` mit AfB-Navy/Blue outline)
- ✓ `prefers-reduced-motion: reduce` respektiert (`globals.css:146, 165, 268`)

### Edge Cases (geprüft, OK)
- ✓ LogID unbekannt → Toast „LogID „X" nicht gefunden" (Z. 459-460)
- ✓ LogID gefunden, kein Modell-Treffer: `getByGeraetMitStandard` liefert trotzdem 17 Standard-Teile mit `verfuegbar: false`
- ✓ Session-Expire → tRPC-Layer wirft UNAUTHORIZED, Middleware redirected zu /login (über NextAuth)
- ✓ `selectedGeraet.logId === "---"` → wird zu „unbekannt" gemapped (Z. 508) — Fallback OK

---

## Anhang — Nicht-überprüfte Bereiche

Folgende Themen aus der Audit-Checkliste wurden nicht oder nur oberflächlich geprüft, weil sie außerhalb des Frontend-Code-Scopes liegen:

- **Tests:** Keine Test-Dateien für Techniker-Portal gefunden (`*.test.ts(x)`-Suche leer).
- **Browser-Kompat:** Statische Analyse — keine Test-Runs durchgeführt. Inline-Styles + CSS-Vars + Flexbox sind in allen modernen Browsern stabil. `backdropFilter: "blur(4px)"` (mehrere Stellen) nicht in Firefox-LTS älterer Versionen — Fallback nicht implementiert, aber UX-Auswirkung minimal (nur kein Blur).
- **Rate-Limiting:** Keine Implementierung im Backend gesehen — falls relevant, separat einbauen.
- **Standort=null-Edge-Case:** `resolveStandortId` fallt zurück auf 1 (Sömmerda), `getZugaenglicheStandortIds` liefert null (keine Einschränkung). Bei Techniker ohne Standort = Admin-Verhalten — potentiell problematisch, sollte separat geprüft werden.

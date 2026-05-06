# EMTS Lagernaut v2 — Entwicklungs-Dokumentation

## Stack

| Schicht | Technologie |
|---|---|
| Framework | Next.js 15 (App Router) |
| UI | React 19 |
| Typen | TypeScript strict |
| API | tRPC v11 |
| ORM | Prisma 5 |
| Datenbank | MySQL 8 |
| Cache / Queue | Redis + BullMQ |
| Realtime | Socket.io |
| Suche | Meilisearch |
| Infrastruktur | Docker Compose |

## Server & Deployment

- **Server:** Hetzner VPS `49.13.162.158`
- **Projektpfad:** `/var/www/lagernaut`
- **Deploy:** `docker compose up -d --build`
- **Port:** 3000

## Kritische Geschäftsregeln — NIEMALS vergessen

### 1. DIREKT-Buchung = KEIN Bestandseinfluss
```
EINGANG  → Bestand +1
AUSGANG  → Bestand -1
DIREKT   → Eingang + Ausgang = Netto 0 (wird NICHT auf Bestand angerechnet)
```
DIREKT ist eine Bedarf-Buchung. Sie schreibt beide Buchungen, ändert aber den
Netto-Bestand nicht. Nur EINGANG und AUSGANG zählen für den Bestand.

### 2. Kein Lagerplatz im Techniker-Portal
Techniker sehen KEINEN Lagerplatz/Lagerort. Dieser ist nur im Admin-Bereich sichtbar.

### 3. Status-Logik
```
Bestand > 0  →  Status NEU
Bestand = 0  →  Status BEDARF
```

### 4. Stornierung
Stornierung ist nur bei Status NEU oder BEDARF möglich.
Bei ABGESCHLOSSEN oder STORNIERT → kein Storno möglich.

### 5. Techniker-Portal Design
Das Techniker-Portal wird 1:1 nach `techniker.html` (v1) nachgebaut:
- Font: Ubuntu
- CSS-Variablen für Light/Dark-Mode
- Grid: `1fr 420px`
- Toast-System bottom-right
- Alle Modals identisch (Login, Kompatibilität, LogID, Tastatur, Storno)

### 6. Modul-Trennung
- Jede Funktion = eigenes Modul unter `src/modules/`
- Keine Geschäftslogik in Pages oder Portals
- Pages/Portals = nur UI und tRPC-Aufrufe

## Ordnerstruktur

```
src/
├── core/
│   ├── db/           — Prisma Client, DB-Helpers
│   ├── auth/         — NextAuth Konfiguration
│   └── types/        — Shared TypeScript Typen
├── modules/
│   ├── lager/        — Lagerbestand CRUD, Artikel
│   ├── buchungen/    — Buchungslogik (EINGANG/AUSGANG/DIREKT)
│   ├── anfragen/     — Ersatzteil-Anfragen
│   ├── geraete/      — Gerätemodelle
│   ├── kompatibilitaet/ — Kompatibilitäts-Matrix
│   ├── belege/       — PDF-Auslagerbelege
│   ├── statistik/    — Auswertungen
│   ├── warenkorb/    — Warenkorb-System
│   ├── benutzer/     — Benutzerverwaltung
│   └── realtime/     — Socket.io Events
├── portals/
│   ├── techniker/    — Techniker-Portal (1:1 techniker.html)
│   └── admin/        — Admin-Bereich
└── components/
    └── ui/           — Shared UI-Komponenten
```

## Datenbank-Schema (Prisma)

Modelle: `User`, `Artikel`, `Buchung`, `Anfrage`, `Kompatibilitaet`,
`GeraeteModell`, `GeraeteLookup`, `Warenkorb`, `WarenkorbItem`, `TechnikerSession`

Enums: `UserRolle` (ADMIN/TECHNIKER/BETRACHTER), `BuchungsTyp` (EINGANG/AUSGANG/DIREKT),
`AnfrageStatus` (NEU/BEDARF/ABGESCHLOSSEN/STORNIERT), `KorbStatus` (AKTIV/ABGESENDET)

## v1 Referenz-Logik (aus code.gs)

```
bucheLager(id, menge, typ, wer)
  → schreibt Buchung in Buchungen-Tabelle
  → ruft aktualisiereBestandNachHistorie(id)

aktualisiereBestandNachHistorie(id)
  → summiert EINGANG (+) und AUSGANG (-) für id
  → DIREKT wird ignoriert (Netto 0)
  → schreibt Ergebnis in Lagerbestand

technikerAnfrageSubmit(id, modell, name, repId, gesuchterBegriff, type, kommentar)
  → prüft Bestand: >0 → NEU, =0 → BEDARF
  → schreibt Anfrage-Zeile
  → ruft sucheModellUndBestand() zur Kompatibilitätsprüfung

storniereAnfrageTechniker(name, repId, teilName)
  → sucht Anfrage mit Status NEU oder BEDARF
  → setzt Status auf STORNIERT
  → ruft aktualisiereBestandNachHistorie()
```

## Status

### ✅ Fertig
- Grundgerüst (CLAUDE.md, Ordnerstruktur, Prisma Schema, Docker Compose, Next.js Setup)
- Buchungs-Modul (Service, Router, Schema)

### 🔄 In Arbeit
_(nichts aktiv)_

### ❌ Noch offen
- Admin Bereich
- Techniker Portal
- Benutzerverwaltung
- Statistiken
- Warenkorb-System
- LogID Lookup
- Belege (PDF)
- Nerd Dashboard

## Nächster Task
Lager-Modul (Artikel CRUD, Suche) + Anfragen-Modul

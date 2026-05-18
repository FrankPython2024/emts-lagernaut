# Globale Suche — Reindex-Anleitung

## Wann ausführen?

- Erstmalige Inbetriebnahme (Meilisearch-Indices sind leer)
- Nach einem Meilisearch-Volume-Reset
- Wenn Suchtreffer fehlen oder veraltet wirken

## Voraussetzungen

Docker-Stack muss laufen:

```bash
docker compose up -d
```

## Alle 4 Indices auf einmal

```bash
npm run reindex
```

Ausgabe: Artikel / Modelle / Anfragen / Buchungen — jeweils Dokumentanzahl.

## Einzelnen Index aktualisieren

```bash
npx tsx src/scripts/reindex-meilisearch.ts --only artikel
npx tsx src/scripts/reindex-meilisearch.ts --only modelle
npx tsx src/scripts/reindex-meilisearch.ts --only anfragen
npx tsx src/scripts/reindex-meilisearch.ts --only buchungen
```

## Indices prüfen (auf dem Server)

```bash
docker compose exec -T meilisearch wget -q -O - "http://localhost:7700/indexes" \
  -H "Authorization: Bearer lagernaut-master-key"

docker compose exec -T meilisearch wget -q -O - "http://localhost:7700/indexes/artikel/stats" \
  -H "Authorization: Bearer lagernaut-master-key"
```

## Index-Schema

| Index      | Primärschlüssel | Suchbar                                       | Filterbar                              |
|------------|-----------------|-----------------------------------------------|----------------------------------------|
| `artikel`  | `id`            | bezeichnung, modell, kategorie                | kategorie, bestandStatus, lagerplatz   |
| `modelle`  | `id`            | modell, hersteller, logIds                    | hersteller, aktiv                      |
| `anfragen` | `id`            | gruppenNr, teiltyp, geraet, techniker, notiz  | status, techniker, hersteller          |
| `buchungen`| `id`            | artikelBezeichnung, notiz, ausgefuehrtVon     | typ, ausgefuehrtVon, artikelKategorie  |

## Hinweis: automatischer Sync

Der Live-Sync (Trigger nach Mutations) kommt in Schritt 2.
Bis dahin muss `npm run reindex` manuell ausgeführt werden.

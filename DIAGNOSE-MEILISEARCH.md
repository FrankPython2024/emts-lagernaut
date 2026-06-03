# DIAGNOSE: Meilisearch — Stand für Globale Suche

_Erstellt: 2026-05-18_

---

## 1. Ist Meilisearch konfiguriert und erreichbar?

**Konfiguration: vollständig.**

| Variable | Wert |
|---|---|
| `MEILISEARCH_URL` | `http://meilisearch:7700` (docker-intern) |
| `MEILISEARCH_KEY` | `lagernaut-master-key` |
| Docker-Service | `meilisearch` mit `getmeili/meilisearch:latest` |
| Volume | `meilisearch_data` (persistiert) |
| Master-Key | gesetzt (`MEILI_MASTER_KEY`) |

Client-Singleton: `src/core/infra/meilisearch.ts` — sauber, global-cached.

**Erreichbarkeit (Live):** Nicht direkt geprüft (Docker nicht im Sandbox-PATH).  
Die Admin-Systemseite (`/admin/system`) ruft `meilisearch.health()` auf — dort ist der
Live-Status sichtbar.

---

## 2. Welche Indices sind definiert?

Zwei Indices existieren im Code, **aber nur im Worker definiert** (kein `createIndex` mit
explizitem Settings-Call):

### Index `artikel`
| Feld | Typ (Prisma) |
|---|---|
| `id` | `Int` (primaryKey) |
| `bezeichnung` | `String` |
| `kategorie` | `String` |
| `bestand` | `Int` |

Quelle: `worker.ts:48–54` — `prisma.artikel.findMany({ select: { id, bezeichnung, kategorie, bestand } })`

### Index `geraete`
| Feld | Typ (Prisma) |
|---|---|
| `id` | `Int` (primaryKey) |
| `hersteller` | `String` |
| `modell` | `String` |

Quelle: `worker.ts:56–63` — `prisma.geraeteModell.findMany({ where: { aktiv: true }, select: { id, hersteller, modell } })`

**Kein `settings.update()` Call** — Meilisearch-Defaults gelten (alle Felder durchsuchbar,
Typo-Toleranz aktiv). Das ist für den Start OK.

---

## 3. Sind die Indices befüllt — und wie aktuell?

**Wahrscheinlich leer oder veraltet.**

### Grund: Es gibt KEINEN Trigger

```
grep -rn "queues.meilisearch.add\|meilisearch.*add(" src/ → 0 Treffer
```

Die Jobs `reindex-artikel` und `reindex-geraete` existieren im Worker, aber
**niemand ruft `queues.meilisearch.add()` auf**. Die Indices werden nur befüllt,
wenn manuell ein Job eingestellt wird (z.B. via BullMQ-Dashboard oder direkt
via Redis-CLI).

- Erstes Befüllen beim Server-Start: **nein**
- Trigger bei Artikel-Anlage/-Update: **nein**
- Trigger bei Geräte-Anlage: **nein**
- Cronjob: **nein**

→ Index-Inhalt = unbekannt. Falls jemals manuell ein Job ausgeführt wurde, ist
der Stand eingefroren auf diesen Zeitpunkt.

---

## 4. Welcher Sync-Mechanismus existiert?

### Was vorhanden ist
```
BullMQ Queue "meilisearch"
  └── Worker (concurrency: 1) in src/modules/jobs/worker.ts
        ├── case "reindex-artikel"  → Bulk-Reindex aller Artikel
        └── case "reindex-geraete" → Bulk-Reindex aktiver Geräte
```

### Was fehlt
- **Incremental Updates**: Kein `addDocuments([einzelnerArtikel])` nach Mutations
- **Delete-Sync**: Kein `deleteDocument(id)` wenn Artikel gelöscht wird
- **Kein Trigger**: `queues.meilisearch.add("reindex-artikel")` wird nirgendwo aufgerufen

### Existierende Suche (Prisma-basiert, NICHT Meilisearch)

Beide aktiven Such-Procedures (`lager.search`, `lager.searchAdmin`) verwenden
**Prisma `LIKE`-Suche**, nicht Meilisearch:

```
src/modules/lager/service.ts:11
  prisma.artikel.findMany({ where: { OR: [{ bezeichnung: { contains: q } }, ...] } })
```

Meilisearch ist also aktuell **ein ungenutzter Stub**.

---

## 5. Gibt es schon Search-Procedures?

| Procedure | Engine | Portal |
|---|---|---|
| `lager.search` | Prisma LIKE | Techniker (kein Lagerplatz) |
| `lager.searchAdmin` | Prisma LIKE → zweiter Prisma-Call für Lagerplatz | Admin |
| Globale Suche (Strg+K) | **nicht vorhanden** | — |

**Fazit:** Kein Meilisearch-basierter Endpoint existiert. Alles muss neu gebaut werden,
aber die Infrastruktur steht bereit.

---

## 6. Empfehlung

### Pfad A — Bestehende Infrastruktur ausbauen ✅ Empfohlen

**Aufwand: ~3–4 Stunden**

Was zu tun ist:

1. **Indices initialisieren** — `settings.update()` mit `searchableAttributes` und
   `displayedAttributes` einmalig beim Server-Start (in `meilisearch.ts` oder einem
   Init-Script).

2. **Trigger verdrahten** — Nach jeder Artikel- und Geräte-Mutation einen BullMQ-Job
   einstellen:
   ```ts
   // In lager/service.ts nach createArtikel/updateArtikel:
   await queues.meilisearch.add("reindex-artikel", {});
   // Besser langfristig: incremental update statt full reindex
   ```

3. **tRPC-Procedure** — `search.global` (adminProcedure + protectedProcedure) die
   Meilisearch multi-index search nutzt und Lagerplatz je nach Rolle filtert.

4. **Frontend** — Strg+K Modal mit Combobox, Ergebnisgruppen (Artikel / Geräte),
   Keyboard-Navigation.

**Vorteil:** Kein neues Dependency, Worker-Skelett vorhanden, Docker-Service läuft.

---

### Pfad B — Komplett neu (Prisma-only, Meilisearch entfernen)

**Aufwand: ~1–2 Stunden, aber schlechtere UX**

Globale Suche nur über Prisma LIKE — einfacher, kein Typo-Toleranz, kein Ranking,
schlechte Performance bei großen Datensätzen (>10k Artikel).  
Nur sinnvoll wenn Meilisearch-Docker Probleme macht.

---

## Zusammenfassung

| Frage | Antwort |
|---|---|
| Konfiguriert? | Ja — Client, Docker, Env-Vars vollständig |
| Indices definiert? | Logisch ja (artikel, geraete), aber kein Settings-Init |
| Indices befüllt? | Wahrscheinlich leer — kein Trigger vorhanden |
| Sync-Mechanismus? | Worker-Skelett vorhanden, aber keine Aufrufer |
| Search-Procedures? | Nur Prisma-LIKE, kein Meilisearch-Endpoint |
| Empfehlung | **Pfad A**: Trigger + Procedure + Modal, ~3–4h |
